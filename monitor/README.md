# Agent monitor

A live view of every agent and subagent of your Claude Code session. This folder
holds the half that records: `hooks/emit.py`, wired in `hooks/hooks.json`, appends
one event per agent start, tool call, agent stop and session change to
`~/.claude/agent-monitor/events.jsonl`.

The half that draws is the **Shell** pane of the herdr column beside Claude,
made by the user-level mod `~/.claude/mods/activity-pane` (its
`viewer/shell_tabs.py`). That pane runs your shell and has two more views:

- **Agents**: one row per agent plus one for the main session: type, status
  (running / done / failed, coloured), live elapsed, tool calls, task, last tool,
  tokens in/out (agents only), start time; a totals line at the bottom.
- **Agent graph**: main session on the left, agents in a column (grid when tall)
  to the right. Solid lines = spawn edges, dashed = `SendMessage` edges. A dot
  runs along an edge for about a second whenever it carries an event.

Shift+Tab in the shell opens Agents; there Tab cycles Agents → Agent graph →
Shell, Shift+Tab goes back one, Esc or q returns to the shell. See
activity-pane for the rest.

## Data and privacy

Records carry session and agent ids, tool names, durations, the agent's
`description` and the first 120 characters of its prompt (`task`), the
`SendMessage` recipient id and token counts. Tool inputs, outputs, error texts
and message bodies are never logged. The directory is 0700, the file 0600, and
`lib/events.py` rotates it to `events.jsonl.1` when it passes 20 MB.

The main session's own cost and tokens are not available to hooks; the status
line shows them. Agent tokens are summed from each subagent's transcript when it
stops (`input + cache read + cache creation` as "in", `output` as "out").

## Disable

Add `monitor` to `CLAUDE_MODS_DISABLE` in settings.json `env`
(`"CLAUDE_MODS_DISABLE": "monitor"`). No events are written; the Agents views
stay empty.

## Tests

`bash monitor/test.sh` (offline, a few seconds): hook stdin for every event kind,
timing (< 50 ms each), the disable switch. The views are tested in activity-pane
(`python3 viewer/shell_tabs_test.py`).
