# REPORT — monitor (agent monitor TUI + window placement + `/mods:monitor`)

## Files created

- `monitor/hooks/emit.py` (executable, Python stdlib) — one hook script, `argv[1]` = event kind, uses `lib/events.py`. Also auto-opens the monitor (`CLAUDE_MODS_MONITOR_AUTO=1`) and closes it on `SessionEnd` of the session that opened it.
- `monitor/monitor.py` (executable) — Textual TUI: Agents tab (DataTable + totals line), Graph tab (custom widget, 10 fps pulses). Tails the event log, rotates it at 20 MB, orphan check every 5 s, PID file.
- `monitor/monitor.sh` (executable, bash 3.2) — `open [session_id] | close | toggle | status`; backend from `lib/termcap.sh`.
- `monitor/applescript/ghostty_open.applescript`, `ghostty_close.applescript`, `terminal_open.applescript`, `terminal_close.applescript`, `screen.js` (JXA, `NSScreen`) — all take arguments via `on run argv` / `run(argv)`.
- `monitor/test.sh` (executable), `monitor/test_tui.py` — 65 offline checks, about 6 s.
- `monitor/README.md`, `monitor/REPORT.md`.
- `skills/monitor/SKILL.md` — `/mods:monitor [open|close|toggle|status]`.
- `lib/events.sh`, `lib/events.py`: owned by me, left unchanged (function names and fixed fields kept). Two new `event` values are written: `session_end` (SessionEnd) and `tool_end` with `status: failed` (PostToolUseFailure); CONVENTIONS.md's vocabulary list could add `session_end` (orchestrator file, not edited).

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

.mcp.json: none. settings.json: none required. Optional `env`:

| Variable | Effect |
| :- | :- |
| `CLAUDE_MODS_DISABLE=monitor` | hooks write nothing (`/mods:monitor` itself still works) |
| `CLAUDE_MODS_MONITOR_AUTO=1` | PreToolUse `Agent` hook opens the monitor when none is running (PID file check); SessionEnd of that session closes it |
| `CLAUDE_MODS_EVENT_LOG=<path>` | event log location (shared with `lib/events.py`; PID/meta files live next to it) |

Event records written (fixed fields from `lib/events.py` plus): `agent_start` from PreToolUse Agent carries `description`, `agent_type`, `tool_use_id`, `task` (120 chars), `parent_agent_id` (the spawning agent, null for the main session) and `agent_id: null`; `agent_start` from SubagentStart carries `agent_id`/`agent_type`; `tool_end` carries `tool`, `duration_ms`, `tool_use_id`, `agent_id` (null in the main session) and `to` for `SendMessage`; `agent_stop` carries `agent_transcript_path` and `tokens` `{input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens}` summed once per `message.id` (the transcript repeats a message per content block), 2 s cap. The monitor joins SubagentStart to the oldest pending PreToolUse Agent record of the same session (order-based). The main session's cost is not available to hooks; the status line shows it.

## Tests run

This build session runs under `TERM_PROGRAM=herdr`; no real Terminal.app or Ghostty window was opened. "Both terminals" = `bash monitor/test.sh`, whose TUI part runs `test_tui.py` headless (`App.run_test(size=(100, 30))`) under `TERM_PROGRAM=Apple_Terminal TERM=xterm-256color` (COLORTERM unset) and `TERM_PROGRAM=ghostty TERM=xterm-ghostty COLORTERM=truecolor`, and whose `monitor.sh` part uses fake `osascript` and `tmux` binaries on `PATH` plus `TERM_PROGRAM`/`TMUX` overrides. AppleScript grammar was checked with `osacompile` (loads the dictionaries, runs nothing). `screen.js` was run for real (JXA `NSScreen`, no permission, no window).

`bash ~/claude-mods/monitor/test.sh` (5.4 s wall; blank graph rows trimmed here):

```
# 1. hooks
ok   - session_start event
ok   - session_start keeps session_id
ok   - hooks print nothing on stdout
ok   - PreToolUse Agent -> agent_start
ok   -   agent_id is null (not yet known)
ok   -   spawner recorded as parent_agent_id
ok   -   agent_type from subagent_type
ok   -   description
ok   -   task is first 120 chars of prompt
ok   -   tool_use_id
ok   - SubagentStart -> agent_start with agent_id
ok   - PostToolUse -> tool_end
ok   -   tool
ok   -   main session agent_id null
ok   -   duration_ms
ok   -   status done
ok   -   no tool_input leaked
ok   - SendMessage records to
ok   -   sender agent_id
ok   - PostToolUseFailure -> tool_end failed
ok   -   tool
ok   -   error text not logged
ok   - SubagentStop -> agent_stop
ok   -   tokens summed once per message id
ok   -   last_assistant_message not logged
ok   -   missing transcript -> no tokens field
ok   - Stop -> session_stop
ok   - SessionEnd -> session_end
ok   -   reason
ok   - disabled via CLAUDE_MODS_DISABLE -> no line
ok   - empty stdin -> exit 0, no line
ok   - bad JSON -> exit 0
     session_start   14.0 ms avg of 10
     agent_start     14.0 ms avg of 10
     tool_end        13.9 ms avg of 10
     tool_fail       14.7 ms avg of 10
     agent_stop      14.2 ms avg of 10
     session_stop    13.9 ms avg of 10
     session_end     15.4 ms avg of 10
ok   - every hook kind < 50 ms (worst 15.4 ms)
# fakes for monitor.sh (nothing real is opened)
# auto-open handshake: PreToolUse Agent opens, SessionEnd closes
ok   - monitor.json written by detached monitor.sh open
ok   - tmux split-window received the monitor command
ok   - SessionEnd of another session leaves the monitor alone
ok   - SessionEnd closes the auto-opened monitor
ok   - tmux kill-pane %7
# 2. TUI headless, both terminal env sets
ok   - TUI under TERM_PROGRAM=Apple_Terminal TERM=xterm-256color
     |                    ╭─[Explore·a1a1]  ●┄╮
     |                    │                   ┆
     | [main session]●────┴●[general-purpose┄┄╯
     |                      [Plan·u_a3]
     | ─ spawn  ┄ message  ● activity
ok   - TUI under TERM_PROGRAM=ghostty TERM=xterm-ghostty COLORTERM=truecolor
     |                    ╭─[Explore·a1a1]  ●┄╮
     |                    │                   ┆
     | [main session]●────┴●[general-purpose┄┄╯
     |                      [Plan·u_a3]
     | ─ spawn  ┄ message  ● activity
# 3. monitor.sh backends
ok   - tmux wins over TERM_PROGRAM
ok   -   meta
ok   -   status without pid
ok   -   close kills the pane
ok   -   meta removed
ok   - ghostty backend
ok   -   osascript got script path + shell: command as argv
ok   -   close passes kind + id
ok   - apple_terminal backend
ok   -   screen size via JXA
ok   -   terminal_open got command + 4 screen numbers
ok   -   close passes window id
ok   - unknown terminal falls back to Terminal.app and says so
ok   - status with stale pid file
ok   - close with stale pid file
ok   -   stale pid file removed
ok   - toggle with nothing running opens
ok   - status with live pid
ok   - open while running is a no-op
ok   - bad argument -> usage, exit 2
# AppleScript grammar (compile only, nothing runs)
ok   -   terminal_open.applescript compiles
ok   -   terminal_close.applescript compiles
ok   -   ghostty_open.applescript compiles against Ghostty.sdef
ok   -   ghostty_close.applescript compiles against Ghostty.sdef
ok   -   screen.js returns 4 integers (0 33 1728 1034)
# 65 passed, 0 failed
```

The TUI test asserts: 4 table rows (main + 3 agents: one running, one done showing `20.0k/0.5k` tokens, one failed spawn), the status cells, totals line, at least one solid and one dashed edge character in the graph, both `SendMessage` edges, `a` toggling without error. The first `uv run` of the session downloaded Textual 1.0.0 (the `<2` pin) into the uv cache; the tests then ran offline. `claude plugin validate ~/claude-mods/skills` passes.

## Needs from user

- `uv` (present). First `open` downloads Textual once (network).
- macOS Automation permission: on first `open`, allow your terminal to control "Ghostty" or "Terminal" (dialog text in README). Cannot be pre-granted from a script.
- Nice to have via Homebrew: `tmux` (then the monitor is a pane of the same window in any terminal).
- End-to-end check in a real Terminal.app and Ghostty window (orchestrator): the exact Ghostty `split` behaviour and the Terminal.app bounds maths were compile-checked, not executed. `osacompile` checks terminology, not that a property sits on the right class (it accepted `number of columns of <window>`; Terminal.sdef puts it on `tab`, fixed to `selected tab of mainWin` after reading the sdef). Unverified until a real run: that Ghostty's `new surface configuration` record accepts `set command of`; the script retries with a record literal `{command:cmd, wait after command:false}` (also compiles) before falling back to `new window`.

## Terminal.app vs Ghostty differences

- Ghostty: real split surface to the right (`split ... direction right with configuration {command: "shell:<cmd>", wait after command: false}`); `shell:` prefix makes Ghostty wrap the string in `/bin/sh -c` (Ghostty >= 1.2, per its own config docs). Falls back to `new window with configuration` when there is no front window; `close` dispatches on the stored `terminal:<id>` / `window:<id>`. Truecolor.
- Terminal.app: no scriptable splits, so a second window titled "Claude agents", same height, placed right of the front window; shrinks the front window to the left half when < 60 columns are free. Runs at 256 colours (`TEXTUAL_COLOR_SYSTEM=256` because `termcap` reports no truecolor for Apple_Terminal). Window closes itself on `q` (`; exit` appended to `do script`).
- tmux (either terminal): `split-window -h -l 45%`, no Automation permission.
- Other/unknown terminals (herdr, vscode, iterm2): Terminal.app path, and `open` says so.

## Known limitations

- Agent to spawn-record correlation is by order within the session (spec). Parallel spawns whose SubagentStart events arrive out of order get each other's description. The Agent tool's `tool_response` contains the `agentId` and could make this exact later.
- `failed` status for an agent only comes from a failed `Agent` tool call (PostToolUseFailure) or an `agent_stop` record with `status: failed`; Claude Code's SubagentStop does not report failure, so a crashed subagent shows as `done`.
- The main session row shows `done` after each `Stop` and `running` again on its next tool call; its elapsed column is the session uptime (not frozen).
- The Graph tab always shows the most recent session, even in `a` (all sessions) mode; edges to unknown agent ids (SendMessage to an agent the log never saw start) are counted in the table but not drawn.
- Lines may pass behind labels when a message route crosses the agent column; labels always win, pulses never draw over labels.
- `monitor.py` uses only Unicode box drawing (no Nerd glyphs regardless of `termcap.nerdfont`); no ASCII fallback for non-UTF-8 locales.
- Paths containing a single quote break the shell command handed to the terminal (`cd '<repo>/monitor'`).
- Hook timing: ~14 ms per call here (Python startup ~10 ms); `agent_stop` on a large transcript may take longer, capped at 2 s.
- `${CLAUDE_PLUGIN_ROOT}` in the skill's `allowed-tools` follows the spec; if the CLI does not substitute it there, the user gets a normal permission prompt for `monitor.sh` instead of a pre-approval.
- Textual pinned `>=0.80,<2` as specified (resolves to 1.0.0); newer Textual majors were not tested.

## Security notes

No shell interpolation of user data: `subprocess.Popen([...])`, AppleScript arguments via `on run argv`, tmux command as a single argument. Event log 0700/0600 via `lib/events.py`; PID file 0600. Hooks never read tool inputs beyond `SendMessage.to`, never log error text or `last_assistant_message`.
