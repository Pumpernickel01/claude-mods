# precompact-snapshot

Copies the session transcript to `~/.claude/snapshots/` right before Claude Code
compacts the context (both manual `/compact` and automatic compaction), so the
full pre-compaction conversation survives. Old snapshots are pruned after 30 days.

## What it does

`PreCompact` hook (`snapshot.py`, Python 3 stdlib):

1. Copies the file at `transcript_path` to
   `~/.claude/snapshots/<project>-<YYYYMMDD-HHMMSS>-<trigger>.jsonl`
   where `<project>` is the basename of the git toplevel of `cwd` (or of `cwd`
   itself outside a repo), sanitised to `[A-Za-z0-9._-]`, and `<trigger>` is
   `manual` or `auto`. Example: `my-app-20261024-131347-auto.jsonl`.
2. Directory is `0700`, each snapshot `0600` (transcripts contain prompts).
3. Prunes files in that directory named `*-<8 digits>-<6 digits>-*.jsonl` whose
   mtime is older than 30 days. Nothing else in the directory is touched.

It prints nothing, never blocks compaction, and always exits 0 (a missing
transcript or any internal error is silently ignored).

## Configuration

| Variable | Default | Meaning |
| :- | :- | :- |
| `CLAUDE_MODS_SNAPSHOT_DIR` | `~/.claude/snapshots` | Where snapshots go |
| `CLAUDE_MODS_SNAPSHOT_KEEP_DAYS` | `30` | Prune snapshots older than this |

Set them in settings.json `env`.

## Disable

Disable: add `precompact-snapshot` to `CLAUDE_MODS_DISABLE` in settings.json `env`
(comma-separated list, e.g. `"CLAUDE_MODS_DISABLE": "precompact-snapshot"`).

## Terminal.app vs Ghostty

No difference: the hook produces no terminal output.

## Permissions / packages

None. Python 3 stdlib only; `git` is used if present to find the repo toplevel
and silently skipped otherwise.

## Restoring a snapshot

Snapshots are plain transcript `.jsonl` files. Copy one back over the original
under `~/.claude/projects/.../` (with Claude Code closed) or read it directly.

## Test

```bash
bash hooks/precompact-snapshot/test.sh
```
