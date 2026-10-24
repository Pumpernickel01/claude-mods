# REPORT — test-writer-guard (and the test-writer agent)

## Files created
- `hooks/test-writer-guard/guard.py` (executable) — PreToolUse `Edit|Write` guard
- `hooks/test-writer-guard/test.sh` (executable) — 15 offline checks
- `hooks/test-writer-guard/README.md`
- `hooks/test-writer-guard/REPORT.md` (this file)
- `agents/test-writer.md` — the `mods:test-writer` subagent (56 lines)
- `agents/README-test-writer.md`, `agents/REPORT-test-writer.md` — agent docs

## hooks.json / .mcp.json / settings.json snippets
hooks.json (merge into the `PreToolUse` array):
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "python3 \"${CLAUDE_PLUGIN_ROOT}/hooks/test-writer-guard/guard.py\"",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```
No `.mcp.json` or settings.json entries.

## Tests run (command + result, with env overrides used)
`cd ~/claude-mods/hooks/test-writer-guard && bash test.sh` → exit 0, 0.27 s:
```
PASS: test-writer -> tests/test_x.py allowed (relative)
PASS: test-writer -> absolute tests path allowed
PASS: test-writer -> src/__tests__/x.test.ts allowed
PASS: test-writer -> pkg/foo_test.go allowed
PASS: mods:test-writer -> Tests/FooTests.swift allowed
PASS: test-writer -> src/x.py denied
PASS: mods:test-writer -> src/x.py denied
PASS: test-writer -> ../outside.py denied (leaves cwd)
PASS: test-writer -> tests/../src/x.py denied (realpath)
PASS: test-writer -> src/lib.rs denied (Rust cfg(test) exception)
PASS: no agent_type (main session) -> src/x.py allowed
PASS: other agent -> src/x.py allowed
PASS: CLAUDE_MODS_DISABLE=test-writer-guard exits 0, no output
PASS: empty stdin exits 0 quietly
PASS: garbage stdin exits 0 quietly
```
Re-run with `TERM_PROGRAM=Apple_Terminal TERM=xterm-256color bash test.sh` and
with `TERM_PROGRAM=ghostty TERM=xterm-ghostty COLORTERM=truecolor bash test.sh`:
15 PASS, 0 FAIL each. These are unit tests with env overrides, run under
`TERM_PROGRAM=herdr`; no real Terminal.app or Ghostty window was opened.

Deny output asserted byte-for-byte, e.g. for `src/x.py`:
`{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"test-writer may only write test files; ask the main agent to change src/x.py"}}`

`claude plugin validate ~/claude-mods/agents` (Claude Code 2.1.310):
```
Validating components in: ~/claude-mods/agents

✔ Validation passed
```
(`claude plugin validate ~/claude-mods` also passes; its plugin-directory
checks flag missing root README.md, LICENSE, icon and plugin.json — all
orchestrator-owned files, nothing in my folders.)

## Needs from user
none

## Terminal.app vs Ghostty differences
None. The hook emits only JSON for Claude Code, never terminal output.

## Known limitations
- The guard sees only `Edit`/`Write`. A test-writer that writes a file via
  `Bash` (`cat > src/x.py`) is not caught here; the agent prompt forbids it, and
  the dangerous-command guard (separate mod) is the place for a Bash rule.
- `tests/`, `test/`, `__tests__/`, `spec/` match as a directory component
  anywhere in the path, not only at the project root (needed for JS
  `src/foo/__tests__/`). `conftest.py` outside a test dir is denied.
- Matching is on `agent_type` from hook stdin; if a user copies the agent to
  `~/.claude/agents/` under another `name`, the guard does not apply.
- On its own internal error the hook exits 0 (allows), per the hook contract;
  the only such path is malformed stdin, where `agent_type` is unknown anyway.
