# REPORT — test-gate (Stop hook: run tests, block the stop if they fail)

## Files created

- `hooks/test-gate/test_gate.py` — the hook (Python 3 stdlib, executable).
- `hooks/test-gate/test.sh` — offline tests, `bash test.sh`, exit non-zero on failure.
- `hooks/test-gate/README.md` — usage, detection table, skip/disable, limitations.
- `hooks/test-gate/REPORT.md` — this file.

## hooks.json / .mcp.json / settings.json snippets

`hooks/hooks.json` (merge into the `Stop` array). The 180 s hook timeout
must stay above the hook's own default test timeout of 120 s:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "python3 \"${CLAUDE_PLUGIN_ROOT}/hooks/test-gate/test_gate.py\"",
            "timeout": 180
          }
        ]
      }
    ]
  }
}
```

No `.mcp.json`. Optional user/project `settings.json` env keys (documented in README):

```json
{ "env": { "CLAUDE_MODS_SKIP_TESTS": "1" } }
{ "env": { "CLAUDE_MODS_TEST_TIMEOUT": "170" } }
{ "env": { "CLAUDE_MODS_DISABLE": "test-gate" } }
```

## Behaviour summary

1. Exit 0 silently when: `test-gate` in `CLAUDE_MODS_DISABLE`; `CLAUDE_MODS_SKIP_TESTS=1`;
   empty stdin; `stop_hook_active` true; `cwd` not in a git repo;
   `git status --porcelain --untracked-files=no` empty (git calls have a 5 s timeout).
2. Detect from `cwd` up to the git toplevel, first match wins, command runs in
   the matching directory: package.json/`scripts.test` (pm by lockfile in that dir or
   the root; npm gets `--silent`, others no flags because pnpm/yarn/bun forward or
   reject them inconsistently) → pytest (config or `tests|test/**/test_*.py`, only if
   `python3 -m pytest --version` works, else `uv run pytest` when `uv.lock` lists
   pytest and `uv` exists; otherwise falls through) → `Cargo.toml` → `go.mod` →
   `Makefile` `^test\s*:` → `Package.swift`. `*.xcodeproj`/`*.xcworkspace` alone:
   nothing (documented). Missing toolchain binary: nothing.
3. Runs with `CI=1 FORCE_COLOR=0`, stdin `/dev/null`, stdout+stderr captured,
   timeout `CLAUDE_MODS_TEST_TIMEOUT` (default 120). Implemented with `Popen` +
   `communicate(timeout)` in its own process group so a timeout kills the real test
   runner, not only the `npm`/`make` wrapper (`subprocess.run` leaves orphans).
4. Pass → silent, marker removed. Fail → `{"decision":"block","reason":...}` with the
   last 40 lines, reason capped at 8000 chars. Timeout → `systemMessage`, no block.
5. Loop safety: marker `~/.cache/claude-mods/test-gate/<session_id>` (dir 0700,
   session_id sanitised to `[\w.-]`) holds sha1 of `git diff HEAD --stat`; same hash
   on the next failing Stop → `systemMessage` "still fails ... not blocking again".
   Any exception → exit 0, quiet.

## Tests run

Command: `bash test.sh` (about 2 s; no terminal env overrides needed because the
hook emits no terminal output, so Terminal.app and Ghostty behave identically).
Real output:

```
ok   - (a) failing npm test -> block with tail
ok   - (a) fake npm called exactly once
ok   - (h) same tree hash twice -> systemMessage, no block
ok   - (b) passing npm test -> silent
ok   - (d) stop_hook_active -> silent
ok   - (e) CLAUDE_MODS_SKIP_TESTS=1 -> silent
ok   - (j) CLAUDE_MODS_DISABLE -> silent
ok   - (c) clean tree -> silent, npm not called
ok   - (f) make test exit 3 -> block
ok   - (g) timeout -> systemMessage
ok   - (g) gate returned promptly after timeout
ok   - (i) no test setup -> silent
ok   - (l) npm placeholder test script -> silent
ok   - (k) not a git repo -> silent
ok   - (m) empty stdin -> silent
---
all tests passed
```

Sample block output from a manual run (temp monorepo, `cwd` two levels below
`package.json`, fake `npm` on `PATH`):

```
{"decision": "block", "reason": "test-gate: `npm test --silent` failed (exit 1). Fix the failing tests, then stop again. Last 40 lines:\n  1) adds numbers\n  1 failing"}
```

Also verified manually: a root-level `pnpm-lock.yaml` selects `pnpm` (silent here
because pnpm is not installed); no orphaned `sleep` after the timeout case; marker
dir created `drwx------`.

## Needs from user

none. Uses `git` and `python3` only. The project's own toolchain (npm/pnpm/yarn/bun,
pytest or uv, cargo, go, make, swift) must be on `PATH` for that project to be gated;
otherwise the hook stays silent.

## Terminal.app vs Ghostty differences

None. The hook never writes to the terminal; its only output is hook JSON on stdout.

## Known limitations

- Not tested here: real pytest/uv, cargo, go, swift, pnpm/yarn/bun runs (pytest,
  cargo and go are not installed on this machine). Those detectors share the code
  path exercised by the npm and make cases.
- "Claude changed tracked files" is approximated by a dirty tree; a session that
  starts with uncommitted user work runs tests on every Stop.
- `git diff HEAD --stat` hash: same +/- counts, or a new untracked file, counts as
  "unchanged" and will not re-block (fails open; Claude Code's 8-continuation cap
  still applies regardless).
- `CLAUDE_MODS_TEST_TIMEOUT` above about 170 s is pointless: Claude Code kills the
  hook at the 180 s hooks.json timeout and the stop proceeds silently.
- `uv run pytest` may sync the environment on first run (possible network access).
- Hooks budget "< 1 s" does not apply by design: this hook runs the test suite.
- Does not append to the shared event log (not asked for).

## Security notes

No `shell=True`; argv lists only. `cwd` comes from hook stdin and is only passed to
`git -C` and used as the test command's working directory. No secrets read, no
network, no files written outside `~/.cache/claude-mods/test-gate/`.
