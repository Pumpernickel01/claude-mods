# activity-pane

A column beside Claude when Claude Code runs inside [herdr](https://herdr.dev):
three panes to the right of Claude's.

- **Data flow** (top): one line per transfer Claude makes (model requests, web
  fetches, MCP calls, hosts shell commands reach). Tab switches to **Guide**,
  `~/.claude/workflow-guide.md`.
- **Shell** (middle, the biggest): your shell. Shift+Tab opens **Agents**, a
  table of this session's agents; Tab cycles Agents → **Agent graph** → Shell,
  Shift+Tab goes back one, Esc or q returns to the shell. The agent data comes
  from `~/.claude/agent-monitor/events.jsonl`, written by the `mods` plugin's
  monitor hooks (`../monitor`). Shift+Tab here replaces zsh's reverse
  menu-complete.
- **Tools** (bottom): Claude's tool calls with outcome and duration.

Outside herdr, or beside a Claude pane narrower than 144 columns, an Activity
pane opens inside Claude instead; `/activity` opens the column anyway, or
remakes what was closed of it. Leaving Claude closes the column; `/clear` keeps
it. Design and decisions: `docs/2026-10-18-herdr-column-design.md`.

## Install

It is a function-hooks mod, not part of the `mods` plugin: load it from this
folder by adding its path to `CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json`
`env` (paths separated by `:`), then start Claude Code again:

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "/Users/you/claude-mods/activity-pane" } }
```

Needs `node` (the viewers) and `python3` (the Shell pane), both stdlib only.

## Tests

`bash activity-pane/test.sh`: the Shell pane's views and the wrapper in a real
pty (Python), the viewers' drawing (`node --test`), and the hooks module with
herdr mocked (`claude plugin test`).
