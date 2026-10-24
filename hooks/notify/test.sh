#!/bin/bash
# Offline tests for notify.py. Fake terminal-notifier/osascript log their argv;
# TERM_PROGRAM/TERM overrides stand in for Terminal.app and Ghostty (no real windows).
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
PY="$(command -v python3)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin_tn" "$TMP/bin_osa" "$TMP/home" "$TMP/myproject"
for f in "$TMP/bin_tn/terminal-notifier" "$TMP/bin_osa/osascript"; do
  printf '#!/bin/bash\nprintf "%%s\\n" "$(basename "$0")" "$@" >> "$FAKE_LOG"\n' > "$f"; chmod +x "$f"
done
export HOME="$TMP/home" FAKE_LOG="$TMP/argv.log"
unset TMUX COLORTERM CLAUDE_MODS_DISABLE
BOTH="$TMP/bin_tn:$TMP/bin_osa:$PATH"
FAIL=0

t() { local d="$1"; shift; if "$@"; then echo "ok   - $d"; else echo "FAIL - $d"; FAIL=1; fi; }
has() { case "$1" in *"$2"*) return 0;; *) return 1;; esac; }
lacks() { ! has "$1" "$2"; }
empty() { [ -z "$1" ]; }
json_osc() { printf '%s' "$1" | "$PY" -c 'import json,sys; d=json.load(sys.stdin); s=d["terminalSequence"]; sys.exit(0 if "\x1b]777;notify;" in s and "myproject" in s else 1)'; }

# run <session_id> <event> <extra-json> -> OUT (stdout), RC, LOG (fake argv)
run() {
  : > "$FAKE_LOG"
  OUT="$(printf '{"session_id":"%s","cwd":"%s","hook_event_name":"%s"%s}' "$1" "$TMP/myproject" "$2" "$3" \
        | "$PY" "$HERE/notify.py" 2>"$TMP/err")"; RC=$?
  LOG="$(cat "$FAKE_LOG")"
}

echo "# Terminal.app, Stop (payload carries last_assistant_message)"
PATH="$BOTH" TERM_PROGRAM=Apple_Terminal TERM=xterm-256color run s1 Stop ',"stop_hook_active":false,"last_assistant_message":"SECRET_ASSISTANT_TEXT"'
t "exit 0" [ "$RC" = 0 ]
t "terminal-notifier called" has "$LOG" terminal-notifier
t "subtitle is project name" has "$LOG" myproject
t "body is Finished" has "$LOG" Finished
t "-activate com.apple.Terminal" has "$LOG" com.apple.Terminal
t "no terminalSequence on stdout" empty "$OUT"
t "last_assistant_message never leaks" lacks "$LOG$OUT" SECRET_ASSISTANT_TEXT

echo "# Ghostty, Notification permission_prompt"
PATH="$BOTH" TERM_PROGRAM=ghostty TERM=xterm-ghostty COLORTERM=truecolor run s2 Notification ',"notification_type":"permission_prompt","message":"Claude needs your permission to use Bash","title":"Permission needed"'
t "terminal-notifier called" has "$LOG" terminal-notifier
t "body is Needs permission" has "$LOG" "Needs permission"
t "raw message not forwarded" lacks "$LOG$OUT" "permission to use Bash"
t "-activate com.mitchellh.ghostty" has "$LOG" com.mitchellh.ghostty
t "stdout is JSON with OSC 777 notify + project" json_osc "$OUT"

echo "# Ghostty, Stop with stop_hook_active true still notifies, never blocks"
PATH="$BOTH" TERM_PROGRAM=ghostty TERM=xterm-ghostty run s3 Stop ',"stop_hook_active":true'
t "exit 0" [ "$RC" = 0 ]
t "no decision/block in output" lacks "$OUT" '"decision"'
t "OSC 777 emitted" json_osc "$OUT"

echo "# osascript fallback when terminal-notifier is absent"
PATH="$TMP/bin_osa:/usr/bin:/bin" TERM_PROGRAM=Apple_Terminal TERM=xterm-256color run s4 Stop ''
t "osascript called" has "$LOG" osascript
t "script uses on run argv" has "$LOG" "on run argv"
t "project passed as argument" has "$LOG" myproject
t "no terminalSequence in Terminal.app" empty "$OUT"

echo "# unmapped type: message truncated to 80 chars"
LONG="$(printf 'x%.0s' $(seq 1 100))END"; X80="$(printf 'x%.0s' $(seq 1 80))"
PATH="$BOTH" TERM_PROGRAM=Apple_Terminal TERM=xterm-256color run s5 Notification ",\"notification_type\":\"something_new\",\"message\":\"$LONG\""
t "first 80 chars kept" has "$LOG" "$X80"
t "81st char dropped" lacks "$LOG" "${X80}x"
t "tail dropped" lacks "$LOG" END

echo "# skipped notification types"
PATH="$BOTH" TERM_PROGRAM=Apple_Terminal TERM=xterm-256color run s6 Notification ',"notification_type":"auth_success","message":"Logged in"'
t "auth_success fires nothing" empty "$LOG$OUT"
PATH="$BOTH" TERM_PROGRAM=Apple_Terminal TERM=xterm-256color run s7 Notification ',"notification_type":"elicitation_dialog","message":"x"'
t "elicitation_* fires nothing" empty "$LOG$OUT"

echo "# rate limit: second call within 2 s for the same session is suppressed"
PATH="$BOTH" TERM_PROGRAM=Apple_Terminal TERM=xterm-256color run s8 Stop ''
t "first call fires" has "$LOG" terminal-notifier
PATH="$BOTH" TERM_PROGRAM=Apple_Terminal TERM=xterm-256color run s8 Stop ''
t "second call suppressed" empty "$LOG$OUT"
t "marker lives under HOME/.cache/claude-mods/notify" [ -f "$HOME/.cache/claude-mods/notify/s8" ]

echo "# disable convention and empty stdin"
CLAUDE_MODS_DISABLE=other,notify PATH="$BOTH" TERM_PROGRAM=ghostty TERM=xterm-ghostty run s9 Stop ''
t "CLAUDE_MODS_DISABLE=notify exits 0" [ "$RC" = 0 ]
t "disabled: silent" empty "$LOG$OUT"
OUT="$("$PY" "$HERE/notify.py" </dev/null)"; RC=$?
t "empty stdin exits 0 silently" [ "$RC" = 0 -a -z "$OUT" ]

[ "$FAIL" = 0 ] && echo "ALL PASS" || { echo "SOME FAILED"; exit 1; }
