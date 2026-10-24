# REPORT — statusline

## Files created
- `statusline/statusline.py` (executable, Python 3 stdlib) — the status line
- `statusline/statusline.sh` (executable, bash 3.2, 3 lines) — wrapper that execs the Python next to it
- `statusline/test.sh` (executable, bash 3.2) — offline tests + p50/p95 timing
- `statusline/README.md`
- `statusline/REPORT.md`

## hooks.json / .mcp.json / settings.json snippets (exact JSON, uses ${CLAUDE_PLUGIN_ROOT})

No hooks.json or .mcp.json entry. FORMATS.md 8.8: plugins cannot set `statusLine`, so the
orchestrator puts this in the user's `~/.claude/settings.json` with a concrete path:

```json
{"statusLine":{"type":"command","command":"bash ~/claude-mods/statusline/statusline.sh","padding":0}}
```

On other machines (plugin installed from the marketplace) the path is
`~/.claude/plugins/marketplaces/claude-mods/statusline/statusline.sh`. Inside the plugin the script
is `python3 "${CLAUDE_PLUGIN_ROOT}/statusline/statusline.py"`; both the `.sh` and the `.py` accept
the stdin JSON directly. The script locates `lib/termcap.py` via `CLAUDE_PLUGIN_ROOT` or, when that
is unset (settings.json path), via its own location (`../lib`).

Optional, to disable without removing the key:
```json
{"env":{"CLAUDE_MODS_DISABLE":"statusline"}}
```

## Tests run (command + result, with env overrides used)

This build session runs under `TERM_PROGRAM=herdr` with `COLORTERM=truecolor` leaking in; "tested in
both terminals" means `test.sh` run under the two env overrides below, not real windows. `test.sh`
itself also forces per-case envs (`env -u COLORTERM -u NERD_FONT -u TMUX ... TERM_PROGRAM=...`) and
sets `HOME` to a temp dir so the git cache lands there. Stdin is the FORMATS.md 3 JSON trimmed to
the fields the script reads (`model`, `workspace`, `cost`, `context_window`, `effort`), with
`workspace.current_dir` pointing at a temp dirty repo (tracked file modified), a temp clean repo, or
a plain directory.

```
$ TERM_PROGRAM=Apple_Terminal TERM=xterm-256color /bin/bash test.sh
ok   (a) Apple_Terminal 30%: 256-colour only, green, git:main● wt, bar, cost, effort
ok   (a) colour switches: 60 green, 65 yellow, 80 yellow, 85 red
ok   (a) null used_percentage renders 'ctx –' without a bar
ok   (a) clean repo ○, non-repo shows no git segment
ok   (b) ghostty: 24-bit SGR, green/yellow/red at 30/65/85
ok   (b) NERD_FONT=1 uses U+E0A0 branch and U+F2DB model glyphs
ok   (c) LANG=C falls back to * - # . and 'ctx -'
ok   COLUMNS=60 drops the bar, 55 drops cost too, 40 drops effort too
ok   disable prints nothing; empty stdin silent; bad input prints model name, exit 0
ok   statusline.sh wrapper execs the python with stdin
ok   git cache written to ~/.cache/claude-mods/statusline/
     cold git repo: p50 44.7 ms  p95 46.9 ms
     cached: p50 23.7 ms  p95 27.5 ms
ok   p95 < 100 ms (cold and cached)
all tests passed
exit=0

$ TERM_PROGRAM=ghostty TERM=xterm-ghostty COLORTERM=truecolor /bin/bash test.sh
(same 13 lines)
     cold git repo: p50 42.0 ms  p95 42.6 ms
     cached: p50 23.2 ms  p95 23.7 ms
ok   p95 < 100 ms (cold and cached)
all tests passed
exit=0
```

Assertions: (a) output contains `\x1b[38;5;` and not `\x1b[38;2;`; (b) contains `\x1b[38;2;`;
green at 30 and 60, yellow at 65 and 80, red at 85 (both colour modes); null → `ctx –` and no bar;
`git:main●` from the dirty repo, `git:main○` from the clean one, no git segment for a non-repo;
`wt:feature-xyz` shown; `COLUMNS` drops bar → cost → effort in that order (the test fixture is 72
cols wide, 59 without the bar, 52 without cost, 39 without effort, so `COLUMNS=40` drops all three);
`CLAUDE_MODS_DISABLE=other,statusline` prints nothing; empty stdin prints nothing; malformed
`context_window` prints `Opus`, unparsable JSON prints `Claude`, both exit 0; wrapper passes stdin.

Timing: `time.perf_counter()` around `subprocess.run([python3, statusline.py])` for 20 iterations,
cold = cache dir deleted before every run (3 git calls each), cached = cache hit. Measured on this
Apple Silicon Mac while ~20 other agents were running: cold p50 42–45 ms, p95 43–51 ms; cached p50
23–24 ms, p95 24–28 ms. Python startup is ~20 ms of that.

Glyph research (CoreText `CTFontGetGlyphsForCharacters` via a throwaway Swift script, not shipped):
Menlo has `⌥ ● ○ ▮ ▯ █ ░ –`, lacks `⎇ ᚜` and U+E0A0; the system SF Mono
(`.AppleSystemUIFontMonospaced`) has `⌥ ● ○ █ ░ –`, lacks `⎇ ᚜ ▮ ▯`. Hence `git:` text,
`●/○`, `█/░`, `–` in Unicode mode; `⌥` was rejected because it reads as the Option key.

## Needs from user
none. The orchestrator must add the `statusLine` snippet above to `~/.claude/settings.json`
(plugins cannot).

## Terminal.app vs Ghostty differences
- Terminal.app (`termcap` → truecolor False): 256-colour SGR `38;5;114` green, `178` yellow,
  `167` red, `245` dim. No 24-bit codes are emitted. If Agent 21 later flips Terminal.app to
  truecolor by `TERM_PROGRAM_VERSION`, this script follows automatically (it only reads
  `tc.truecolor`).
- Ghostty (truecolor True): 24-bit SGR with the xterm-palette RGB of those same indices
  (`135;215;135`, `215;175;0`, `215;95;95`, `138;138;138`), so both terminals look alike.
- Glyphs are identical in both unless `NERD_FONT=1`, then U+E0A0 branch and U+F2DB model glyph.
- Non-UTF-8 locale in either: ASCII `*`/`-`, `#`/`.`, `ctx -`.

## Known limitations
- Untracked files do not count as dirty (`--untracked-files` skipped for speed, per spec).
- Git state is up to 3 s stale (cache); a timeout result (`None`) is cached too, so a repo where
  git takes > 50 ms shows no git segment at all rather than a slow prompt.
- Dirty detection treats any non-zero `git diff --quiet` exit as dirty, including errors.
- `COLUMNS` width accounting counts code points; all shipped glyphs are single-cell, but the Nerd
  Font glyphs may render wider in some fonts.
- The exception fallback prints the model name parsed from stdin, or `Claude` when stdin was not
  valid JSON.
- Not run inside a live Claude Code session or a real Terminal.app / Ghostty window; only via
  stdin JSON with env overrides.

## Security notes
`git` is invoked with an argument list (no shell) on the directory Claude Code passes in stdin, with
`GIT_OPTIONAL_LOCKS=0` so no `index.lock` is ever written, each call capped at 50 ms. The only file
written is the cache under `~/.cache/claude-mods/statusline/` (dir 0700, atomic `os.replace`)
containing branch name and dirty flag. No secrets read, no network.
