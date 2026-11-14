# claude-mods

A Claude Code plugin marketplace with one plugin, `mods` (hooks, two
subagents, a status line and a live agent monitor), plus six interface mods
that change Claude Code's own screen. Built for
macOS with Terminal.app and Ghostty as first-class terminals. Linux works
where it was cheap. Built and tested on Claude Code 2.1.310, macOS 26.6.

## Install

```
/plugin marketplace add Pumpernickel01/claude-mods
/plugin install mods@claude-mods
```

Then add the status line to `~/.claude/settings.json` (plugins cannot set it):

```json
{ "statusLine": { "type": "command",
    "command": "bash ~/.claude/plugins/marketplaces/claude-mods/statusline/statusline.sh" } }
```

On the development machine the marketplace is the local checkout, so the path
is `~/claude-mods/statusline/statusline.sh`. Restart Claude Code once.

The interface mods are separate folders. Clone the repo and list the ones you
want in `CLAUDE_CODE_PLUGIN_DIRS` (settings.json, under `"env"`, joined by `:`):

```
~/claude-mods/activity-pane:~/claude-mods/activity-status:~/claude-mods/session-band:~/claude-mods/gesture-vscode:~/claude-mods/model-guide:~/claude-mods/read-aloud
```

## What you get

Subagents are `mods:<name>`.

| Mod | What it does | Use | Disable |
| :-- | :-- | :-- | :-- |
| format-on-edit | Runs prettier / ruff / black / rustfmt / clang-format / gofmt / shfmt after Edit/Write when installed; suggests the install command once per session otherwise | automatic | `CLAUDE_MODS_DISABLE=format-on-edit` |
| command-guard | Denies `rm -rf` on `/`, `~`, `~/Library`, force-push to main/master, `diskutil erase*`, `dd` to disks, `chmod -R 777`, SIP/Gatekeeper changes, and reads/writes of `.env`, SSH keys, credential files and the keychain, with a reason Claude can act on | automatic | `CLAUDE_MODS_DISABLE=command-guard` |
| notify | macOS notification when Claude finishes or needs you (`terminal-notifier` if present so a click focuses the right terminal, else `osascript`) | automatic | `CLAUDE_MODS_DISABLE=notify` |
| test-gate | On Stop, detects and runs the project's test command (npm/pnpm/yarn/bun, pytest, cargo, go, make, swift) when the tree is dirty; tells Claude to keep fixing on failure; 120 s timeout | automatic | `CLAUDE_MODS_SKIP_TESTS=1` or `CLAUDE_MODS_DISABLE=test-gate` |
| session-context | Injects branch, `git status --short`, last 10 commits and TODO/FIXME counts at session start | automatic | `CLAUDE_MODS_DISABLE=session-context` |
| prompt-journal | Appends every prompt to `~/claude-journal/YYYY-MM-DD.md` (0600) | automatic | `CLAUDE_MODS_DISABLE=prompt-journal` |
| precompact-snapshot | Copies the transcript to `~/.claude/snapshots/` before compaction, prunes after 30 days | automatic | `CLAUDE_MODS_DISABLE=precompact-snapshot` |
| test-writer-guard | Enforces that the test-writer agent only writes test files and only runs test / read-only commands | automatic | `CLAUDE_MODS_DISABLE=test-writer-guard` |
| mods:test-writer | Writes and runs tests only (enforced by test-writer-guard) | `@agent-mods:test-writer` | delete `agents/test-writer.md` |
| mods:hardware-debugger | Serial/USB/device-log debugging on macOS (`/dev/cu.*`, `ioreg`, `system_profiler`, unified log) | `@agent-mods:hardware-debugger` | delete the file |
| statusline | Folder, model, git branch with dirty mark, context % (yellow > 60, red > 80), effort; < 50 ms | settings.json | remove `statusLine` or `CLAUDE_MODS_DISABLE=statusline` |
| monitor | Records every agent start, tool call (with the file, host or MCP server it reached) and stop, each prompt's first 120 characters and each notification's type to `~/.claude/agent-monitor/events.jsonl`; the herdr column's Shell pane (`activity-pane`) shows them as **Agents** (status, progress bar, elapsed, tool calls, tokens per agent) and **Agent graph** (animated spawn / message graph) | Shift+Tab in the Shell pane cycles Shell → Agents → Agent graph → Roster → Keepsake → Shell | `CLAUDE_MODS_DISABLE=monitor` |
| activity-pane | When Claude runs in herdr, a column beside it: Data flow, Shell (+ Agents, Agent graph, Roster: the agents in `~/.claude/agents` and what each does, Keepsake: `~/.claude/keepsake.md`), Tools. A separate function-hooks mod, see `activity-pane/README.md` | add the folder to `CLAUDE_CODE_PLUGIN_DIRS` | remove it from `CLAUDE_CODE_PLUGIN_DIRS` |
| read-aloud | A `▶ Read aloud` button above the prompt (and `/read`) that speaks Claude's last answer with the macOS voice (Lithuanian answers with the voice Ona); tables are read row by row, paths in words | click it or type `/read`; again to stop | remove it from `CLAUDE_CODE_PLUGIN_DIRS` |
| activity-status | A status line saying what Claude is doing right now | automatic | remove it from `CLAUDE_CODE_PLUGIN_DIRS` |
| session-band | A band above the prompt with the Spotify song playing and its controls; `/spotify` | automatic | remove it from `CLAUDE_CODE_PLUGIN_DIRS` |
| gesture-vscode | Point one finger up at the camera to open the session's folder in VS Code | automatic; asks for camera access once | remove it from `CLAUDE_CODE_PLUGIN_DIRS` |
| model-guide | A line above the prompt saying which model to use for which work; a click opens the full list | automatic | remove it from `CLAUDE_CODE_PLUGIN_DIRS` |
| terminals | `lib/termcap` detection, `show-image`, `termcheck`, docs for keybindings, SSH terminfo, rendering | `show-image <file>`, `termcheck` | nothing to disable |

`CLAUDE_MODS_DISABLE` takes a comma-separated list and goes in `settings.json`
under `"env"`.

## Terminal.app vs Ghostty

| | Terminal.app | Ghostty |
| :-- | :-- | :-- |
| Colours | 24-bit on macOS 26 (Terminal 2.15 build 464+), 256 before; detected automatically | 24-bit |
| Inline images (`show-image`) | `chafa` text-art if installed, else Quick Look; path always printed | Kitty graphics protocol in a split |
| Notifications | macOS notification | macOS notification plus Ghostty's own OSC 777 popup |
| Shift+Enter newline | works without setup; Option+Enter and `\`+Enter too | works without setup |
| SSH | nothing special | `xterm-ghostty` terminfo is missing on remote hosts: see `docs/terminals/ssh.md` |

Run `termcheck` in each terminal to verify colours, Unicode and box drawing.
Details and profile settings: `docs/terminals/`.

## macOS permissions and optional packages

- First `show-image --window` triggers the Automation
  prompt "Terminal/Ghostty wants to control Terminal/Ghostty"; allow it.
- First notification may ask to allow notifications from Script Editor or
  terminal-notifier.
- Optional Homebrew: `terminal-notifier` (click-to-focus), `tmux`, `chafa`
  (installed), formatters (`prettier`, `ruff`, `shfmt`, `rustfmt`, `go`).

## Security

See `SECURITY.md`. Short version: no secrets in the repo, hooks never read
credential files, nothing listens on a port, and the repo is signed with an SSH key. The post-quantum story is at the
transport: GitHub supports ML-KEM-768 hybrid key exchange, Apple's default
`ssh` does not prefer it, and `SECURITY.md` §3 shows the one-line fix.

## Layout and development

Every mod lives in its own folder with a `README.md`, `test.sh` and
`REPORT.md`. `CONVENTIONS.md` is the contract (bash 3.2, stdlib Python,
shared `lib/termcap` and `lib/events`), `FORMATS.md` is the verbatim format
reference from the Claude Code docs. Run all tests:

```
for t in hooks/*/test.sh lib/test_termcap.sh bin/test_*.sh monitor/test.sh statusline/test.sh activity-pane/test.sh; do bash "$t" >/dev/null && echo "ok $t" || echo "FAIL $t"; done
for m in activity-status session-band gesture-vscode model-guide read-aloud; do claude plugin test "$m"; done
```

MIT licensed.
