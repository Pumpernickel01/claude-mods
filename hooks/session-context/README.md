# session-context — repo context at session start

A `SessionStart` hook (sources `startup`, `resume`, `clear`; not `compact`)
that gives Claude a compact picture of the git repo it was started in, as
`additionalContext`:

```
## Repo context (session-context)
branch: main (ahead 1 / behind 0 of upstream)
status:
 M src/app.py
?? notes.txt
+3 more
recent commits:
a1b2c3d fix login redirect
9f8e7d6 add session cache
TODO/FIXME: 12 TODO, 3 FIXME, 1 HACK/XXX in tracked files
```

- `status` is `git status --short`, capped at 30 lines (`+K more`), or `clean`.
- `recent commits` is `git log --oneline -10`, or `none` on an unborn branch.
- Marker counts cover tracked files only (`git ls-files`), skip binaries, and
  use `rg` when installed, else `git grep`.
- Everything shares a 2 s budget; a section that runs out prints
  `(skipped, slow)` instead of delaying the session.

Prints nothing (exit 0) when `cwd` is not inside a git work tree, when the
hook runs inside a subagent (`agent_id` in stdin), or when disabled.

## Use

Shipped by the `mods` plugin via `hooks/hooks.json`:

```json
{
  "hooks": {
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
  }
}
```

Manual run: `echo '{"cwd":"'"$PWD"'","hook_event_name":"SessionStart","source":"startup"}' | python3 context.py`

## Disable

Add `session-context` to `CLAUDE_MODS_DISABLE` in settings.json `env`
(comma-separated list shared by all mods).

## Terminal.app vs Ghostty

None. The hook writes JSON to Claude's context, never to the terminal.

## Requirements

`git` and Python 3 (stdlib only). `rg` is optional (faster counting); without
it `git grep` is used. `xargs` is POSIX and present on macOS and Linux.

## Test

`bash test.sh` — offline, about 10 s (it builds a 10k-file repo for the
timing check), exits non-zero on failure.
