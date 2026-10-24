#!/bin/bash
# Agent monitor window:  monitor.sh open [session_id] | close | toggle | status   (bash 3.2)
# Opens the Textual monitor (monitor.py) to the RIGHT of the Claude Code window:
#   tmux pane  ->  Ghostty split (AppleScript)  ->  Terminal.app window (AppleScript), also the fallback.
# State: ~/.claude/agent-monitor/monitor.pid (written by monitor.py) and monitor.json (window/pane id).
set -u
ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
. "$ROOT/lib/termcap.sh"
DIR="$HOME/.claude/agent-monitor"
[ -n "${CLAUDE_MODS_EVENT_LOG:-}" ] && DIR="$(dirname "$CLAUDE_MODS_EVENT_LOG")"
PID_FILE="$DIR/monitor.pid"
META="$DIR/monitor.json"
AS="$ROOT/monitor/applescript"
# absolute uv path: Ghostty/Terminal run the command with /bin/sh -c, where Homebrew is not on PATH
UV="$(command -v uv 2>/dev/null || echo uv)"
CMD="cd '$ROOT/monitor' && '$UV' run --quiet --no-project --with 'textual>=0.80,<2' python monitor.py"

alive() { [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE" 2>/dev/null)" 2>/dev/null; }
meta() { python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get(sys.argv[2], ""))' "$META" "$1" 2>/dev/null; }

do_open() {
  if alive; then echo "monitor already running (pid $(cat "$PID_FILE"))"; return 0; fi
  command -v uv >/dev/null 2>&1 || { echo "monitor: uv not found (brew install uv)"; return 1; }
  [ "$(uname)" = Darwin ] || [ -n "${TMUX:-}" ] || { echo "monitor: needs tmux or macOS to place a window"; return 1; }
  mkdir -p "$DIR" && chmod 700 "$DIR"
  rm -f "$PID_FILE"
  case "$TC_TERMINAL" in
    tmux)
      id="$(tmux split-window -h -l 45% -P -F '#{pane_id}' "$CMD")" || return 1
      backend=tmux; msg="tmux pane $id" ;;
    ghostty)
      # "shell:" makes Ghostty run the string via /bin/sh -c (Ghostty >= 1.2)
      id="$(osascript "$AS/ghostty_open.applescript" "shell:$CMD")" || return 1
      backend=ghostty; msg="Ghostty ${id%%:*} ${id#*:}" ;;
    *)
      # geometry of the screen holding the front Terminal window (not the main screen: multi-display)
      win="$(osascript -e 'tell application "Terminal" to get bounds of front window' 2>/dev/null | tr -d ',')" || win=""
      case "$win" in *[!0-9\ -]*) win="" ;; esac   # digits, spaces, minus only: never an option or glob
      set -f; scr="$(osascript -l JavaScript "$AS/screen.js" $win)" || { set +f; return 1; }; set +f
      set -- $scr; [ $# -eq 4 ] || { echo "monitor: could not read the screen size"; return 1; }
      id="$(osascript "$AS/terminal_open.applescript" "$CMD; exit" "$1" "$2" "$3" "$4")" || return 1
      backend=terminal; msg="Terminal.app window $id"
      [ "$TC_TERMINAL" = apple_terminal ] || msg="$msg (terminal '$TC_TERMINAL' is not scriptable; used Terminal.app)" ;;
  esac
  python3 -c 'import json,sys; json.dump({"backend": sys.argv[2], "id": sys.argv[3], "session_id": sys.argv[4]}, open(sys.argv[1], "w"))' \
    "$META" "$backend" "$id" "${SESSION_ID:-}"
  echo "monitor opened: $msg"
}

do_close() {
  pid="$(cat "$PID_FILE" 2>/dev/null)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null; echo "monitor stopped (pid $pid)"
    i=0; while kill -0 "$pid" 2>/dev/null && [ $i -lt 30 ]; do sleep 0.1; i=$((i+1)); done  # let it exit before the window closes
  else echo "monitor not running"; fi
  rm -f "$PID_FILE"
  [ -f "$META" ] || return 0
  id="$(meta id)"
  case "$(meta backend)" in
    tmux)     tmux kill-pane -t "$id" >/dev/null 2>&1 ;;
    ghostty)  osascript "$AS/ghostty_close.applescript" "${id%%:*}" "${id#*:}" >/dev/null 2>&1 ;;
    terminal) osascript "$AS/terminal_close.applescript" "$id" >/dev/null 2>&1 ;;
  esac
  rm -f "$META"
}

do_status() {
  if alive; then echo "monitor running (pid $(cat "$PID_FILE"), $(meta backend) $(meta id))"
  elif [ -f "$PID_FILE" ]; then echo "monitor not running (stale pid file)"
  else echo "monitor not running"; fi
}

case "${1:-toggle}" in
  open)   SESSION_ID="${2:-}" do_open ;;
  close)  do_close ;;
  toggle) if alive; then do_close; else do_open; fi ;;
  status) do_status ;;
  *) echo "usage: monitor.sh open [session_id] | close | toggle | status"; exit 2 ;;
esac
