# activity-pane

A column of panels for each Claude Code session that runs inside [herdr](https://herdr.dev).
The panels live in a second herdr session, `activity`, one tab per Claude session named
after its folder, so Claude's window holds only Claude: put several sessions side by side
there and see which one waits for you. Show the panels in a second terminal window with
`herdr session attach activity`. To open both windows with one `herdr`, add this to
`~/.zshrc` (Terminal.app; a bare `herdr` outside herdr only, anything else passes through):

```zsh
herdr() {
  if [[ $# -eq 0 && -z $HERDR_ENV ]]; then
    osascript -e 'tell application "Terminal" to do script "exec herdr session attach activity"' >/dev/null
  fi
  command herdr "$@"
}
```

- **Data flow** (top): one line per transfer Claude makes (model requests, web
  fetches, MCP calls, hosts shell commands reach).
- **Shell** (middle, the biggest): your shell. Shift+Tab cycles Shell → **Agents**, a
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
  ask, `~/.claude/keepsake.md` → **Keys**, this pane's keys and herdr's (its
  defaults from `herdr --default-config` with `~/.config/herdr/config.toml` over
  them, plus your own `[[keys.command]]` entries) → Shell; both memos are read at
  each redraw, so an edit shows at once. From the shell, Shift+Tab opens Agents.
  In a view, 1–6 jump straight to a view (1 is the shell), Left and Right go back
  and forward, Shift+Tab goes forward, Esc or q returns to the shell. The pane's
  title lists every view with its number, the shown one in brackets, so the shell
  shows what else is there. Up/Down, PgUp/PgDn and the mouse wheel scroll a view taller than the
  pane; when the graph has more agents than fit, finished sibling agents fold
  into one node (`◌ ✗ 5 failed`). `c` clears
  finished agents from both views until the pane restarts. The agent data comes
  from `~/.claude/agent-monitor/events.jsonl`, written by the `mods` plugin's
  monitor hooks (`../monitor`). Tab is never taken: the shell keeps its
  completion.
- **Tools** (bottom): Claude's tool calls with outcome and duration.
- **scout** and **maker** tabs: opened in the same workspace at session start, each
  with a warm `claude -n <name>` in it for side work that must not land in the main
  session: scout looks things up, maker generates things. The herdr agent name is
  `<name>-<project folder>`, so from the Shell pane: `herdr agent prompt
  scout-my-project "…"`. They stay open when the main session exits; a worker that
  exits leaves its tab, and the next start opens a new one. In the home folder each
  worker waits at Claude's trust question until you answer it in its tab. The list is
  `WORKERS` in `hooks/register.tsx`. Not opened inside a worker (`CLAUDE_MODS_ROLE`).

Outside herdr, an Activity pane opens inside Claude instead. When the `activity`
session is not running, Claude says how to start it and opens nothing; then
`/activity` opens the column. `/activity` also remakes what was closed of it.
Leaving Claude closes its tab; `/clear` keeps it. Claude sessions starting together
share one workspace (a lock folder in `~/.claude/activity`). A column left beside
Claude by an older version stays there until `/activity` moves it (its Shell pane
closes then). Design and decisions: `docs/2026-10-18-herdr-column-design.md`.

## Git strip

Every tab has a strip of three panes left of the column, 40 % of the tab's width
when it is made. A column made by an older version
without the strip is made again with it by `/activity`. The strip holds: **Files** (branch, ahead/behind, counts, every changed path),
**Branches** (local branches, newest first, ahead/behind or gone) and **Commits** (the
graph, unpushed shas red, refs, age), about 40 / 20 / 40 % of the height. Read-only: up/down,
j/k, PgUp/PgDn, the wheel and a click move the selection, `q` closes a pane (`/activity`
makes it again). The viewers poll git themselves (`viewer/gitdata.mjs`, no feed file):
Files every 2 s, Branches and Commits when `.git/HEAD`, `refs`, `packed-refs` or
`logs/HEAD` change, always `git --no-optional-locks` with an argument array, never a
shell, so they never take `index.lock`.

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
pty (Python), the viewers' drawing and the git parsing (`node --test`), and the hooks module with
herdr mocked (`claude plugin test`).
