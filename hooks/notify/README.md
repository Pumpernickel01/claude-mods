# notify — desktop notification when Claude is done or needs you

One stdlib Python hook, `notify.py`, wired to two events:

- `Stop` → "Finished"
- `Notification` → a short label by type: `permission_prompt` "Needs permission",
  `idle_prompt` "Waiting for you", `agent_needs_input` "Agent needs input",
  `agent_completed` "Agent finished"; any other type shows the notification's
  `title` or the first 80 characters of its `message`.

Every notification is: title **Claude Code**, subtitle = project name (git
toplevel basename, else basename of `cwd`), body = the label above. Nothing
else: no prompt text, no file contents, no paths (see `SECURITY.md`).

Not fired for `auth_success`, `elicitation_*`, `quota_*`, `plugin_notification`.
Rate limit: at most one notification per session every 2 s (marker file mtime
in `~/.cache/claude-mods/notify/`). Always exits 0; a Stop with
`stop_hook_active: true` still notifies but never blocks.

## Install (hooks.json)

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

## Delivery, in order

1. `terminal-notifier` on PATH → `-title/-subtitle/-message -group claude-code-<session_id>`
   plus `-activate <bundle id>` so **clicking the notification focuses your terminal**:
   `com.apple.Terminal`, `com.mitchellh.ghostty`, `com.googlecode.iterm2`,
   `com.microsoft.VSCode` (omitted for unknown terminals). Recommended:
   `brew install terminal-notifier`.
2. Otherwise on macOS → `osascript` `display notification`. Strings are passed as
   `argv`, never interpolated into the script. **A plain osascript notification
   cannot focus the terminal on click** — that is the reason to install
   terminal-notifier.
3. In Ghostty, *in addition* to 1 or 2, the hook prints `{"terminalSequence":
   "\e]777;notify;Claude Code: <project>;<body>\e\\"}` and Claude Code writes
   the OSC 777 sequence to the terminal. Ghostty shows it as a native macOS
   notification **only while the window is unfocused** (its default
   `desktop-notifications = true`), and clicking it focuses the Ghostty window
   natively.
4. Linux → `notify-send` if present, else nothing.

## Terminal.app vs Ghostty

| | Terminal.app | Ghostty |
|-|-|-|
| macOS notification | via terminal-notifier or osascript | via terminal-notifier or osascript |
| Native terminal notification (OSC 777) | no (Terminal.app ignores it; nothing is emitted) | yes, additionally; shown only when unfocused |
| Click focuses terminal | only with terminal-notifier | with terminal-notifier, and natively for the OSC 777 one |

With terminal-notifier installed, Ghostty users may get two popups for one event
(macOS one + Ghostty's own) when the window is unfocused. If that bothers you,
set `desktop-notifications = false` in Ghostty's config.

## macOS permission (first run)

macOS asks once whether to allow notifications. The sender is **"Script Editor"**
for the osascript path or **"terminal-notifier"** for the Homebrew tool. If you
dismissed the dialog: System Settings → Notifications → find that app → Allow
Notifications. Also check Focus / Do Not Disturb is not hiding them.

## Disable

Add `notify` to `CLAUDE_MODS_DISABLE` in settings.json `env`
(comma-separated, e.g. `"CLAUDE_MODS_DISABLE": "notify"`).

## Test

`bash hooks/notify/test.sh` — offline, < 1 s. Fake `terminal-notifier` and
`osascript` scripts on PATH record their argv; Terminal.app and Ghostty are
simulated with `TERM_PROGRAM`/`TERM` overrides. No real notification is fired.
