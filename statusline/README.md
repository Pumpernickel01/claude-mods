# statusline

One-line Claude Code status line: model, git branch with dirty/clean mark, context usage with a
10-cell bar, session cost, and effort level.

```
Opus  git:main● wt:feature-xyz  ctx 30% [███░░░░░░░]  $0.01  effort:high
```

- Context colour: green up to 60 %, yellow above 60 %, red above 80 %. `ctx –` while
  `used_percentage` is still null (session start, right after `/compact`).
- Git: branch from `git symbolic-ref` (short SHA when detached), `●` dirty / `○` clean from
  `git diff --quiet` and `git diff --cached --quiet` (untracked files are not counted, for speed).
  Each git call has a 50 ms timeout; the result is cached for 3 s per directory in
  `~/.cache/claude-mods/statusline/`, so large repos never slow the prompt. Not a repo, or git too
  slow: the git segment is simply omitted. `workspace.git_worktree` is shown as `wt:<name>`.
- Width: reads `COLUMNS`; when the line is too long it drops the bar, then the cost, then effort.
- Any internal error prints just the model name and exits 0, never a traceback.

## Use

Plugins cannot set `statusLine` (Claude Code only lets plugins ship `subagentStatusLine`), so the
command goes in your own `~/.claude/settings.json`:

```json
{"statusLine":{"type":"command","command":"bash ~/claude-mods/statusline/statusline.sh","padding":0}}
```

On a machine that installed the plugin from the marketplace the path is
`~/.claude/plugins/marketplaces/claude-mods/statusline/statusline.sh`. `statusline.sh` just execs
`python3 statusline.py` next to it; pointing `command` at the `.py` directly works too. Python 3
stdlib only.

## Disable

Either remove the `statusLine` key from settings.json, or keep it and add `statusline` to
`CLAUDE_MODS_DISABLE` in settings.json `env` (the script then prints nothing):

```json
{"env":{"CLAUDE_MODS_DISABLE":"statusline"}}
```

## Terminal.app vs Ghostty

Detection comes from `lib/termcap.py`; this script only reads `tc.truecolor`, `tc.nerdfont`,
`tc.unicode`.

| | Terminal.app | Ghostty |
|---|---|---|
| Colour | 256-colour SGR (`38;5;114/178/167`, dim 245) unless termcap reports truecolor | 24-bit SGR with the same xterm-palette RGB values |
| Glyphs | `git:` prefix, `●`/`○`, bar `█`/`░`, `–` | same, unless `NERD_FONT=1` |
| `NERD_FONT=1` | branch glyph U+E0A0, model glyph U+F2DB (microchip) | same |
| Non-UTF-8 locale | pure ASCII: `*`/`-`, `#`/`.`, `ctx -` | same |

Glyph choice was verified with CoreText against the fonts Terminal.app ships: Menlo and the system
SF Mono both contain `● ○ █ ░ –`. `⎇` (U+2387) and `᚜` are missing from both, and `▮▯` is
missing from SF Mono, so they are not used; nothing falls back to a tofu box. Nerd Font glyphs are
only emitted when termcap positively detects a Nerd Font (`NERD_FONT=1`).

## Permissions / packages

None. No network, no secrets, no writes outside `~/.cache/claude-mods/statusline/` (created 0700).
`git` is run with `GIT_OPTIONAL_LOCKS=0` so the status line never leaves an `index.lock` behind.

## Test

`bash test.sh` (offline, ~2 s). Feeds the FORMATS.md status-line JSON with `used_percentage`
30/60/65/80/85/null under Terminal.app, Ghostty and `LANG=C` env overrides, against temporary dirty
and clean git repos, and measures 20 cold and 20 cached runs (p95 must stay under 100 ms).
