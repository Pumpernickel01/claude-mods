# REPORT — precompact-snapshot

## Files created
- `hooks/precompact-snapshot/snapshot.py` (executable, Python 3 stdlib) — PreCompact hook
- `hooks/precompact-snapshot/test.sh` (executable, bash 3.2) — offline tests
- `hooks/precompact-snapshot/README.md`
- `hooks/precompact-snapshot/REPORT.md`

## hooks.json / .mcp.json / settings.json snippets (exact JSON, uses ${CLAUDE_PLUGIN_ROOT})

hooks.json (merge into the `PreCompact` array):
```json
{
  "hooks": {
    "PreCompact": [
      {
        "matcher": "manual|auto",
        "hooks": [
          {
            "type": "command",
            "command": "python3 \"${CLAUDE_PLUGIN_ROOT}/hooks/precompact-snapshot/snapshot.py\"",
            "timeout": 15
          }
        ]
      }
    ]
  }
}
```

settings.json `env` (all optional):
```json
{
  "env": {
    "CLAUDE_MODS_SNAPSHOT_DIR": "~/.claude/snapshots",
    "CLAUDE_MODS_SNAPSHOT_KEEP_DAYS": "30",
    "CLAUDE_MODS_DISABLE": "precompact-snapshot"
  }
}
```
(`CLAUDE_MODS_SNAPSHOT_DIR` is used verbatim, no `~` expansion; give an absolute path if you override it.)

No .mcp.json entry.

## Tests run (command + result, with env overrides used)

`bash test.sh` feeds PreCompact stdin JSON built from FORMATS.md 1.4 (`session_id`,
`transcript_path`, `cwd`, `hook_event_name`, `trigger`, `custom_instructions`) into
`snapshot.py` with `CLAUDE_MODS_SNAPSHOT_DIR` pointing at a temp dir. Checks: named
copy identical to source with mode 0600 in a 0700 dir and empty stdout; git toplevel
basename used as project; a 40-day-old decoy snapshot (`touch -t`) is pruned while an
equally old `notes.txt` and fresh snapshots are kept; missing transcript exits 0 and
creates nothing; empty stdin exits 0; `CLAUDE_MODS_DISABLE=other-mod,precompact-snapshot`
creates nothing. Runtime 0.2 s.

Run under `/bin/bash` 3.2.57 with both terminal overrides (this build session runs
under `TERM_PROGRAM=herdr`; "tested in both terminals" means these env overrides,
not real windows). Output was identical for both:

```
$ TERM_PROGRAM=Apple_Terminal TERM=xterm-256color /bin/bash test.sh
ok   manual snapshot: my_proj-20261024-131432-manual.jsonl mode 600, dir 700, silent
ok   git toplevel basename used for project
ok   pruned only the 40-day-old snapshot; notes.txt and fresh snapshots kept
ok   missing transcript: exit 0, nothing created
ok   empty stdin: exit 0, silent
ok   CLAUDE_MODS_DISABLE=precompact-snapshot creates nothing
all tests passed
exit=0

$ TERM_PROGRAM=ghostty TERM=xterm-ghostty COLORTERM=truecolor /bin/bash test.sh
(same six lines)
all tests passed
exit=0
```

## Needs from user
none

## Terminal.app vs Ghostty differences
None. The hook prints nothing (PreCompact discards `systemMessage` anyway).

## Known limitations
- Two compactions for the same project and trigger within the same second write the
  same filename; the later copy overwrites the earlier (marked `shortcut:` in the code).
- Timestamp in the filename is local time, not UTC.
- Only a `transcript_path` ending in `.jsonl` that is a regular file is copied; the
  path is taken from Claude Code's own stdin JSON and is not restricted to `cwd`
  (transcripts live under `~/.claude/projects/`, never inside the project).
- Pruning is by mtime, so a snapshot you `touch` is kept another 30 days.
- Not tested with a real compaction in a live session; only via stdin JSON.

## Security notes
Snapshot dir created `0700`, files `0600` (SECURITY.md 1). `git` is called with an
argument list, never a shell. No secrets read, no network, no output.
