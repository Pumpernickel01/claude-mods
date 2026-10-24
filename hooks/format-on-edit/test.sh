#!/bin/bash
# Offline tests for format-on-edit. Run: bash test.sh   (macOS bash 3.2 ok)
# Prints only PASS/FAIL lines; exits non-zero on any failure.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HERE/format.py"
PY="$(command -v python3)"                      # resolve before PATH is restricted
T="$(mktemp -d)" || exit 1
T="$(cd "$T" && pwd -P)"                        # physical path: realpath() in the hook must match
trap 'rm -rf "$T"' EXIT
export TMPDIR="$T/tmp"                          # marker dir lands here, so reruns start clean
mkdir -p "$TMPDIR" "$T/bin" "$T/proj/node_modules/pkg"
fail=0
ok()  { echo "PASS: $1"; }
bad() { echo "FAIL: $1"; fail=1; }

# fake formatters record their argv; prettier also fails, to prove failure is silent
for f in shfmt prettier; do
  cat > "$T/bin/$f" <<EOF
#!/bin/bash
echo "$f \$*" >> "$T/calls"
[ "$f" = prettier ] && exit 1
exit 0
EOF
  chmod +x "$T/bin/$f"
done
: > "$T/calls"

# run <file_path> <session_id>  -> hook stdout; exit status is the hook's
run() {
  printf '{"session_id":"%s","transcript_path":"%s/t.jsonl","cwd":"%s","permission_mode":"default","hook_event_name":"PostToolUse","tool_name":"Edit","tool_input":{"file_path":"%s","old_string":"a","new_string":"b"},"tool_response":{"filePath":"%s"},"tool_use_id":"toolu_01"}' \
    "$2" "$T" "$T/proj" "$1" "$1" | PATH="$T/bin:/usr/bin:/bin" "$PY" "$HOOK"
}

touch "$T/proj/a.sh" "$T/proj/b.ts" "$T/proj/c.py" "$T/proj/node_modules/pkg/d.ts"

out="$(run "$T/proj/a.sh" s1)"; rc=$?
[ "$rc" = 0 ] && [ -z "$out" ] && grep -qxF "shfmt -w $T/proj/a.sh" "$T/calls" \
  && ok ".sh runs shfmt -w <file>, silent" || bad ".sh -> shfmt (rc=$rc out=$out)"

out="$(run "$T/proj/b.ts" s1)"; rc=$?
[ "$rc" = 0 ] && [ -z "$out" ] && grep -qxF "prettier --write $T/proj/b.ts" "$T/calls" \
  && ok ".ts runs prettier --write <file>; formatter failure silent" || bad ".ts -> prettier (rc=$rc out=$out)"

want='{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"format-on-edit: no formatter for .py files; install with `brew install ruff` to enable auto-formatting."}}'
out1="$(run "$T/proj/c.py" s2)"
out2="$(run "$T/proj/c.py" s2)"
[ "$out1" = "$want" ] && ok ".py without ruff/black prints the exact suggestion JSON" || bad ".py suggestion (got: $out1)"
[ -z "$out2" ] && ok ".py suggestion not repeated for the same session_id" || bad ".py suggestion repeated"
out3="$(run "$T/proj/c.py" s3)"
[ "$out3" = "$want" ] && ok ".py suggestion shown again for a new session_id" || bad ".py new session (got: $out3)"

n=$(wc -l < "$T/calls")
out="$(run "$T/proj/node_modules/pkg/d.ts" s1)"; rc=$?
[ "$rc" = 0 ] && [ -z "$out" ] && [ "$(wc -l < "$T/calls")" = "$n" ] \
  && ok "node_modules path skipped" || bad "node_modules not skipped"

out="$(run "$T/proj/gone.sh" s1)"
[ -z "$out" ] && [ "$(wc -l < "$T/calls")" = "$n" ] && ok "missing file skipped" || bad "missing file not skipped"

out="$(CLAUDE_MODS_DISABLE=format-on-edit run "$T/proj/a.sh" s1)"; rc=$?
[ "$rc" = 0 ] && [ -z "$out" ] && [ "$(wc -l < "$T/calls")" = "$n" ] \
  && ok "CLAUDE_MODS_DISABLE=format-on-edit exits 0, no output, no formatter run" || bad "disable convention (rc=$rc)"

out="$(printf '' | PATH="$T/bin:/usr/bin:/bin" "$PY" "$HOOK")"; rc=$?
[ "$rc" = 0 ] && [ -z "$out" ] && ok "empty stdin exits 0 quietly" || bad "empty stdin (rc=$rc)"

exit $fail
