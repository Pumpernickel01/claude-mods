# REPORT — hooks/format-on-edit

## Files created

- `hooks/format-on-edit/format.py` (executable) — PostToolUse hook, Python 3 stdlib only.
- `hooks/format-on-edit/test.sh` (executable) — offline tests, bash 3.2, < 5 s.
- `hooks/format-on-edit/README.md`
- `hooks/format-on-edit/REPORT.md` (this file)

`lib/termcap.py` and `lib/events.py` are not used: the hook prints no terminal
output and emits no monitor event (nothing asked for one).

## hooks.json / .mcp.json / settings.json snippets

Merge into `hooks/hooks.json` (orchestrator):

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "python3 \"${CLAUDE_PLUGIN_ROOT}/hooks/format-on-edit/format.py\"",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

No `.mcp.json` or `settings.json` entries. Disable: add `format-on-edit` to
`CLAUDE_MODS_DISABLE` in settings.json `env`.

## Tests run

Command: `bash test.sh; echo "exit=$?"` (from the mod folder). Output:

```
PASS: .sh runs shfmt -w <file>, silent
PASS: .ts runs prettier --write <file>; formatter failure silent
PASS: .py without ruff/black prints the exact suggestion JSON
PASS: .py suggestion not repeated for the same session_id
PASS: .py suggestion shown again for a new session_id
PASS: node_modules path skipped
PASS: missing file skipped
PASS: CLAUDE_MODS_DISABLE=format-on-edit exits 0, no output, no formatter run
PASS: empty stdin exits 0 quietly
exit=0
```

"Both terminals" = the same suite run with env overrides, not real windows
(this build session runs under `TERM_PROGRAM=herdr`):

- `TERM_PROGRAM=Apple_Terminal TERM=xterm-256color bash test.sh` → exit 0
- `TERM_PROGRAM=ghostty TERM=xterm-ghostty COLORTERM=truecolor bash test.sh` → exit 0

The suite uses fake `shfmt`/`prettier` scripts on a restricted `PATH`
(`$T/bin:/usr/bin:/bin`, `python3` resolved beforehand) that record their argv;
the fake prettier exits 1 to prove formatter failure is silent. Stdin JSON is
the PostToolUse shape from FORMATS.md §1.4 with `cwd` set to the temp project.

Real-formatter smoke test with the one formatter installed here
(`clang-format`): a `.c` file containing `int   main( ){return   0;}` fed as a
`Write` PostToolUse event came back as `int main() { return 0; }`, hook exit 0,
empty stdout.

## Needs from user

None required. Nice to have via Homebrew/npm, each enables its file types:

- `npm i -g prettier` — js/jsx/ts/tsx/mjs/cjs/json/css/scss/html/md/yaml/yml
- `brew install ruff` (or `black`) — py
- `brew install shfmt` — sh/bash
- `brew install clang-format` — c/cc/cpp/h/hpp/m/mm (already installed here)
- `rustfmt` via rustup: `rustup component add rustfmt` — rs
- `gofmt` via `brew install go` — go

When a file type has a known formatter but none is on PATH, Claude is told once
per session per tool, e.g. `format-on-edit: no formatter for .py files; install
with `brew install ruff` to enable auto-formatting.`

## Terminal.app vs Ghostty differences

None. The hook writes only hook JSON to stdout (or nothing); no colours,
images or notifications.

## Known limitations

- Per SECURITY.md the file must resolve (realpath) inside the session `cwd`;
  edits to files outside the project (e.g. `~/.claude/...`, `additionalDirectories`)
  are not formatted.
- Formatter selection is by extension only; extensionless scripts, `.vue`,
  `.svelte`, `.toml` etc. are untouched. Extending is one line in `FORMATTERS`.
- Formatters run with a 15 s timeout and all output discarded; a syntax error
  leaves the file as Claude wrote it with no notice (by design).
- The once-per-session marker lives in `$TMPDIR/claude-mods-format-on-edit/`
  (dir mode 0700, empty files named `<session_id>.<tool>`); macOS purges unused
  temp files, so it is self-cleaning. If that dir is unwritable the hint repeats.
- `PostToolUse` cannot change what Claude already saw: Claude's view of the
  file content may be pre-format until it reads the file again.

## Security notes

- `subprocess.run([...])` with a list, never `shell=True`; argv is fixed per
  formatter, the only variable is the realpath'd file.
- Path from hook JSON goes through `os.path.realpath` and must be under `cwd`.
- Any exception → exit 0, nothing printed.
