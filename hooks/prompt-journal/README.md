# prompt-journal — Prompt logger

Appends every prompt you submit to a daily Markdown journal:
`~/claude-journal/YYYY-MM-DD.md` (local date). Each entry:

```
## 13:14:56 · demo

> Fix the **bug** in `foo.py`:
>
> - item 1
> > quoted
```

- `<project>` is the basename of the git toplevel of the session `cwd`, or
  the basename of `cwd` when not in a repo.
- Prompt text is written verbatim as a blockquote; multi-line prompts and
  Markdown characters are preserved (a line starting with `>` becomes `> >`).
- Slash commands are logged too (they are prompts).
- Skipped: empty / whitespace-only prompts and subagent prompts (stdin has
  `agent_id`).
- Directory is created `0700`, files `0600` (they contain your prompts).
- Never prints to stdout (nothing is injected into context), always exits 0.

## Use

Installed with the `mods` plugin via `hooks/hooks.json` (snippet in
`REPORT.md`). Change the journal location with
`CLAUDE_MODS_JOURNAL_DIR=~/some/dir` in settings.json `env`.

## Disable

Add `prompt-journal` to `CLAUDE_MODS_DISABLE` in settings.json `env`
(comma-separated list).

## Terminal.app vs Ghostty

None: the hook produces no terminal output.

## Requirements

`python3` (stdlib) and `git` on PATH (optional; without it the project name
falls back to the `cwd` basename). No macOS permissions needed.
