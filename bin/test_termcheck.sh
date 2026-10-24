#!/bin/bash
# Smoke test for bin/termcheck under /bin/bash 3.2 with Terminal.app and Ghostty env overrides.
set -u
BIN="$(cd "$(dirname "$0")" && pwd)"; fail=0
for e in "TERM_PROGRAM=Apple_Terminal TERM_PROGRAM_VERSION=470.2 TERM=xterm-256color" "TERM_PROGRAM=ghostty TERM=xterm-ghostty COLORTERM=truecolor"; do
  out=$(env -i HOME="$HOME" PATH="$PATH" LANG=en_US.UTF-8 $e /bin/bash "$BIN/termcheck") || fail=1
  printf '%s\n' "$out" | grep -q 'Nerd Font' && printf '%s\n' "$out" | grep -q $'\x1b\[48;2;' && printf '%s\n' "$out" | grep -q 'TC_TRUECOLOR=1' \
    && echo "ok   termcheck under $e" || { echo "FAIL termcheck under $e"; fail=1; }
done
[ "$fail" = 0 ] && echo "ALL PASS" || exit 1
