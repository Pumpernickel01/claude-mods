# REPORT — hooks/notify

## Files created
- `hooks/notify/notify.py` (executable; Python 3 stdlib; uses `lib/termcap.py`)
- `hooks/notify/test.sh` (executable; offline; 30 assertions; ~0.8 s)
- `hooks/notify/README.md`
- `hooks/notify/REPORT.md`

## hooks.json / .mcp.json / settings.json snippets
hooks.json (merge into the `"hooks"` map; both events have no matcher):
```json
{
  "hooks": {
    "Stop": [
      { "hooks": [ { "type": "command", "command": "python3 \"${CLAUDE_PLUGIN_ROOT}/hooks/notify/notify.py\"", "timeout": 10 } ] }
    ],
    "Notification": [
      { "hooks": [ { "type": "command", "command": "python3 \"${CLAUDE_PLUGIN_ROOT}/hooks/notify/notify.py\"", "timeout": 10 } ] }
    ]
  }
}
```
.mcp.json: none. settings.json: none (disable via `"env": {"CLAUDE_MODS_DISABLE": "notify"}`).

## Tests run
This build session runs under `TERM_PROGRAM=herdr`; no real Terminal.app or
Ghostty window was opened. "Both terminals" = `bash test.sh` with env overrides
`TERM_PROGRAM=Apple_Terminal TERM=xterm-256color` and
`TERM_PROGRAM=ghostty TERM=xterm-ghostty COLORTERM=truecolor`. Real
terminal-notifier is not installed, so only the fake was exercised; the fake
osascript shadows the real one, so no real notification was fired.

`bash ~/claude-mods/hooks/notify/test.sh`:
```
# Terminal.app, Stop (payload carries last_assistant_message)
ok   - exit 0
ok   - terminal-notifier called
ok   - subtitle is project name
ok   - body is Finished
ok   - -activate com.apple.Terminal
ok   - no terminalSequence on stdout
ok   - last_assistant_message never leaks
# Ghostty, Notification permission_prompt
ok   - terminal-notifier called
ok   - body is Needs permission
ok   - raw message not forwarded
ok   - -activate com.mitchellh.ghostty
ok   - stdout is JSON with OSC 777 notify + project
# Ghostty, Stop with stop_hook_active true still notifies, never blocks
ok   - exit 0
ok   - no decision/block in output
ok   - OSC 777 emitted
# osascript fallback when terminal-notifier is absent
ok   - osascript called
ok   - script uses on run argv
ok   - project passed as argument
ok   - no terminalSequence in Terminal.app
# unmapped type: message truncated to 80 chars
ok   - first 80 chars kept
ok   - 81st char dropped
ok   - tail dropped
# skipped notification types
ok   - auth_success fires nothing
ok   - elicitation_* fires nothing
# rate limit: second call within 2 s for the same session is suppressed
ok   - first call fires
ok   - second call suppressed
ok   - marker lives under HOME/.cache/claude-mods/notify
# disable convention and empty stdin
ok   - CLAUDE_MODS_DISABLE=notify exits 0
ok   - disabled: silent
ok   - empty stdin exits 0 silently
ALL PASS
```
Manual spot check (real termcap, fake terminal-notifier, `TERM_PROGRAM=ghostty`,
cwd inside this repo) printed exactly:
`{"terminalSequence": "\u001b]777;notify;Claude Code: claude-mods;Waiting for you\u001b\\"}`
and the child's stdout was swallowed (DEVNULL), so hook stdout stays one JSON object.

## Needs from user
- Nice to have via Homebrew: `brew install terminal-notifier` (click-to-focus
  the terminal; without it osascript notifications cannot focus anything).
- macOS permission on first run: System Settings → Notifications → allow
  "Script Editor" (osascript path) or "terminal-notifier".
- Real-terminal end-to-end check by the orchestrator (see Known limitations).

## Terminal.app vs Ghostty differences
- Terminal.app: macOS notification via terminal-notifier or osascript only; no
  `terminalSequence` is emitted (it would be ignored anyway).
- Ghostty: same macOS notification **plus** `{"terminalSequence": OSC 777}`.
  Ghostty renders OSC 777 as a native notification only while its window is
  unfocused (`desktop-notifications = true` default, confirmed in
  `ghostty +show-config --default --docs`); clicking it focuses Ghostty natively.
  With terminal-notifier installed an unfocused Ghostty user can see two popups
  for one event; README documents `desktop-notifications = false` as the fix.
- Bundle ids for `-activate`: Terminal.app `com.apple.Terminal`, Ghostty
  `com.mitchellh.ghostty`, iTerm2 `com.googlecode.iterm2`, VS Code
  `com.microsoft.VSCode`; omitted for tmux/herdr/unknown.

## Known limitations
- Not verified in a real Terminal.app or Ghostty window, nor with a real
  terminal-notifier binary (not installed). Bundle ids are from the apps'
  Info.plist conventions, not re-read from disk here.
- Project name uses `git rev-parse --show-toplevel` (1 s timeout) and falls
  back to `basename(cwd)`; in a git worktree the subtitle is the worktree
  folder name.
- The rate limit suppresses both the macOS popup and the OSC 777 sequence;
  marker files in `~/.cache/claude-mods/notify/` are never cleaned up (one
  tiny empty file per session id).
- OSC 777 fields cannot contain `;`, so semicolons in the project name or body
  become `,` in the Ghostty-native popup only.
- OSC 777 is terminated with ST (`\x1b\\`). FORMATS §1.6 does not say which
  terminator Claude Code's `terminalSequence` filter passes through; Ghostty
  accepts both. If the native popup does not appear in the orchestrator's real
  Ghostty check, swapping `\x1b\\` for `\x07` (BEL) in `notify.py` is the
  one-character fallback.
- Does not append to the shared event log (`lib/events.py`); not in this
  mod's spec.

## Security notes
- Strings reach `osascript` and `terminal-notifier` as argv (`on run argv`, `--`
  before user strings); nothing is interpolated into script text.
- Control characters are stripped and text capped at 80 chars before it reaches
  argv or the OSC sequence. `session_id` is sanitized to `[A-Za-z0-9_-]` before
  becoming a marker filename. `~/.cache/claude-mods/notify/` is created `0700`.
- `last_assistant_message`, `message` for mapped types, transcript paths and
  `cwd` beyond its basename are never forwarded (asserted in test.sh).
