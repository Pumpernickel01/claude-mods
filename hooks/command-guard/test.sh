#!/bin/bash
# Runs every line of tests.txt through guard.py with realistic PreToolUse stdin.
# cwd is a temp git repo on branch "feature" (or "main" for @main lines).
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
GUARD="$DIR/guard.py"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
for b in feature main; do
  git init -q "$TMP/$b" && git -C "$TMP/$b" symbolic-ref HEAD "refs/heads/$b"
done

stdin_json() {  # $1 cwd, $2 command
  python3 -c 'import json,sys; print(json.dumps({"session_id":"abc123","transcript_path":"/tmp/t.jsonl","cwd":sys.argv[1],"permission_mode":"default","hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":sys.argv[2],"description":"test","timeout":120000},"tool_use_id":"toolu_01ABC"}))' "$1" "$2"
}
is_deny() { python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["hookSpecificOutput"]["permissionDecision"]=="deny"' 2>/dev/null; }

fail=0 n=0 nb=0 na=0
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in ''|'#'*) continue;; esac
  want="${line%% *}"; cmd="${line#* }"; branch=feature
  case "$want" in *@main) branch=main; want="${want%@main}";; esac
  n=$((n+1))
  out="$(stdin_json "$TMP/$branch" "$cmd" | python3 "$GUARD" 2>"$TMP/err")"; rc=$?
  if [ "$want" = BLOCK ]; then
    nb=$((nb+1))
    { [ "$rc" -eq 0 ] && printf '%s' "$out" | is_deny; } || { echo "FAIL (expected deny, rc=$rc, out=$out): $line"; fail=1; }
  else
    na=$((na+1))
    { [ "$rc" -eq 0 ] && [ -z "$out" ]; } || { echo "FAIL (expected allow, rc=$rc, out=$out): $line"; fail=1; }
  fi
done < "$DIR/tests.txt"

# contract cases outside the table
printf 'not json' | python3 "$GUARD" >"$TMP/out" 2>"$TMP/err"; rc=$?
[ "$rc" -eq 2 ] && [ -s "$TMP/err" ] && [ ! -s "$TMP/out" ] || { echo "FAIL: invalid JSON should exit 2 with stderr reason (rc=$rc)"; fail=1; }
printf '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{}}' | python3 "$GUARD" >"$TMP/out"; rc=$?
[ "$rc" -eq 0 ] && [ ! -s "$TMP/out" ] || { echo "FAIL: missing tool_input.command should exit 0 silently (rc=$rc)"; fail=1; }
printf '' | python3 "$GUARD" >"$TMP/out"; rc=$?
[ "$rc" -eq 0 ] && [ ! -s "$TMP/out" ] || { echo "FAIL: empty stdin should exit 0 silently (rc=$rc)"; fail=1; }
out="$(stdin_json "$TMP/feature" "rm -rf /" | CLAUDE_MODS_DISABLE=other,command-guard python3 "$GUARD")"; rc=$?
[ "$rc" -eq 0 ] && [ -z "$out" ] || { echo "FAIL: CLAUDE_MODS_DISABLE=command-guard should allow everything (rc=$rc)"; fail=1; }

echo "command-guard: $n table cases ($nb BLOCK, $na ALLOW) + 4 contract cases: $([ "$fail" -eq 0 ] && echo PASS || echo FAIL)"
exit "$fail"
