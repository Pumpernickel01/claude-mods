# Shared brief for every build agent (read fully before starting)

You are one of ~20 agents running IN PARALLEL, each building one piece of a
Claude Code plugin on macOS. The repo is `~/claude-mods/` (expand `~` to
`$HOME`). Work ONLY inside your assigned folder (create it). Other agents are
editing other folders right now; never touch theirs.

## Read first, in this order
1. `~/claude-mods/CONVENTIONS.md` — binding (layout, bash 3.2, disable
   convention, shared libs, REPORT.md template, privacy rules).
2. `~/claude-mods/SECURITY.md` — binding.
3. The sections of `~/claude-mods/FORMATS.md` you need. It holds the exact
   formats for Claude Code 2.1.310 copied from the official docs today. Trust
   it over your memory (several things changed: the subagent tool is `Agent`,
   PreToolUse decisions use `hookSpecificOutput.permissionDecision`, skills
   supersede commands, plugin hooks.json needs a `"hooks"` wrapper, plugins
   cannot set `statusLine`, `mcpServers` is not a settings.json key).
4. The shared libs `~/claude-mods/lib/termcap.sh|.py` and `lib/events.sh|.py`
   — use them, do not re-implement.

## Environment facts
- macOS 26.6.2 (Darwin 25), Apple Silicon. `/bin/bash` is 3.2. `python3` is
  3.12 (stdlib only; `pyserial` happens to be installed, nothing else).
  `uv`/`uvx` installed. `jq` at /usr/bin/jq. `chafa`, `clang-format`,
  `pdftotext`, `rg`, `fd`, `gh`, `node`, `npm`, `psql`, `sqlite3`, `swift`
  present. NOT present: tmux, terminal-notifier, prettier, black, ruff,
  rustfmt, gofmt, shfmt, cargo, go, mysql, `timeout`.
- Ghostty 1.3.1 at /Applications/Ghostty.app; its CLI only runs actions
  (`/Applications/Ghostty.app/Contents/MacOS/ghostty +list-actions --docs`,
  `+list-keybinds`). It has an AppleScript dictionary at
  `/Applications/Ghostty.app/Contents/Resources/Ghostty.sdef` (commands:
  `new window`, `new tab`, `split`, `input text`, `perform action`, class
  `terminal` with `working directory`, `command`, `initial input`).
- Terminal.app default profile is "Clear Dark", "Use Option as Meta key" is
  already ON, 120x30. TERM_PROGRAM=Apple_Terminal; it sets
  TERM_PROGRAM_VERSION. Research whether Terminal.app on macOS 26 supports
  24-bit colour before assuming it does not.
- THIS session runs under `TERM_PROGRAM=herdr` (a wrapper), with
  COLORTERM=truecolor leaking into the env. You cannot open or see real
  Terminal.app / Ghostty windows. "Tested in both terminals" means unit tests
  with env overrides (CONVENTIONS.md → Testing). Say exactly that.
- The Bash tool's shell is zsh: unquoted `$var` does not word-split. Put tests
  in `test.sh` and run `bash test.sh`.

## Gates you will hit (do not try to disable them)
- Your FIRST Bash call is rejected by a "Fact-Forcing Gate" hook. Reply in
  plain text with the two facts it asks (the request in one sentence; what
  the command verifies), then retry the same command. It passes after that.
- The FIRST Write into a new directory is rejected the same way asking for
  3–4 facts (what it supersedes: nothing, new folder; who calls it; why a new
  file; the user's instruction verbatim). Answer in text, retry. Siblings in
  the same folder then pass.
- Never edit any hook, settings file, CLAUDE.md, or permission to get around
  a gate.

## Hard rules
- Never read, quote or copy `~/.claude/settings.json` or `~/.claude.json`.
- Never `sudo`; never install anything (brew/pip/npm/uv tool install). If a
  tool is missing, degrade gracefully and list it under "Needs from user".
- Do not edit `hooks/hooks.json`, `.mcp.json`, `.claude-plugin/*`,
  `README.md` at the repo root, or any file outside your folder. Give the
  orchestrator exact JSON snippets in your `REPORT.md` instead.
- The plugin's name is `mods`. Skills appear as `/mods:<name>`, agents as
  `mods:<name>`, MCP tools as `mcp__plugin_mods_<server>__<tool>`. Reference
  your files via `${CLAUDE_PLUGIN_ROOT}/<your-folder>/...` in snippets.
- The repo goes PUBLIC. No personal names, emails, hostnames, IPs, serials,
  org/repo names, `/Users/<name>` paths (use `~`), or cloud-storage paths.
- Smallest complete implementation. stdlib only (exceptions listed in
  CONVENTIONS.md). No abstractions for later, no features nobody asked for,
  no config options beyond what the spec names. Comment only the why.

## Deliverables (in your folder)
- Your scripts (executable, `chmod +x`).
- `README.md`: what it does, how to use it, how to disable it, Terminal.app
  vs Ghostty differences, permissions or packages needed.
- `test.sh` (or `test_*.py`): offline, < 30 s, non-zero exit on failure,
  feeds realistic stdin JSON built from FORMATS.md. Run it. Paste the real
  output into REPORT.md.
- `REPORT.md` using the template at the end of CONVENTIONS.md.
- Finish your reply with: files created; the exact hooks.json / .mcp.json /
  settings.json snippets; what you need from the user; what you did NOT test.
