# test-writer-guard

PreToolUse hook on `Edit|Write` that enforces the `mods:test-writer` agent's
one rule: it may only create or edit test files. Python 3 stdlib only.

## What it does

On every `Edit` / `Write`, `guard.py` reads the hook stdin JSON. If
`agent_type` is `test-writer` or `mods:test-writer` (the plugin-scoped name),
it resolves `tool_input.file_path` against the session `cwd` (`realpath`, so
`tests/../src/x.py` and symlinks do not fool it) and allows the write only if
the file stays inside `cwd` and its relative path matches one of:

- a directory component named `tests`, `test`, `__tests__` or `spec`
  (anywhere in the path, since JS puts `__tests__/` next to the code)
- a file name matching `test_*.py`, `*_test.py`, `*.test.*`, `*.spec.*`,
  `*Tests.swift`, `*_test.go`

Anything else gets a PreToolUse `deny` with the reason
`test-writer may only write test files; ask the main agent to change <path>`.
Rust `#[cfg(test)]` modules live in `src/*.rs`, so they are denied on purpose;
the agent is told to hand the module to the main agent instead.

For the main session and every other agent the hook prints nothing and exits 0.
Any internal error also exits 0 quietly, so it can never break a session.

## How to use

Nothing to configure. The plugin's `hooks/hooks.json` registers it:

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

## Disable

Disable: add `test-writer-guard` to `CLAUDE_MODS_DISABLE` in settings.json
`env` (comma-separated list of mod names).

## Terminal.app vs Ghostty

No difference: the hook prints no terminal output, only JSON for Claude Code.

## Permissions or packages

None. The hook only reads stdin and inspects a path; it never touches the file.

## Test

`bash test.sh` (offline, < 2 s): allow/deny cases for both agent names,
`../outside.py`, `tests/../src/x.py`, the main session (no `agent_type`),
another agent, the disable convention, and empty or non-JSON stdin.
