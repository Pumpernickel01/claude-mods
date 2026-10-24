# prompt-journal — REPORT

## Files created
- `hooks/prompt-journal/journal.py` (executable) — UserPromptSubmit hook
- `hooks/prompt-journal/test.sh` (executable)
- `hooks/prompt-journal/README.md`
- `hooks/prompt-journal/REPORT.md`

## hooks.json / .mcp.json / settings.json snippets

hooks.json (merge under the top-level `"hooks"` wrapper):
```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "python3 \"${CLAUDE_PLUGIN_ROOT}/hooks/prompt-journal/journal.py\"",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

settings.json (optional, `env`): `"CLAUDE_MODS_JOURNAL_DIR": "~/some/dir"` to
relocate the journal; add `prompt-journal` to `CLAUDE_MODS_DISABLE` to turn it
off. No .mcp.json entry.

## Tests run
`bash test.sh` (offline, < 2 s). Covers: two UserPromptSubmit payloads (a
multi-line prompt with Markdown characters and a `>` line from a plain dir; a
slash command from a subdirectory of a fresh `git init` repo), day file exists
with mode 0600 in a hook-created 0700 dir, both entries present in order with
exact blockquote text and project names (`plainproj`, `myrepo`), whitespace
prompt / missing prompt / `agent_id` / `CLAUDE_MODS_DISABLE` each write
nothing (fresh dir stays absent), garbage and empty stdin exit 0 silently,
stdout empty on every call.

```
$ bash test.sh
PASS: all prompt-journal checks
$ TERM_PROGRAM=Apple_Terminal TERM=xterm-256color bash test.sh
PASS: all prompt-journal checks
$ TERM_PROGRAM=ghostty TERM=xterm-ghostty COLORTERM=truecolor bash test.sh
PASS: all prompt-journal checks
```
"Both terminals" means those env overrides only; this build session runs under
`TERM_PROGRAM=herdr` and the hook has no terminal output anyway.

Mutation check: breaking the disable comparison in `journal.py` makes
`test.sh` fail with `FAIL: disabled hook wrote something` (exit 1).

## Needs from user
none

## Terminal.app vs Ghostty differences
None — no terminal output.

## Known limitations
- Mode 0700/0600 is applied only when the directory/file is created; an
  existing journal dir with looser permissions is left as is.
- Project name comes from `git rev-parse` (2 s timeout); if `git` is missing
  or slow it falls back to the `cwd` basename.
- Entries are appended by independent hook processes; two sessions writing in
  the same second are ordered by arrival, each entry written in one call.

## Security notes
No secrets read, no shell=True, no network. Journal files hold prompt text,
hence 0700/0600 per SECURITY.md.
