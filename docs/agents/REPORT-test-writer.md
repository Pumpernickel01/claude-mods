# REPORT — test-writer agent

## Files created
- `agents/test-writer.md` — `mods:test-writer` subagent. Frontmatter:
  `name: test-writer`, `description`, `tools: Read, Glob, Grep, Bash, Write, Edit`,
  `model: inherit` (FORMATS.md §5 lists `inherit` as valid and does not list
  `model` among the fields plugin agents ignore), `color: green`. 56 lines.
- `agents/README-test-writer.md` — what it does, how to invoke, how to disable.
- `agents/REPORT-test-writer.md` — this file.
- Enforcement hook: `hooks/test-writer-guard/` (guard.py, test.sh, README.md,
  REPORT.md). The hooks.json snippet and the full test output are in
  `hooks/test-writer-guard/REPORT.md`.

## hooks.json / .mcp.json / settings.json snippets
None for the agent file itself (plugin agents in `agents/` load automatically).
The guard's `PreToolUse` snippet is in `hooks/test-writer-guard/REPORT.md`.

## Tests run (command + result, with env overrides used)
`claude plugin validate ~/claude-mods/agents` (Claude Code 2.1.310):
```
Validating components in: ~/claude-mods/agents

✔ Validation passed
```
The guard's `bash test.sh`: 15 PASS, 0 FAIL, exit 0, also under the
`TERM_PROGRAM=Apple_Terminal` and `TERM_PROGRAM=ghostty` env overrides
(unit tests under `herdr`; no real terminal window opened).
Not tested: running the agent end to end in a real session (needs the plugin
installed and a target project).

## Needs from user
none

## Terminal.app vs Ghostty differences
None; an agent definition produces no terminal output of its own.

## Known limitations
- The agent prompt forbids writing files through `Bash`; only `Edit`/`Write`
  are enforced by the hook (see the hook REPORT).
- Rust `#[cfg(test)]` modules cannot be written by the agent at all; it hands
  them to the main agent in its report.
