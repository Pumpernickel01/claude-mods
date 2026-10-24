# test-gate — run the project's tests before Claude stops

A `Stop` hook. When Claude finishes a turn and the git working tree has
modified tracked files, it detects the project's test command, runs it, and
blocks the stop with the last 40 lines of output if tests fail. Claude then
keeps working to fix them. Passing tests, a clean tree, or a project with no
recognisable test setup produce no output at all.

## What runs

Checked from `cwd` upwards to the git toplevel; the first match wins and runs
in the directory where it was found:

| Marker | Command |
| :- | :- |
| `package.json` with a real `scripts.test` (not the npm placeholder) | `pnpm test` / `yarn test` / `bun run test` / `npm test --silent`, chosen by lockfile (`pnpm-lock.yaml`, `yarn.lock`, `bun.lockb`/`bun.lock`, else npm) in that dir or the repo root |
| pytest config (`[tool.pytest` in `pyproject.toml`, `pytest.ini`, `[pytest]`/`[tool:pytest]` in `tox.ini`/`setup.cfg`) or `tests/`/`test/` containing `test_*.py` | `python3 -m pytest -q -x --no-header -p no:cacheprovider`; if `python3 -m pytest` is not importable, `uv run pytest ...` when `uv.lock` lists pytest; otherwise falls through |
| `Cargo.toml` | `cargo test -q` |
| `go.mod` | `go test ./...` |
| `Makefile` with a `test:` target | `make test` |
| `Package.swift` | `swift test` |
| only `*.xcodeproj` / `*.xcworkspace` | nothing: `xcodebuild test` needs a scheme and destination and takes minutes; add a `Makefile` `test:` target if you want a gate |

If the toolchain binary is not on `PATH`, nothing runs. Tests run with
`CI=1 FORCE_COLOR=0`, stdin closed, stdout+stderr captured, default timeout
120 s (`CLAUDE_MODS_TEST_TIMEOUT`, seconds).

## Outcomes

- Pass: silent.
- Fail: `{"decision":"block","reason":"test-gate: \`<cmd>\` failed (exit N) ... Last 40 lines: ..."}` (reason capped at 8000 chars).
- Timeout: not blocked; a `systemMessage` says the suite exceeded the limit and was skipped.
- Loop safety: the hook never blocks when `stop_hook_active` is true. It also
  stores a hash of `git diff HEAD --stat` under
  `~/.cache/claude-mods/test-gate/<session_id>` when it blocks; if the tree
  hash is identical on the next Stop (Claude could not fix it), it only shows
  a `systemMessage` that tests still fail instead of blocking again. A passing
  run clears the marker.

## Disable / skip

- Disable the mod: add `test-gate` to `CLAUDE_MODS_DISABLE` in settings.json `env`.
- Skip tests for one project: in that project's `.claude/settings.json`:
  ```json
  { "env": { "CLAUDE_MODS_SKIP_TESTS": "1" } }
  ```
- Slow suites (monorepos, integration tests): the default 120 s limit skips
  the run with a warning. Either set `CLAUDE_MODS_TEST_TIMEOUT` (max ~170:
  the hook itself is killed by Claude Code at 180 s, after which the stop
  proceeds silently) or skip via the env above and run tests yourself.

## Install

Ships with the `mods` plugin; the orchestrator's `hooks/hooks.json` carries:

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

Requirements: `git` and `python3` (stdlib only). No packages, no macOS
permissions. Terminal.app vs Ghostty: no difference; the hook prints no
terminal output, only hook JSON.

## Limitations

- "Claude changed tracked files" is approximated by "working tree is dirty".
  If you start a session with uncommitted work, tests run on every Stop until
  the tree is clean or you skip via env.
- The tree hash uses `--stat`, so an edit that keeps the same +/- line counts,
  or adding an untracked file, looks "unchanged" and will not re-block
  (fails open, never loops).
- One test command per Stop; a repo with several unrelated projects below
  `cwd` only runs the nearest one above `cwd`.
- `uv run pytest` may sync the environment on first run, which can need network.

Tests: `bash test.sh` (offline, ~2 s, fake `npm` on `PATH`, temp git repos).
