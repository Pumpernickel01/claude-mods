# REPORT — command-guard

## Files created
- `hooks/command-guard/guard.py` (executable) — PreToolUse hook, Python 3 stdlib, 7 rules.
- `hooks/command-guard/tests.txt` — 66 `BLOCK` + 57 `ALLOW` cases (5 of them `@main`).
- `hooks/command-guard/test.sh` (executable) — runs the table + 4 contract cases.
- `hooks/command-guard/README.md`
- `hooks/command-guard/REPORT.md`

Not used: `lib/termcap.*` and `lib/events.*` — the guard prints no terminal output and the spec asks for no event emission.

## hooks.json / .mcp.json / settings.json snippets (exact JSON, uses ${CLAUDE_PLUGIN_ROOT})

hooks.json:
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "python3 \"${CLAUDE_PLUGIN_ROOT}/hooks/command-guard/guard.py\"",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```
No `.mcp.json` or settings.json entries. Disable: `CLAUDE_MODS_DISABLE=command-guard` (comma-separated list) in settings.json `env`.

## Tests run (command + result, with env overrides used)

```
$ bash test.sh
command-guard: 123 table cases (66 BLOCK, 57 ALLOW) + 4 contract cases: PASS
(3.6 s wall)

$ TERM_PROGRAM=Apple_Terminal TERM=xterm-256color bash test.sh
command-guard: 123 table cases (66 BLOCK, 57 ALLOW) + 4 contract cases: PASS

$ TERM_PROGRAM=ghostty TERM=xterm-ghostty COLORTERM=truecolor bash test.sh
command-guard: 123 table cases (66 BLOCK, 57 ALLOW) + 4 contract cases: PASS
```
bash 3.2.57, Python 3.12.7. The env overrides are irrelevant to this hook (no terminal output) and are run only to follow CONVENTIONS.md → Testing. Not tested in a live Claude Code session; unit tests only, with stdin JSON built from FORMATS.md §1.4 (PreToolUse/Bash verbatim shape), cwd = temp `git init` repo with HEAD on `feature`, and a second repo on `main` for the `@main` lines.

Spot checks outside the table (all behaved as documented): deny JSON carries the original token (`~/Library`, not the expanded path); a commit message heredoc containing an apostrophe passes (fallback lexer); `rm -rf ..` from `/tmp` resolves to `/` and is denied.

## Needs from user
none

## Terminal.app vs Ghostty differences
None. The hook writes JSON to stdout and a reason to stderr only.

## Known limitations

Spec decisions made (documented in README):
- `wc -l .env` → BLOCK (spec: "allow ls/test/stat only"). `cp .env.example .env` → BLOCK (spec puts `cp` in the writer list).
- `--force-with-lease` is allowed; only `-f`/`--force`/`+refspec` count as force.
- `/Users/*` wildcard is matched as a prefix (`/Users/*/anything`), since any such path spans every user's home.
- `nvram` is denied whenever `amfi_get_out_of_my_way` or `csr-active-config` appears in its arguments, including `nvram csr-active-config=...` (slightly broader than "boot-args", same effect).
- Relative `rm -rf` targets are resolved against `cwd` before comparing, so `rm -rf .` from `~` and `rm -rf ..` from `~/code` are caught; this is the spec's `~` target reached a different way.
- Internal exceptions exit 2 with a stderr reason (fail closed), not exit 0: a crashed guard must not silently allow. The stderr message names the `CLAUDE_MODS_DISABLE` escape hatch.

Accepted false positives: `cp .env.example .env`; `*.key` (Keynote) and `*.pem` (public certs); heredoc bodies are scanned as commands; quoted `'~'`/`"$HOME"` treated as home. `grep -r "rm -rf" docs/` is NOT a false positive — quotes are honoured by the shlex-based splitter.

Not caught: paths built inside interpreter code (`python -c "open('.env')"`), variable targets (`rm -rf "$DIR"`), `xargs`/`find -exec`, `sudo -u root cmd`, backticks inside double quotes, `cd elsewhere && git push -f` (branch check uses the hook's `cwd`).

## Security notes
No violations found. The guard itself never opens any file; `cwd` from stdin is passed to `git -C` as a list argument (no shell), and the deny reason echoes the raw command token rather than an expanded path, so no `/Users/<name>` string leaks into logs or this report.
