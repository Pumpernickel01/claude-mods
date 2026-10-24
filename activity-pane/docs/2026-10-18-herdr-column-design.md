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
  each), to `$TMPDIR/claude-activity/<herdr pane>.json` after each change,
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
