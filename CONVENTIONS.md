# CONVENTIONS — read this before writing anything

This repo is ONE Claude Code plugin (`claude-mods`) that is also its own
marketplace. Every mod lives in its own subfolder. Agents only touch their own
folder plus `REPORT.md` inside it. Shared files are orchestrator-only (below).

## Layout

```
claude-mods/
  .claude-plugin/plugin.json        orchestrator only
  .claude-plugin/marketplace.json   orchestrator only
  hooks/hooks.json                  orchestrator only (merged from REPORT.md snippets)
  .mcp.json                         orchestrator only (merged from REPORT.md snippets)
  lib/termcap.sh  lib/termcap.py    shared terminal detection (Agent 21 owns)
  lib/events.sh   lib/events.py     shared event log append (Agent 22 owns)
  hooks/<mod-name>/                 one folder per hook mod: script(s), test.sh, README.md, REPORT.md
  commands/<name>.md                slash commands (one file each)
  skills/<name>/SKILL.md            skills
  agents/<name>.md                  subagents
  statusline/                       status line script + tests
  mcp/<server-name>/                one folder per MCP server
  monitor/                          agent monitor event hooks (views: herdr Shell pane, ~/.claude/mods/activity-pane)
  docs/                             user-facing docs (terminal setup, permissions)
```

Exact formats for hooks/commands/skills/agents/statusline/MCP/plugin.json are in
`FORMATS.md` (copied from the official docs for Claude Code 2.1.310). Use those,
not memory.

## Language and dependencies

- Hooks: `#!/bin/bash` (must run on macOS bash 3.2) or `#!/usr/bin/env python3`
  (stdlib only, 3.9+). Anything that parses JSON, needs a timeout, or has more
  than ~30 lines of logic: use Python. Bash is for thin wrappers.
- No new dependencies unless the spec needs them. The one allowed exception:
  - MCP servers: `uv run --with mcp python server.py` (uv is installed; no
    system install).
  Pin versions with `--with 'pkg>=X,<Y'`.
- Formatters, `chafa`, `terminal-notifier`, `tmux` etc. are OPTIONAL: detect
  with `command -v`, degrade silently, and list them in REPORT.md as
  "nice to have via Homebrew". Never install anything. Never `sudo`.

## macOS first, Linux where cheap

- bash 3.2: no `declare -A`, no `mapfile`, no `${var,,}`, no `[[ -v ]]`.
- BSD tools: `sed -i ''` (not `sed -i`), `stat -f %m` (not `stat -c`),
  `date -v-30d` (not `date -d`). Prefer Python for date math and file stats.
- No `timeout` binary on macOS. Use Python `subprocess.run(timeout=...)`.
- `jq` exists on this Mac but not everywhere; prefer `python3 -c` for JSON.
- `osascript`, `qlmanage`, `open`, `ioreg`, `system_profiler` are macOS-only:
  guard with `[ "$(uname)" = Darwin ]` and no-op elsewhere.

## Hook contract

- Read stdin JSON once. Never hang: if stdin is empty, exit 0.
- Exit 0 = allow/continue. Exit 2 = block, with the reason on stderr. JSON
  decisions on stdout as per FORMATS.md. Any other failure: exit 0 and stay
  quiet (a broken hook must never break the user's session).
- Stop / SubagentStop hooks MUST return without blocking when
  `stop_hook_active` is true, or the session loops.
- Subagent tool matcher is `Agent` (verify in FORMATS.md). `PostToolUse` on
  `Agent` fires when a background agent is *launched*; completion comes from
  `SubagentStop`. Subagent hook stdin carries `agent_id` / `agent_type`; main
  session stdin does not.
- Reference your own files via `${CLAUDE_PLUGIN_ROOT}` in hooks.json snippets.
  Inside scripts, locate the repo root with
  `ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"`.
- Budget: hooks < 1 s typical; SessionStart < 2 s; status line < 100 ms.

## Disable convention (every mod, same way)

```bash
case ",${CLAUDE_MODS_DISABLE:-}," in *,<mod-name>,*) exit 0;; esac
```

Python: `if "<mod-name>" in os.environ.get("CLAUDE_MODS_DISABLE","").split(","): sys.exit(0)`.
`<mod-name>` is the folder name. READMEs say: "Disable: add `<mod-name>` to
`CLAUDE_MODS_DISABLE` in settings.json `env`." Extra per-mod switches
(e.g. `CLAUDE_MODS_SKIP_TESTS=1`) are fine when the spec asks.

## Shared terminal detection — `lib/termcap.sh` / `lib/termcap.py`

Source it; it only sets variables, never prints:

```bash
. "$ROOT/lib/termcap.sh"
# TC_TERMINAL   apple_terminal | ghostty | iterm2 | vscode | tmux | herdr | unknown
# TC_TRUECOLOR  1/0   24-bit colour safe to emit
# TC_IMAGES     kitty | iterm2 | none
# TC_NOTIFY     osascript | osc9 | none      (osascript whenever Darwin)
# TC_NERDFONT   1/0   only 1 when positively detected (font name or NERD_FONT=1)
# TC_UNICODE    1/0   UTF-8 locale
```

Python: `from termcap import detect; tc = detect()` → dataclass with the same
fields in lowercase. Unknown terminal (including `herdr`, the one this build
session runs in) → conservative: truecolor 0, images none, nerdfont 0.
Stubs exist now so you can test; Agent 21 fills them in. Do not duplicate the
logic in your own mod.

## Shared event log — `~/.claude/agent-monitor/events.jsonl`

One JSON object per line, append-only (`>>`), directory created `0700`.
Use the helper, never write the file directly:

```bash
. "$ROOT/lib/events.sh"
emit_event "<event>" "<status>" '{"extra":"json"}'   # extra is optional
```
```python
sys.path.insert(0, f"{ROOT}/lib"); from events import emit
emit(event="tool_start", status="running", tool="Bash", agent_id=..., ...)
```

Fixed fields (helper fills `ts`, `session_id`, `agent_id`, `agent_type`, `cwd`
from the hook stdin if you pass it): `ts` (ISO-8601 UTC), `event`
(`session_start|agent_start|tool_start|tool_end|agent_stop|session_stop|
session_end|notification`), `status` (`running|done|failed|blocked`), `session_id`,
`agent_id` (null for main session), `agent_type`, `description`, `tool`,
`parent_agent_id`, `cost_usd`, `tokens`. Other mods may append; only the
monitor reads. Nobody rewrites or truncates it (`lib/events.py` rotates it at 20 MB).

## Testing (honest)

- This build session runs under `TERM_PROGRAM=herdr`, not Terminal.app or
  Ghostty. "Test in both terminals" means: run your tests with
  `TERM_PROGRAM=Apple_Terminal TERM=xterm-256color` and
  `TERM_PROGRAM=ghostty TERM=xterm-ghostty COLORTERM=truecolor`
  env overrides. Say exactly that in REPORT.md. Only the orchestrator opens
  real windows for the end-to-end test.
- Every mod ships `test.sh` (or `test_*.py`) that runs offline in < 30 s and
  exits non-zero on failure. Feed hooks sample stdin JSON built from
  FORMATS.md. Put tests in files and run them with `bash test.sh`: the Bash
  tool's interactive shell here is zsh, where an unquoted `$var` does not
  word-split, so inline `env $vars cmd` one-liners silently misbehave.
- Your first Bash call in this environment will be rejected by a "Fact-Forcing
  Gate" hook asking you to state (1) the request and (2) what the command
  verifies. Write those two lines in text and retry the same command. The same
  gate asks four facts before the first Write to each new file (what it
  supersedes, where it is referenced, why a new file, the user's instruction
  verbatim); answer in text and retry.

## Privacy — this repo goes PUBLIC on GitHub

- Never read, quote or copy `~/.claude/settings.json` or `~/.claude.json`.
- No real hostnames, emails, personal names, device IDs, org or repo names,
  or absolute paths under `/Users/<name>` in any file. Use `~` or
  `$HOME`. Example paths in docs use `~/code/project`.
- Hooks must never read `.env`, `~/.ssh`, keychain, or credential files.
- See SECURITY.md for the full policy; it is binding.

## REPORT.md (every agent writes one in its folder)

```
## Files created
## hooks.json / .mcp.json / settings.json snippets (exact JSON, uses ${CLAUDE_PLUGIN_ROOT})
## Tests run (command + result, with env overrides used)
## Needs from user (Homebrew packages, macOS permissions, paths, credentials) — or "none"
## Terminal.app vs Ghostty differences
## Known limitations
```
