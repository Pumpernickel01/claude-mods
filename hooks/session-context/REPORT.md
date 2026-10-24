# REPORT — session-context

## Files created
- `hooks/session-context/context.py` (executable) — the SessionStart hook
- `hooks/session-context/test.sh` (executable) — offline tests
- `hooks/session-context/README.md`
- `hooks/session-context/REPORT.md`

## hooks.json / .mcp.json / settings.json snippets

hooks.json (merge under the top-level `"hooks"` wrapper):

```json
"SessionStart": [
  {
    "matcher": "startup|resume|clear",
    "hooks": [
      {
        "type": "command",
        "command": "python3 \"${CLAUDE_PLUGIN_ROOT}/hooks/session-context/context.py\"",
        "timeout": 10
      }
    ]
  }
]
```

No `.mcp.json` or `settings.json` entries. Disable via `CLAUDE_MODS_DISABLE`
containing `session-context` (shared convention).

## Tests run

`bash test.sh` (no terminal env overrides needed: the hook never touches the
terminal; the only external tools are `git`, `rg`/`git grep`, `xargs`).
Fixture: temp repo with 2 commits, a modified and an untracked file (the
untracked one contains "TODO" to prove tracked-only counting), a tracked
binary with "TODO" before a NUL byte, a clone with ahead 2 / behind 1 (asymmetric, so a swapped order would fail), a
37-entry status for truncation, a fake `rg` that sleeps 5 s, and a
10k-file repo. Total suite wall time 9.3 s.

```
ok   exit 0
ok   header present
ok   branch name
ok   status: modified file
ok   status: untracked file
ok   log: first commit subject
ok   log: second commit subject
ok   marker counts (tracked only, binary skipped)
ok   no ahead/behind without upstream
ok   ahead/behind of upstream (asymmetric: order proven)
ok   git grep fallback counts match
ok   status truncated with +K more (37 lines -> 30 + 7)
ok   non-git dir: empty output, exit 0
ok   agent_id present: empty output
ok   CLAUDE_MODS_DISABLE honoured
ok   empty stdin: quiet
ok   missing cwd: quiet, exit 0
ok   slow rg -> (skipped, slow)
ok   slow rg still prints the git sections
ok   slow rg: wall 2025ms < 2500
ok   10k files: counts summed across xargs chunks
ok   10k files: wall 215ms < 2000
ALL PASSED
```

The `git grep` fallback is exercised by running with `PATH=/usr/bin:/bin`
(no Homebrew `rg`). Also ran the hook by hand against `~/claude-mods`
itself (unborn branch, no commits): valid single JSON object, `recent
commits: none`.

Not tested: a real Claude Code session (orchestrator's end-to-end run);
`fork` source (excluded by the matcher as specified); repos with
submodules.

## Needs from user
none. `rg` is a nice-to-have via Homebrew (already present here); without it
the hook falls back to `git grep`.

## Terminal.app vs Ghostty differences
none — output is JSON for Claude's context, nothing is written to the terminal.

## Known limitations
- The 2 s budget is shared: a slow `git status` (huge untracked tree, cold
  disk) can starve the later sections, which then show `(skipped, slow)`.
- Counts are occurrences (`-o`), so a line with two `TODO`s counts twice, and
  the match is not word-bounded (`TODOS`, `XXXL` count).
- `git ls-files` lists submodules as paths; `rg` recurses into them, so
  submodule files are counted under the rg path but not under `git grep`.
- Tracked files deleted from the work tree are skipped silently
  (`--no-messages`); tracked files that are binary are skipped by rg's NUL
  detection and `git grep -I`.
- Detached HEAD prints `HEAD (detached)` without the commit SHA.
- Does not append to the shared event log (`lib/events.py`); not in the spec,
  and the monitor's `session_start` event belongs to the agent-monitor mod.

## Security notes
No shell: every tool runs via `subprocess.run([...])` with `cwd` taken from
hook stdin (a missing directory is caught and the hook exits 0 quietly).
`GIT_OPTIONAL_LOCKS=0` so the hook never holds `index.lock` while the user
runs git. Reads no files itself; only tool stdout, decoded with
`errors="replace"` so one non-UTF-8 path or commit subject cannot silence the hook.
