# claude-mods

A Claude Code plugin marketplace with one plugin, `mods`: hooks, skills,
subagents, MCP servers, a status line and a live agent monitor, built for
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
First use of the MCP servers and the monitor downloads `mcp`, `psycopg`,
`pyserial` and `textual` into uv's cache (network, once). Nothing is installed
system-wide; `uv` must be on PATH.

## What you get

Skills are namespaced by the plugin: type `/mods:commit`, not `/commit`.
Subagents are `mods:<name>`. MCP tools are `mcp__plugin_mods_<server>__<tool>`.

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
| /mods:commit | Conventional Commit message from the staged diff, shown for approval before committing | type it | delete `skills/commit` |
| /mods:review | Read-only review of uncommitted changes: bugs, error handling, security, debug leftovers | type it | delete `skills/review` |
| /mods:explain-error | Paste an error; finds the cause, explains, proposes a fix, applies only on your OK | type it | delete `skills/explain-error` |
| /mods:changelog | Release notes since the last tag grouped by commit type | type it | delete `skills/changelog` |
| /mods:monitor | Open / close / toggle the agent monitor window | type it | delete `skills/monitor` |
| mods:test-writer | Writes and runs tests only (enforced by test-writer-guard) | `@agent-mods:test-writer` | delete `agents/test-writer.md` |
| mods:security-auditor | Read-only audit (Read/Glob/Grep only): injection, secrets, deserialization, path traversal, shell calls | `@agent-mods:security-auditor` | delete the file |
| mods:docs-updater | Syncs README, docstrings and comments with code changes | `@agent-mods:docs-updater` | delete the file |
| mods:hardware-debugger | Serial/USB/device-log debugging on macOS (`/dev/cu.*`, `ioreg`, `system_profiler`, unified log) | `@agent-mods:hardware-debugger` | delete the file |
| statusline | Model, git branch with dirty mark, context % (yellow > 60, red > 80), cost; < 50 ms | settings.json | remove `statusLine` or `CLAUDE_MODS_DISABLE=statusline` |
| scanner (MCP) | `get_status`, `read_config`, `scan`; mock by default, real serial transport is a documented stub | `/mcp` | remove from `.mcp.json` |
| local-docs (MCP) | `list_docs`, `search`, `read_doc` over PDFs/markdown/text in `DOCS_DIR` (default `~/Documents/datasheets`, created if missing) | `/mcp` | remove from `.mcp.json` |
| db-inspector (MCP) | Read-only SQLite (auto-detected) and PostgreSQL (`DB_INSPECTOR_URL`), enforced at the connection and by a statement filter | `/mcp` | remove from `.mcp.json` |
| monitor | Live TUI of agents and subagents (status, elapsed, tool calls, tokens) plus an animated communication graph, in a window to the right | `/mods:monitor open` | `CLAUDE_MODS_DISABLE=monitor` |
| terminals | `lib/termcap` detection, `show-image`, `termcheck`, docs for keybindings, SSH terminfo, rendering | `show-image <file>`, `termcheck` | nothing to disable |

`CLAUDE_MODS_DISABLE` takes a comma-separated list and goes in `settings.json`
under `"env"`.

## Terminal.app vs Ghostty

| | Terminal.app | Ghostty |
| :-- | :-- | :-- |
| Colours | 24-bit on macOS 26 (Terminal 2.15 build 464+), 256 before; detected automatically | 24-bit |
| Inline images (`show-image`) | `chafa` text-art if installed, else Quick Look; path always printed | Kitty graphics protocol in a split |
| Notifications | macOS notification | macOS notification plus Ghostty's own OSC 777 popup |
| Monitor window | AppleScript: new window placed right of the front window (main window shrinks to the left half on narrow screens) | AppleScript right split of the focused terminal; new window fallback |
| Shift+Enter newline | works without setup; Option+Enter and `\`+Enter too | works without setup |
| SSH | nothing special | `xterm-ghostty` terminfo is missing on remote hosts: see `docs/terminals/ssh.md` |

Inside tmux the monitor uses `tmux split-window -h` in both terminals.
Run `termcheck` in each terminal to verify colours, Unicode and box drawing.
Details and profile settings: `docs/terminals/`.

## macOS permissions and optional packages

- First `/mods:monitor open` or `show-image --window` triggers the Automation
  prompt "Terminal/Ghostty wants to control Terminal/Ghostty"; allow it.
- First notification may ask to allow notifications from Script Editor or
  terminal-notifier.
- Optional Homebrew: `terminal-notifier` (click-to-focus), `tmux`, `chafa`
  (installed), formatters (`prettier`, `ruff`, `shfmt`, `rustfmt`, `go`).

## Security

See `SECURITY.md`. Short version: no secrets in the repo, hooks never read
credential files, MCP servers are stdio-only, hardware access is mock-only
until explicitly enabled, database access is read-only at the connection,
and the repo is signed with an SSH key. The post-quantum story is at the
transport: GitHub supports ML-KEM-768 hybrid key exchange, Apple's default
`ssh` does not prefer it, and `SECURITY.md` §3 shows the one-line fix.

## Layout and development

Every mod lives in its own folder with a `README.md`, `test.sh` and
`REPORT.md`. `CONVENTIONS.md` is the contract (bash 3.2, stdlib Python,
shared `lib/termcap` and `lib/events`), `FORMATS.md` is the verbatim format
reference from the Claude Code docs. Run all tests:

```
for t in hooks/*/test.sh skills/*/test.sh lib/test_termcap.sh bin/test_*.sh monitor/test.sh; do bash "$t" >/dev/null && echo "ok $t" || echo "FAIL $t"; done
for d in mcp/*/; do (cd "$d" && uv run --quiet --with 'mcp>=1.10,<2' --with 'psycopg[binary]>=3.1,<4' --with 'pyserial>=3.5,<4' python -B -m unittest -q); done
```

MIT licensed.
