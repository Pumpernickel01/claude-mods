# test-writer agent

`agents/test-writer.md` defines the `mods:test-writer` subagent: it writes and
runs tests and never modifies source files. Invoke it as
`@agent-mods:test-writer`, or let the main agent delegate when new code needs
tests or a bug needs a regression test.

## What it does

1. Finds the project's test framework, layout, naming and fixtures by reading
   existing tests and the run configuration (`package.json`, `pyproject.toml`,
   `go.mod`, `Package.swift`, `Cargo.toml`, CI), and matches them.
2. Creates or edits only test files: `test_*.py`, `*_test.py`, `*.test.*`,
   `*.spec.*`, `tests/**`, `test/**`, `__tests__/**`, `spec/**`,
   `*Tests.swift`, `*_test.go`. Rust `#[cfg(test)]` modules live in `src/`, so
   it writes the module in its report and asks the main agent to insert it.
3. Runs the tests with the project's command and reports pass/fail counts and
   the exact command.
4. When a test fails because the source is wrong, it reports the bug (assertion,
   expected vs actual, suspected `file:line`) and leaves the test failing as a
   regression test instead of touching the source.

The rule in step 2 is enforced, not just requested: the
`hooks/test-writer-guard/` PreToolUse hook denies any `Edit`/`Write` by this
agent outside those paths. See that folder's README.

Tools: `Read, Glob, Grep, Bash, Write, Edit`. Model: `inherit` (the parent
session's model). Colour: green.

## Disable

The agent is part of the plugin; disable the plugin to remove it. To keep the
agent but drop the enforcement, add `test-writer-guard` to
`CLAUDE_MODS_DISABLE` in settings.json `env`.

## Terminal.app vs Ghostty

No difference: an agent definition has no terminal output of its own.

## Permissions or packages

None beyond the project's own test runner.
