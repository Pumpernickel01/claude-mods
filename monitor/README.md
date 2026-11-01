# Agent monitor

A live view of every agent and subagent of your Claude Code session. This folder
holds the half that records: `hooks/emit.py`, wired in `hooks/hooks.json`, appends
one event per agent start, tool call, agent stop and session change to
`~/.claude/agent-monitor/events.jsonl`.

The half that draws is the **Shell** pane of the herdr column beside Claude,
made by the function-hooks mod `../activity-pane` (its
`viewer/shell_tabs.py`). That pane runs your shell and has two more views:

- **Agents**: the main session, then each agent the moment it is spawned
  (`starting`, then `running` with a spinner), sub-agents indented under the
  agent that spawned them: status, live elapsed, tool calls, task, last tool,
  tokens in/out, start time. Finished agents stay, greyed out (`done`, `✗ failed`,
  or `gone` when the session ended or restarted under them). Below, a
  **Communication** list: who started, messaged or answered whom, the newest
  highlighted. A totals line at the bottom.
- **Agent graph**: main session on the left, agents to the right as a tree.
  Solid lines = spawns, dashed = `SendMessage`. Dots stream continuously along
  every edge whose agents are talking now: parent to child while the child runs,
  back to the parent as it returns, sender to receiver for 8 s after a message.
  Idle edges and finished agents are grey.

Agents the log never saw start (forks Claude Code runs itself, such as
compaction) are left out. Messages sent to an agent's name find it: the
PreToolUse `Agent` record carries the `name` it was given.

Shift+Tab in the shell opens Agents; there Tab cycles Agents → Agent graph →
Shell, Shift+Tab goes back one, Esc or q returns to the shell. See
activity-pane for the rest.

## Data and privacy

Records carry session and agent ids, the working directory and transcript
paths, tool names, durations, the agent's
`description` and the first 120 characters of its prompt (`task`), the
`SendMessage` recipient id and token counts. A `tool_end` also carries where the
call reached (`target`, with `target_kind` file | host | mcp): the file path of a
Read/Edit/Write/Glob/Grep, the host of a WebFetch or of a shell command that
names one (URL, `user@host`, or the argument of ssh/curl/scp and the like), or
an MCP server's name. A `prompt` record keeps the first 120 characters of what
you typed; a `notification` record keeps only its type. Tool inputs (the full
command, file contents, search text), outputs, error texts and message bodies
are never logged. A `state` record from the HUD's Jarvis (listening, thinking,
speaking, idle) holds only that name and no session. The directory is 0700, the file 0600, and
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
