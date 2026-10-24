#!/bin/bash
# Offline tests for activity-pane (bash 3.2, exit 1 on any failure):
#   1. viewer/shell_tabs_test.py   the Shell pane's Agents views, and the wrapper in a real pty
#   2. viewer/draw.spec.mjs        what the Data flow, Guide and Tools viewers draw (node --test)
#   3. tests/*.test.tsx            the hooks module, herdr mocked (claude plugin test)
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
pass=0; fail=0
run() {
  if out="$("${@:2}" 2>&1)"; then pass=$((pass+1)); echo "ok   - $1"
  else fail=$((fail+1)); echo "FAIL - $1"; printf '%s\n' "$out" | tail -20; fi
}

run "shell_tabs (python)" python3 "$HERE/viewer/shell_tabs_test.py"
if command -v node >/dev/null 2>&1; then run "viewers (node --test)" node --test "$HERE/viewer/draw.spec.mjs"
else echo "skip - node not on PATH"; fi
if command -v claude >/dev/null 2>&1; then run "hooks module (claude plugin test)" claude plugin test "$HERE"
else echo "skip - claude not on PATH"; fi

echo "# $pass passed, $fail failed"
[ "$fail" -eq 0 ]
