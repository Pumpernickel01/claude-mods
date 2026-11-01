# hud

A browser page that shows the current Claude Code session live: the main
session in the middle, every agent it spawns around it, curved edges with dots
flowing along them while an agent runs (back to its parent as it returns, and
along dashed edges for `SendMessage`), nodes that glow while live, grow with the
tokens they used and fade when finished. Around the graph, a ring of
destinations: the files, hosts and MCP servers tool calls reach, with a dot
flying from the agent to each one it touches. The tool an agent just used
flashes above it; a bright pulse races back to the parent when an agent
finishes; your prompt appears as a bubble at the main node; notifications
(permission needed, waiting for you, Claude finished) arrive as toasts, and a
click on one brings the terminal to the front. A status strip at the top shows
thinking / idle, or listening / speaking when a voice front end logs a `state`
record. A timeline at the bottom scrubs back through the session; LIVE (or `l`)
returns. Sounds: a tick per tool call, a chime when an agent finishes, a low
tone on failure. They stay off until the first click or key; `m` mutes.

Keys and mouse: drag a node to move it (it stays pinned, a yellow dot marks it;
double-click unpins), `c` clears finished agents, `f` toggles a label-free
full-screen mode for a monitor across the room. Many finished siblings fold
into one dashed node, as the terminal graph folds them. The side panel's
sections collapse on click; the tool ticker shows 15 rows and expands.

It is the same data and the same model as the Shell pane's Agents views in
`../activity-pane` (`model.mjs` is a port of the classes in
`viewer/shell_tabs.py`), drawn on a canvas instead of terminal cells, so lines
curve, overlap cleanly and animate at the display's frame rate.

## Run

It starts itself: the `mods` plugin's SessionStart hook runs `launch.py`, which
starts the server once (detached) and opens the page the first time. Disable
with `hud` in `CLAUDE_MODS_DISABLE`; `CLAUDE_MODS_HUD_PORT` changes the port.
The look is a terminal's: one monospace face, panels with titled borders, a
status line, two accents with a meaning (blue-gray for the machine's work,
amber for your words and Jarvis's voice), no glow, no icons.
By hand:

```
python3 ~/claude-mods/hud/serve.py --open      # http://127.0.0.1:7431/
```

`--port N` picks another port. The server listens on localhost only: the log
holds working-directory paths, transcript paths and the first 120 characters of
each agent's prompt. It reads `~/.claude/agent-monitor/events.jsonl`, written by
the `mods` plugin's monitor hooks (`../monitor`), or the file named by
`CLAUDE_MODS_EVENT_LOG`. The page shows the session with the newest event;
`?session=<id>` pins one. Needs `python3` (stdlib only) and a browser.

## "Hey Claude": always listening, and talking to Jarvis

`bin/hud listen --install` makes the listener a login item (a launchd agent,
restarted if it dies), so it is always on, like a phone's assistant.
`hud/listen.swift` is built once with the Swift compiler from the Command Line
Tools into `~/Applications/Claude HUD Listener.app` (a real app, so macOS can
name it in the permission dialogs and remember the answer; a bare binary
started at login is refused without asking) and uses Apple's on-device
speech recognition: nothing is sent anywhere
and nothing is kept until it hears "Hey Claude". The first time it runs, macOS
asks for the microphone and for speech recognition; allow both. If you
refused once, flip the switches in System Settings › Privacy & Security: the
listener checks every 30 seconds and starts on its own.
`bin/hud listen --uninstall` removes it; `bin/hud listen` runs it once by hand.

On "Hey Claude": the HUD fades in over the whole screen in wake mode (the graph
dims, a level meter, your words as they are heard with a block cursor), and
what you said goes to Jarvis. This is a native window of the listener app
showing the same page, not Chrome: it opens over whatever is in front, full-screen
apps too, without a Space of its own, and takes the keyboard while that app stays
active. The answer is typed out on screen and read aloud. For eight seconds
after the answer the next sentence needs no wake word, so a conversation flows.
Say only "Hey Claude" and the wake screen opens with its input focused so you
can type instead; `/` focuses it any time. Esc, "cancel", or 20 seconds of quiet
with nothing half typed fades the window out and the keyboard goes back to where
it was. One conversation continues for as long as the server runs.

Pauses and cancelling: a pause of 3.5 seconds ends a sentence; the wake screen
then shows *sending…* for 2.5 seconds, during which more words continue the
sentence and "cancel", "wait", "stop" or "never mind" drops it. A question may
run 30 seconds in all. While Jarvis thinks or speaks, saying "cancel" or
"stop", or pressing esc on the wake screen, stops the running call and the
voice. The timings live in `~/.config/claude-hud/listen.conf`, one per line:
`pause=3.5`, `grace=2.5`, `max=30`, `followup=8`.

`"~/Applications/Claude HUD Listener.app/Contents/MacOS/listen" --window` fades
the window in and out once;
`--text "hey claude what time is it" --dry-run` runs the wake handler without
a microphone.

What it costs and does: every ask is a headless Claude call that loads your
whole plugin stack, about $0.35 per question at the default model on this
setup, resumed or not. `CLAUDE_HUD_MODEL` picks a cheaper model. The call runs
with default permissions in your home directory: it answers and reads, it
cannot run commands or edit files, so "open Spotify" needs the planned
mac-operator agent, not this. Its events land in the log like any session's,
so the HUD follows Jarvis's work while it answers and returns to your
terminal session when it ends. English only; speech from a video in the room
can trigger it; there is no speaker verification.

## Docked beside the terminal

```
bin/hud            # toggle: open the docked window, or close it
bin/hud open       # open or refocus it
bin/hud big        # full screen, label-free, for a monitor across the room
bin/hud close
```

`hud/dock.py`: Chrome in app mode (no tabs, no address bar) in its own
profile, so it is a separate process the command can close again, sized as a
column on the right of the main display. `CLAUDE_HUD_DOCK` is `right`, `left`
or `x,y,w,h`; `CLAUDE_HUD_FRACTION` the share of the width (0.38);
`CLAUDE_HUD_BROWSER` another Chromium-based app. With `CLAUDE_HUD_DOCK` set in
your shell, a session's first open is the docked window instead of a tab.
Ghostty's keybinds cannot run commands, so for a hotkey make a macOS Shortcut
with a **Run Shell Script** action (`python3 ~/claude-mods/hud/dock.py toggle`)
and give it a keyboard shortcut; it then works in any app.

## Limits

- Whole log replayed on every page load (fast under the 20 MB rotation).
- With two sessions running, the page follows whichever logged last.
- A shell command that reaches several hosts shows the first.
- Tokens are known when an agent stops, not while it runs.
- `POST /ask` and `POST /state` need a token the server makes for each run and
  writes to `~/.cache/claude-hud/token` (0600); the page gets it inline, the
  listener reads the file. It guards against cross-site
  request forgery; it is not a local login, since any program on this Mac
  can run `claude` itself.
- `POST /focus` only activates the terminal app the hook started the server
  from (`TERM_PROGRAM`); started by hand from elsewhere, it does nothing.

## Tests

`bash hud/test.sh`: the model under `node --test` (spawn, rekey, failed spawn,
messages, targets, replay, fold, the real log), a server smoke test on a
temporary log, and the launcher against a running server.
