# herdr: a bare `herdr` typed outside herdr opens Claude in the current folder, in a workspace of
# its own (or focuses the one already running Claude there), and shows the Activity panels in a
# second Terminal window attached to the herdr session "activity". Any other use passes through.
# Load it from ~/.zshrc with: source ~/claude-mods/activity-pane/herdr.zsh
herdr() {
  if [[ $# -gt 0 || -n $HERDR_ENV ]]; then command herdr "$@"; return; fi
  local s i ws pane dir=${PWD:A}
  # Both servers run before Claude starts, so its session start finds "activity" and opens the column.
  for s in default activity; do
    command herdr --session $s status server 2>/dev/null | grep -q 'status: running' && continue
    (command herdr --session $s server >/dev/null 2>&1 &)
    for i in {1..50}; do
      command herdr --session $s status server 2>/dev/null | grep -q 'status: running' && break
      sleep 0.1
    done
  done
  osascript -e 'tell application "Terminal" to do script "exec herdr session attach activity"' >/dev/null
  ws=$(command herdr pane list | jq -r --arg dir "$dir" \
    'first(.result.panes[] | select(.agent == "claude" and .cwd == $dir) | .workspace_id) // empty')
  if [[ -n $ws ]]; then
    command herdr workspace focus "$ws" >/dev/null
  else
    pane=$(command herdr workspace create --cwd "$dir" --focus | jq -r '.result.root_pane.pane_id')
    command herdr pane run "$pane" claude >/dev/null
  fi
  command herdr
}
