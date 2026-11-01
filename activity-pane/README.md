# activity-pane

A column beside Claude when Claude Code runs inside [herdr](https://herdr.dev):
three panes to the right of Claude's.

- **Data flow** (top): one line per transfer Claude makes (model requests, web
  fetches, MCP calls, hosts shell commands reach).
- **Shell** (middle, the biggest): your shell. Tab cycles Shell → **Agents**, a
  live tree of this session's agents and sub-agents (finished ones greyed out),
  each by the first 6 characters of its id with its type or given name beside
  it and a progress bar (done items of the task list the agent keeps with
  TodoWrite, read from its transcript; empty until it keeps one, full once it
  has finished), with a list of who started, messaged
  or answered whom → **Agent graph** (a force-directed graph as in Obsidian:
  the main session in the middle, agents around it as circles (`● a56a1d` over
  the progress bar) and sub-agents around their parent, no two nodes touching,
  joined by smooth box-drawing elbows, dots flowing along every edge whose
  agents talk now) → **Roster**, the agents you can call as `@agent-<name>`,
  each with what it does, read from the frontmatter of the subagent files in
  `~/.claude/agents` and the project's `.claude/agents` (not plugin agents,
  there are too many to be a reminder) → **Keepsake**, your own memo on how to
  ask, `~/.claude/keepsake.md` → Shell; both memos are read at each redraw, so
  an edit shows at once. Shift+Tab goes back one (from the shell, straight to
  Keepsake), Esc or q returns to the shell. Arrows, PgUp/PgDn and the mouse wheel scroll a view taller than the
  pane; when the graph has more agents than fit, finished sibling agents fold
  into one node (`◌ ✗ 5 failed`). `c` clears
  finished agents from both views until the pane restarts. The agent data comes
  from `~/.claude/agent-monitor/events.jsonl`, written by the `mods` plugin's
  monitor hooks (`../monitor`). Tab switches only at the shell's prompt, so it
  replaces zsh's completion there; a program the shell runs keeps its Tab.
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
