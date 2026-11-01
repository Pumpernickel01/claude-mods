# Activity column in herdr: design

2026-10-18. Parts 1 and 2 of three. Part 3 (traffic of the user's own projects:
Wi-Fi between microcontrollers, Bluetooth) is designed separately later.

## Why

The user builds things that talk to each other (microcontrollers over Wi-Fi,
Bluetooth devices) and works with Claude, which itself sends data to
outside services. They want one view beside Claude that shows who talks to whom
and what is sent, plus a normal shell for their own commands, plus the tool list
activity-pane already keeps.

## Goals

- When a Claude session runs inside herdr, a column opens to the right of
  Claude's pane, three panes stacked:
  1. **Data flow** (top, about 9 visible rows): a flow log, one line per
     transfer, newest at the bottom (mockup option A).
  2. **Shell** (middle, all remaining rows): a plain interactive shell in the
     session's folder. It is the main part, so it gets the most room.
  3. **Tools** (bottom, 4 visible rows plus a header): the tool calls
     activity-pane already tracks.
- The sizes are only where the panes start: herdr lets the user drag the borders.
- Both small sections scroll (mouse wheel, ↑/↓, j/k, PgUp/PgDn); End or G
  returns to following the newest line.
- In the flow log one line is selected (the newest, unless the user moved the
  selection). Under it: what was sent.
- Outside herdr the old Activity pane inside Claude is drawn, as before.

## Non-goals

- Commands the user types in the shell, and any traffic of the user's own
  programs: part 3.
- Background process runs of other mods (session-band asks Spotify every 5 s);
  they would flood the log.
- Wire-level byte counts for shell commands Claude runs: only the command and
  where it points are known.

## Anti-goals (a failure even if it works)

- Slowing, altering or breaking a model request. The per-request hook only
  forwards the stream and records after it settles; recording failures are
  swallowed.
- A second column on every hot reload (`session.start` fires again on reload).
- Panes so cramped they are useless.

## What each flow line holds

`time  from ▶ destination [LAN|local]  what  ↑sent ↓received`, and a detail line
under the selected one.

| Source | from | destination | sizes | detail |
| --- | --- | --- | --- | --- |
| each model request (`turn.step`'s usage) | Claude, or Subagent | api.anthropic.com | ↑ input + cache tokens, ↓ output tokens | how many messages of the conversation were sent, and the model |
| server-side tools in a response (web search) | Claude | web search (run by Anthropic) | none | the query |
| WebFetch | WebFetch | the URL's host | ↓ result size | the URL |
| WebSearch | WebSearch | web search (run by Anthropic) | ↓ result size | the query |
| MCP tool `mcp__<server>__<tool>` | the server's name (`claude_ai_Gmail` reads "Gmail") | the server; claude.ai connectors marked "via claude.ai" | ↑ arguments, ↓ result | the arguments, cut to one line |
| Bash | Bash | each host the command points at: URLs, `user@host`, ssh/scp/rsync/git/ping/nc/curl/wget targets, IPv4 addresses; `osascript … tell application "X"` reads X, local | none ("command only") | the command |

A destination is tagged LAN for 10/8, 172.16/12, 192.168/16, 169.254/16 and
`*.local`, and local for localhost and 127/8. Denied calls make no flow line;
failed ones still do (the data was sent).

## How it is made (the builder's calls)

- **Opening.** At `session.start`, when `HERDR_ENV=1`, `HERDR_PANE_ID` is set
  and the session is interactive: split Claude's pane right (Claude keeps half),
  then split the new pane down twice. herdr's `--ratio` is the share the
  original pane keeps, and each pane spends 2 rows on its frame. The ratios come
  from the tab's height so the top shows about 9 rows and the bottom 4 rows plus
  its header. Panes are renamed Data flow, Shell, Tools; focus stays on Claude.
  Their ids live in `$.store`, keyed by Claude's herdr pane, so a `/clear` or a
  resume (a new session id in the same process) keeps the same column. On a
  later `session.start` (a reload) the column is reused while its panes still
  exist (`herdr pane get`). `/activity` makes whatever is missing again: a quit
  viewer is put back beside the shell (the top one made below it and swapped
  above), and only a shell that is gone makes the whole column anew.
- **Only beside a wide pane, unasked.** At `session.start` the column opens by
  itself only when Claude's pane is at least 144 columns wide (where Claude Code
  seats a pane it opens unasked); a narrower pane keeps the Activity pane inside
  Claude, and `/activity` opens the column anyway.
- **Closing.** `session.end` closes the three panes (in parallel: its budget is
  short) when the process ends: `/exit`, ctrl+c or ctrl+d, logout, a signal.
  `/clear` and a resume keep them.
- **Feed.** The mod writes one JSON document, `{ calls, flows }` (last 500 of
  each), to `~/.claude/activity/<herdr pane>.json` (a folder made 0700) after each change,
  coalescing bursts. The viewers poll it and keep the last good copy when a read
  catches the file mid-write. It lives outside the mod folder so writes never
  hot-reload the mod.
- **Viewers.** Two Node scripts shipped in the mod (`viewer/flow.mjs`,
  `viewer/tools.mjs`; the drawing in `viewer/draw.mjs`, the terminal in
  `viewer/tui.mjs`; no dependencies), run in
  their panes with `exec node …`, so quitting a viewer (q) closes its pane.
  Catppuccin Mocha colors, as the pane already uses.
- **Tests.** `claude plugin test` with herdr mocked at `process.run`: the split
  sequence and ratios, reuse on reload, `/activity` remaking a missing pane, the
  fallback outside herdr, closing at the end, flow lines for each source. The
  viewers' drawing and scrolling are pure functions tested with `node --test`.

## Calls made without the user (check these)

- The column opens by itself in every Claude session in herdr whose pane is at
  least 144 columns wide, including ones already open when this ships (they
  reload the mod); in narrower ones `/activity` opens it.
- Leaving Claude closes the shell too, killing anything still running there;
  `/clear` does not.
- Plugin background processes are left out of the flow log.
- MCP destinations show the server's name, not the service's real host.

## Addendum 2026-10-24: Agents views in the Shell pane

The Shell pane now runs `viewer/shell_tabs.py` (`exec python3 … <feed>`, Python
stdlib), which runs the user's shell in a pty and passes it straight through.
Shift+Tab (the user chose it over Ctrl+]; it gives up zsh's reverse
menu-complete) opens **Agents**; there Tab cycles Agents → Agent graph → Shell,
Shift+Tab goes back one, Esc or q returns. Views draw on the alternate screen,
so the shell's screen comes back untouched; its output meanwhile is held and
written on return. A full-screen program in the shell is asked to redraw
(SIGWINCH to the pty's foreground group) instead. herdr's pane title follows
the view. Agents come from `~/.claude/agent-monitor/events.jsonl`, written by
the claude-mods plugin's monitor hooks, for the session the feed now names
(`session`). A column made before this keeps its plain shell until the shell
pane is made again (or the command is run in it by hand).
Tests: `python3 viewer/shell_tabs_test.py` (views, and the wrapper in a real pty).

## Addendum 2026-10-24 (later): live Agents views

Agents shows a spawn at once (`starting`, from the PreToolUse `Agent` record),
joins it to its SubagentStart by agent type, indents sub-agents under their
parent, greys finished agents out instead of dropping them, retires agents
still live when the session ends or starts again (`gone`), and lists who
started, messaged or answered whom. Agent graph draws sub-agents as a tree and
streams dots along every edge whose agents talk now (parent to child while the
child runs, back as it returns, sender to receiver for 8 s after a message).
Views poll the log every redraw: 10 a second in the graph, 4 in the table.
Agents never seen starting (engine forks) are not shown. The feed moved from
`$TMPDIR` to `~/.claude/activity` (0700), and `tagOf` applies address ranges to
IPv4 addresses only, after a security review.

## Addendum 2026-10-24 (evening): Tab, scrolling, a graph that stays a tree, clear

After a test run of 10 agents each spawning 5 (only 20 can run at once, so 40
spawns failed), the user asked for four changes:

- **Tab cycles from the shell too:** Shell → Agents → Agent graph → Shell,
  Shift+Tab back one everywhere (from the shell that is now Agent graph). Tab
  switches only when it arrives alone in a read (a paste with a tab in it goes
  to the shell) and while the shell itself is the pty's foreground process
  group, so vim, a REPL or `claude` run in the shell keep their Tab. It gives
  up zsh's Tab completion at that pane's prompt; the user accepted that.
- **Scrolling:** arrows, PgUp/PgDn and the wheel scroll Agents and the graph
  when they are taller than the pane; a row tells where (`rows 1–6 of 61`).
  Views turn on SGR mouse reports (1000 + 1006) for the wheel and hand the mode
  back on return as the shell's program last set it. This replaces the old
  overflow rule (main + live + newest finished), so at the top of a long table
  a just-spawned agent can be below the fold.
- **The graph stays one tree:** agents in a single column, sub-agents indented
  under their parent, never wrapped into further columns (the wrap broke spawn
  edges across columns). Taller than the pane, finished sibling leaves fold
  into one node per parent and status (`[✗ 5 failed]`, `[5 done]`); live or
  talking agents never fold. Still too tall, it scrolls with the main session
  at the top. Names are cut in the middle so the id tail stays readable
  (`general-purpo…·7552`), and graph labels got 24 cells.
- **`c` clears finished agents** (done, failed, gone) and the exchanges they
  were in from both views; a live agent whose parent is cleared moves under
  main. It lasts until the pane restarts and re-reads the log.

## Addendum 2026-10-24 (night): the graph scatters around a centred main

The single column from the evening addendum clustered a session with many
agents into one tall stripe. The graph now works like Obsidian's graph view:
the main session sits in the middle of the pane, each agent lands on a ring
around it at an angle seeded from its spawn time (`zlib.crc32`, so a node
keeps its place from frame to frame and across restarts), and every
sub-agent lands on a tighter ring around the agent that spawned it. A taken
spot steps on by the golden angle, every eighth try one ring further out, so
siblings spawned together fan out instead of piling up. Edges are straight
Bresenham lines (`─ │ ╱ ╲`), messages drawn every other cell for the dashed
look, and the dots stream along them as before. Folding now triggers on
capacity (labels on every other row) rather than column height, and a graph
that still does not fit grows downward and scrolls with main in the first
screen.

## Addendum 2026-10-24 (late): a left-to-right tree with box-drawing elbows

Testing the scatter with 10 agents and their sub-agents, the user found the
edges jagged and the lines and labels crossing one another. Both come from the
scatter itself: a straight line between two arbitrary cells can only stair-step
on a character grid, and rings around a hub put labels in each other's way.
The graph is now a layered tree. The main session sits at the left, its agents
in a column `GAP` (4) cells to its right, every sub-agent in the column after
the agent that spawned it; leaves take rows top to bottom in spawn order (a
blank row between them while they fit) and a parent sits level with the middle
of its children, so a label never shares a cell with another. Edges are
orthogonal: a parent's stub runs into one bus two cells before its children's
column, which branches into each child (`╭ ├ ╰`, `┼` where a child is level
with the parent). Each cell collects the directions of every edge through it
and a 16-entry table picks the glyph, so shared buses and honest crossings
render as junctions, never as overdrawn fragments. Messages run on the gutter
cell left of the spawn bus (or right of a column, for a receiver at the left or
in the same column), dashed on straight cells with corners kept; they can still
cross spawn edges, which shows as `┼`. The tree is centred in the pane when it
is smaller than it, folds finished sibling leaves when there are more leaves
than rows, and scrolls when still too tall. A deep tree in a narrow pane
squeezes label widths down to 8 cells. `Node.seed`, `zlib` and `math` left with
the scatter.

## Addendum 2026-10-24 (later): a force-directed graph with elbow edges

The left-to-right tree read to the user as the single column they had already
rejected. What they want is the Obsidian look, force-directed, with smooth
lines and no node overlapping another. `layout()` now runs Fruchterman-Reingold
once per change of node set or pane size (cached in `_layouts`): the main
session is pinned to the middle, every node starts on a ring around its parent
at an angle from `zlib.crc32` of its kind and spawn seed (`Node.seed` is
back), nodes repel by k²/d and spawn edges pull by d²/k, in a space where a
column is a seventh of a unit and a row half of one so a label is about a
round blob and k shares the area out evenly. Then each label, in spawn order,
takes the free row nearest the one the simulation gave it (rows in the view
first), so no two share columns on the same or the next row; the canvas grows and scrolls if the pane cannot hold them,
and an assert guards the no-overlap promise. Edges keep the direction-mask
renderer from the tree: a lying elbow through the gap between labels side by
side, a standing one through the rows between them otherwise, each choosing
the bus column or row that crosses the fewest label cells. Accepted: edges can
cross each other (`┼`) and may still pass under a label when every candidate
does; positions shift when an agent joins, as Obsidian's do.

## Addendum 2026-11-01: Roster and Keepsake in the Shell pane, Guide gone

Two memo views join the Shell pane's cycle, Agents → Agent graph → **Roster** →
**Keepsake** → Shell. Roster lists the subagents in `~/.claude/agents` and the
project's `.claude/agents` (frontmatter `name` and `description`, the later
folder winning a name), Keepsake shows `~/.claude/keepsake.md`. Both are
Markdown drawn by `md_rows` (stdlib `textwrap`), read at each redraw. They went
to the Shell pane, not the Tools pane, because a memo needs rows: Tools has
four. The Data flow pane's Guide tab was removed for the same reason; the file
`~/.claude/workflow-guide.md` is left where it is.
