#!/bin/bash
# Offline tests for test-writer-guard. Run: bash test.sh   (macOS bash 3.2 ok)
# Prints PASS/FAIL lines; exits non-zero on any failure.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HERE/guard.py"
T="$(cd "$(mktemp -d)" && pwd -P)"              # physical path: realpath() in the hook must match
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/proj/tests" "$T/proj/src"
fail=0
ok()  { echo "PASS: $1"; }
bad() { echo "FAIL: $1"; fail=1; }

DENY_PREFIX='{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"test-writer may only write test files; ask the main agent to change '

# run <agent_type or ""> <file_path> : stdout -> $T/out, returns hook exit code
run() {
  local agent=""
  [ -n "$1" ] && agent="\"agent_id\":\"a1\",\"agent_type\":\"$1\","
  printf '{"session_id":"abc123","transcript_path":"%s/t.jsonl","cwd":"%s","permission_mode":"default","hook_event_name":"PreToolUse",%s"tool_name":"Write","tool_input":{"file_path":"%s","content":"x"},"tool_use_id":"toolu_01"}' \
    "$T" "$T/proj" "$agent" "$2" | python3 "$HOOK" > "$T/out"
}

expect_allow() {  # <label> <agent> <path>
  run "$2" "$3"; rc=$?; out="$(cat "$T/out")"
  [ "$rc" = 0 ] && [ -z "$out" ] && ok "$1" || bad "$1 (rc=$rc out=$out)"
}
expect_deny() {   # <label> <agent> <path>
  run "$2" "$3"; rc=$?; out="$(cat "$T/out")"
  [ "$rc" = 0 ] && [ "$out" = "${DENY_PREFIX}$3\"}}" ] && ok "$1" || bad "$1 (rc=$rc out=$out)"
}

expect_allow "test-writer -> tests/test_x.py allowed (relative)"      test-writer "tests/test_x.py"
expect_allow "test-writer -> absolute tests path allowed"              test-writer "$T/proj/tests/test_x.py"
expect_allow "test-writer -> src/__tests__/x.test.ts allowed"          test-writer "src/__tests__/x.test.ts"
expect_allow "test-writer -> pkg/foo_test.go allowed"                  test-writer "pkg/foo_test.go"
expect_allow "mods:test-writer -> Tests/FooTests.swift allowed"        mods:test-writer "Tests/FooTests.swift"
expect_deny  "test-writer -> src/x.py denied"                          test-writer "src/x.py"
expect_deny  "mods:test-writer -> src/x.py denied"                     mods:test-writer "src/x.py"
expect_deny  "test-writer -> ../outside.py denied (leaves cwd)"        test-writer "../outside.py"
expect_deny  "test-writer -> tests/../src/x.py denied (realpath)"      test-writer "tests/../src/x.py"
expect_deny  "test-writer -> src/lib.rs denied (Rust cfg(test) exception)" test-writer "src/lib.rs"
expect_allow "no agent_type (main session) -> src/x.py allowed"        "" "src/x.py"
expect_allow "other agent -> src/x.py allowed"                         general-purpose "src/x.py"

out="$(printf '{"cwd":"%s","hook_event_name":"PreToolUse","agent_type":"test-writer","tool_name":"Edit","tool_input":{"file_path":"src/x.py","old_string":"a","new_string":"b"}}' "$T/proj" \
      | CLAUDE_MODS_DISABLE=other,test-writer-guard python3 "$HOOK")"; rc=$?
[ "$rc" = 0 ] && [ -z "$out" ] && ok "CLAUDE_MODS_DISABLE=test-writer-guard exits 0, no output" || bad "disable convention (rc=$rc out=$out)"

out="$(printf '' | python3 "$HOOK")"; rc=$?
[ "$rc" = 0 ] && [ -z "$out" ] && ok "empty stdin exits 0 quietly" || bad "empty stdin (rc=$rc)"

out="$(printf 'not json' | python3 "$HOOK")"; rc=$?
[ "$rc" = 0 ] && [ -z "$out" ] && ok "garbage stdin exits 0 quietly" || bad "garbage stdin (rc=$rc)"

# Bash: test-writer may run tests but not write files or history
bash_case() {  # <allow|deny> <agent> <command>
  out="$(python3 -c 'import json,sys;print(json.dumps({"cwd":sys.argv[1],"hook_event_name":"PreToolUse","agent_type":sys.argv[2],"tool_name":"Bash","tool_input":{"command":sys.argv[3]}}))' "$T/proj" "$2" "$3" | python3 "$HOOK")"; rc=$?
  case "$1" in
    allow) [ "$rc" = 0 ] && [ -z "$out" ] && ok "bash allow: $3" || bad "bash allow: $3 (rc=$rc out=$out)" ;;
    deny)  [ "$rc" = 0 ] && [ "${out#*permissionDecision\":\"deny}" != "$out" ] && ok "bash deny: $3" || bad "bash deny: $3 (rc=$rc out=$out)" ;;
  esac
}
bash_case allow test-writer 'npm test 2>&1 | tail -20'
bash_case allow test-writer 'python3 -m pytest -q tests/ >&2'
bash_case allow test-writer 'CI=1 go test ./... && echo ok'
bash_case allow test-writer 'git status --short; git diff'
bash_case allow test-writer 'npm run test:unit -- --watch=false'
bash_case allow test-writer 'cargo test -q | grep -c ok'
bash_case deny  test-writer 'cat > src/x.py <<EOF
x
EOF'
bash_case deny  test-writer 'echo hi >> src/x.py'
bash_case deny  test-writer 'npm test &> out.txt'
bash_case deny  test-writer 'sed -i "" "s/a/b/" src/x.py'
bash_case deny  test-writer 'python3 -c "open(\"src/x.py\",\"w\").write(\"x\")"'
bash_case deny  test-writer 'bash -c "rm -rf src"'
bash_case deny  test-writer 'echo $(rm -rf src)'
bash_case deny  test-writer 'git commit -m "x"'
bash_case deny  test-writer 'git checkout -- src'
bash_case deny  test-writer 'npm run build'
bash_case deny  test-writer 'cp tests/a.py src/a.py'
bash_case deny  test-writer 'find . -name "*.py" | xargs rm'
bash_case deny  test-writer 'echo "unbalanced'
bash_case deny  test-writer 'echo hi # ok
rm -rf src'
bash_case deny  test-writer 'PAGER="rm -rf src" git log -1'
bash_case deny  test-writer 'GIT_DIR=/tmp/x git status'
bash_case deny  test-writer 'npx -y evil-pkg'
bash_case allow test-writer 'npx jest --ci'
bash_case deny  test-writer 'find . -name "*.py" -delete'
bash_case allow test-writer 'find . -name "*_test.py"'
bash_case deny  test-writer 'git branch -D main'
bash_case deny  test-writer 'git branch feature'
bash_case allow test-writer 'git branch --show-current'
bash_case deny  test-writer 'git log --output=src/x.py'
bash_case deny  test-writer 'git -c core.pager="rm -rf src" log'
bash_case deny  test-writer 'rg --pre "rm -rf src" x'
bash_case deny  mods:test-writer 'npm install left-pad'
bash_case allow general-purpose 'echo hi > src/x.py'

exit $fail
