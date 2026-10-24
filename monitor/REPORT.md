# REPORT — monitor (agent event hooks; views in the herdr Shell pane)

## Files

- `monitor/hooks/emit.py` (executable, Python stdlib) — one hook script, `argv[1]` = event kind, uses `lib/events.py`.
- `monitor/test.sh` — hook checks.
- `lib/events.py` — rotates the log at 20 MB.

The views live in the user-level mod `~/.claude/mods/activity-pane`: `viewer/shell_tabs.py` wraps the herdr column's Shell pane (Shift+Tab: Agents, Tab: Agent graph, back to Shell), reading this log for the session the column's feed names; tested by `viewer/shell_tabs_test.py`.

Replaced 2026-10-24: the Textual window (`monitor.py`, `monitor.sh`, AppleScript placement, `test_tui.py`, the `/mods:monitor` skill, `CLAUDE_MODS_MONITOR_AUTO`), then a Claude Code pane module (`monitor/register.tsx`) that could not show inside herdr. Both are in git history.

## hooks.json snippet (merge into the `"hooks"` map)

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [ { "type": "command", "command": "python3 \"${CLAUDE_PLUGIN_ROOT}/monitor/hooks/emit.py\" session_start", "timeout": 5 } ] }
    ],
    "PreToolUse": [
      { "matcher": "Agent", "hooks": [ { "type": "command", "command": "python3 \"${CLAUDE_PLUGIN_ROOT}/monitor/hooks/emit.py\" agent_start", "timeout": 5 } ] }
    ],
    "SubagentStart": [
      { "hooks": [ { "type": "command", "command": "python3 \"${CLAUDE_PLUGIN_ROOT}/monitor/hooks/emit.py\" agent_start", "timeout": 5 } ] }
    ],
    "PostToolUse": [
      { "matcher": "*", "hooks": [ { "type": "command", "command": "python3 \"${CLAUDE_PLUGIN_ROOT}/monitor/hooks/emit.py\" tool_end", "timeout": 5 } ] }
    ],
    "PostToolUseFailure": [
      { "matcher": "*", "hooks": [ { "type": "command", "command": "python3 \"${CLAUDE_PLUGIN_ROOT}/monitor/hooks/emit.py\" tool_fail", "timeout": 5 } ] }
    ],
    "SubagentStop": [
      { "hooks": [ { "type": "command", "command": "python3 \"${CLAUDE_PLUGIN_ROOT}/monitor/hooks/emit.py\" agent_stop", "timeout": 5 } ] }
    ],
    "Stop": [
      { "hooks": [ { "type": "command", "command": "python3 \"${CLAUDE_PLUGIN_ROOT}/monitor/hooks/emit.py\" session_stop", "timeout": 5 } ] }
    ],
    "SessionEnd": [
      { "hooks": [ { "type": "command", "command": "python3 \"${CLAUDE_PLUGIN_ROOT}/monitor/hooks/emit.py\" session_end", "timeout": 5 } ] }
    ]
  }
}
```

Stop / SubagentStop handlers never block (exit 0, no stdout) regardless of `stop_hook_active`.

Optional `env`:

| Variable | Effect |
| :- | :- |
| `CLAUDE_MODS_DISABLE=monitor` | hooks write nothing; the Agents views stay empty |
| `CLAUDE_MODS_EVENT_LOG=<path>` | event log location (shared by `lib/events.py` and `shell_tabs.py`) |

Event records written (fixed fields from `lib/events.py` plus): `agent_start` from PreToolUse Agent carries `description`, `agent_type`, `tool_use_id`, `task` (120 chars), `parent_agent_id` (the spawning agent, null for the main session) and `agent_id: null`; `agent_start` from SubagentStart carries `agent_id`/`agent_type`; `tool_end` carries `tool`, `duration_ms`, `tool_use_id`, `agent_id` (null in the main session) and `to` for `SendMessage`; `agent_stop` carries `agent_transcript_path` and `tokens` `{input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens}` summed once per `message.id` (the transcript repeats a message per content block), 2 s cap. The views join SubagentStart to the oldest pending PreToolUse Agent record of the session (order-based). The main session's cost is not available to hooks; the status line shows it.

## Tests run

`bash monitor/test.sh`: 33 passed, 0 failed. In activity-pane: `python3 viewer/shell_tabs_test.py` 5 passed (Python 3.12 and macOS's 3.9, including the wrapper in a real pty: Shift+Tab, Tab, Tab back, exit code), `claude plugin test` 14 passed, `tsc` clean.

## Known limitations

- Agent to spawn-record correlation is by order within the session. Parallel spawns whose SubagentStart events arrive out of order get each other's description.
- `failed` for an agent only comes from a failed `Agent` tool call or an `agent_stop` record with `status: failed`; SubagentStop does not report failure, so a crashed subagent shows as `done`.
- The main session row shows `done` after each `Stop` and `running` again on its next tool call.
- One session per view: the old "all sessions" (`a`) view is gone. Records rotated into `events.jsonl.1` are not read.
- Edges to agent ids the log never saw start are counted in the table but not drawn; pulses never draw over labels.
