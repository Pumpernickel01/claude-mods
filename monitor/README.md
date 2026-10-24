# Agent monitor (`/mods:monitor`)

A live dashboard of every agent and subagent of your Claude Code session, in its
own terminal window placed to the RIGHT of the Claude Code window.

- **Agents tab**: one row per agent plus one for the main session: type, task,
  status (running / done / failed, coloured), start time, live elapsed, tool
  calls, last tool, tokens in/out (agents only). Footer: agents running / done /
  failed, total tool calls, known agent tokens, session uptime.
- **Graph tab**: main session on the left, agents in a column (grid when tall)
  to the right. Solid lines = spawn edges, dashed cyan = `SendMessage` edges. A
  dot runs along an edge for about a second whenever it carries an event
  (spawn: parent to child, message: sender to receiver, stop: child to parent).

Three parts: hooks that append events (`hooks/emit.py`), the Textual TUI
(`monitor.py`), and the window placement script (`monitor.sh`).

## Use

```
/mods:monitor            toggle (open if closed, close if open)
/mods:monitor open
/mods:monitor close
/mods:monitor status
```

Or directly: `~/.claude/plugins/.../monitor/monitor.sh open|close|toggle|status`.

Keys inside the monitor: `a` show all sessions / only the most recent, `q` quit.

Set `CLAUDE_MODS_MONITOR_AUTO=1` (settings.json `env`) and the monitor opens by
itself the first time a session spawns an agent, and closes again when that
session ends.

## Where the window goes

| You run Claude Code in | What `open` does |
| :- | :- |
| tmux (`$TMUX` set, any terminal) | `tmux split-window -h -l 45%` to the right; `close` kills that pane |
| Ghostty | AppleScript `split <focused terminal> direction right with configuration {command: ...}` from Ghostty's own dictionary (`Ghostty.sdef`). If there is no front window it falls back to `new window`. `close` closes that surface / window |
| Terminal.app | AppleScript `do script` opens a new window titled "Claude agents", same height as yours, to its right. When fewer than 60 columns fit on the right your window is first shrunk to the left half and the monitor takes the right half. Screen size comes from `NSScreen` via a JavaScript-for-Automation one-liner (no permission needed) and is taken from the display that holds your window, so multi-display setups work. A full-screen Terminal window cannot be resized by AppleScript: the monitor then opens as a half-width window behind it; leave full screen first |
| anything else (VS Code, iTerm2, wrappers) | Same as Terminal.app: a Terminal.app window is opened and `open` says so. The window it measures (and may shrink) is Terminal.app's own front window, not your editor; if Terminal.app was not running it starts with its default window first |

The monitor's command line is passed to tmux / AppleScript as an argument, never
spliced into script text. The window closes by itself when you press `q`
(Terminal.app: the shell exits; Ghostty: the surface's command ends; tmux: the
pane's command ends).

### macOS Automation prompt (first use only)

The first time `open` runs, macOS asks whether your terminal may control the
target application, for example:

> "Ghostty" wants access to control "Ghostty". Allowing control will provide
> access to documents and data in "Ghostty", and to perform actions within that app.

or the same with "Terminal". Click **Allow**. If you clicked Don't Allow, turn
it back on under System Settings > Privacy & Security > Automation, then run
`/mods:monitor open` again. Until it is allowed, `open` fails with an
AppleScript error (-1743) and nothing opens.

### First run downloads Textual

The TUI runs as `uv run --no-project --with 'textual>=0.80,<2' python monitor.py`.
`uv` fetches Textual into its cache on the first run (network needed once, a few
seconds); later runs are offline. Needs `uv` (`brew install uv`).

## Colours and fonts

Terminal detection comes from `lib/termcap.*`. In Terminal.app (no 24-bit
colour reported) the TUI is started with `TEXTUAL_COLOR_SYSTEM=256`; in Ghostty,
iTerm2 and other truecolor terminals Textual keeps full colour. The UI uses
plain Unicode box-drawing characters only, no Nerd Font glyphs.

## Data and privacy

Events go to `~/.claude/agent-monitor/events.jsonl` (directory 0700, file
0600) through the shared `lib/events.py`. Records carry session and agent ids,
tool names, durations, the agent's `description` and the first 120 characters
of its prompt (`task`), the `SendMessage` recipient id and token counts. Tool
inputs, outputs, error texts and message bodies are never logged. The monitor
rotates the file to `events.jsonl.1` when it passes 20 MB; nothing else
truncates it. The window/pane id lives in `monitor.json`, the TUI's pid in
`monitor.pid`, both in the same directory.

The main session's own cost and tokens are not available to hooks; the status
line shows them. Agent tokens are summed from each subagent's transcript when it
stops (`input + cache read + cache creation` as "in", `output` as "out").

## Disable

- Hooks: add `monitor` to `CLAUDE_MODS_DISABLE` in settings.json `env`
  (`"CLAUDE_MODS_DISABLE": "monitor"`). No events are written.
- Window: `/mods:monitor close`. Unset `CLAUDE_MODS_MONITOR_AUTO` to stop
  auto-opening.

## Terminal.app vs Ghostty

- Ghostty gets a real split pane inside your window: AppleScript `split ...
  direction right`, then the command is entered with `input text` plus a
  `send key "enter"` (Ghostty 1.3.1 ignores the `command` of a surface
  configuration, and pasted text alone stays on the prompt under bracketed
  paste). Terminal.app gets a second window (no scriptable splits).
- Terminal.app runs at 24-bit on macOS 26 and 256 colours on older releases
  (detected by `lib/termcap`); Ghostty at 24-bit.
- Both need the one-time Automation permission above; tmux needs none.

## Tests

`bash monitor/test.sh` (offline, about 6 s): hook stdin for every event kind
with timing (< 50 ms each), the TUI headless under `TERM_PROGRAM=Apple_Terminal
TERM=xterm-256color` and `TERM_PROGRAM=ghostty TERM=xterm-ghostty
COLORTERM=truecolor`, and `monitor.sh` against fake `osascript`/`tmux` binaries
(no window is opened). The AppleScript files are compile-checked with
`osacompile`. Real windows were not opened by the tests.
