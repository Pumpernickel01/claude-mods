# format-on-edit

Runs the project's formatter on every file Claude edits or writes, so Claude's
diffs come out already formatted. PostToolUse hook on `Edit|Write`, Python 3
stdlib only.

## What it does

After each `Edit` / `Write`, `format.py` looks at the file's extension and runs
the first installed formatter from this table on that one file, from the
session's `cwd` (so project configs like `.prettierrc` apply):

| Extension | Formatter (first on PATH wins) | Install |
| :- | :- | :- |
| `.js .jsx .ts .tsx .mjs .cjs .json .css .scss .html .md .yaml .yml` | `prettier --write` | `npm i -g prettier` |
| `.py` | `ruff format`, else `black -q` | `brew install ruff` |
| `.rs` | `rustfmt` | `rustup component add rustfmt` |
| `.c .cc .cpp .h .hpp .m .mm` | `clang-format -i` | `brew install clang-format` |
| `.go` | `gofmt -w` | `brew install go` |
| `.sh .bash` | `shfmt -w` | `brew install shfmt` |

- Formatter failures (syntax errors, timeouts over 15 s) are silent: the hook
  always exits 0 and prints nothing, so a bad formatter never breaks a session.
- Skipped: paths containing `/node_modules/`, `/.git/`, `/vendor/`, `/dist/`,
  `/build/`; files that no longer exist; files outside the session `cwd`.
- If the file type has a known formatter but none is installed, Claude gets a
  one-line hint once per session per tool, e.g.
  `format-on-edit: no formatter for .py files; install with `brew install ruff` to enable auto-formatting.`
  The "seen" marker is an empty file in `$TMPDIR/claude-mods-format-on-edit/`.

## How to use

Nothing to configure. The plugin's `hooks/hooks.json` registers it:

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

Install the formatters you want (none are required):
`npm i -g prettier`, `brew install ruff shfmt clang-format go`,
`rustup component add rustfmt` (rustfmt ships with the rustup toolchain).

## Disable

Disable: add `format-on-edit` to `CLAUDE_MODS_DISABLE` in settings.json `env`
(comma-separated list of mod names).

## Terminal.app vs Ghostty

No difference: the hook prints no terminal output, only JSON for Claude.

## Permissions or packages

No macOS permissions. Formatters are optional Homebrew/npm packages (table
above). The hook only ever runs a formatter on the file Claude just changed.

## Test

`bash test.sh` (offline, < 5 s) uses fake `shfmt`/`prettier` scripts on a
restricted `PATH` and asserts the argv, the once-per-session suggestion, the
`node_modules` skip, the missing-file skip, and the disable convention.
