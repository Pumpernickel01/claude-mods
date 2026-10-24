# docs-updater (agent `mods:docs-updater`)

Subagent that brings README files, docstrings, inline comments, `--help`
strings and schema descriptions back in line with the code you just changed.
It reads `git diff`, lists the symbols whose public face moved (functions,
classes, CLI flags, config keys, env vars, endpoints), greps every place they
are documented, and rewords those places. It never edits executable code.

## What it does

1. Runs `git diff HEAD` and `git status --short` (or `git diff <range>` when
   you name one) and lists changed symbols with their old and new form.
2. Greps `README*`, `docs/**`, docstrings, comments within 10 lines of the
   change, usage strings, OpenAPI / JSON schema descriptions and example code
   blocks. `CHANGELOG*` only when you ask.
3. Fixes wording, signatures, defaults and examples; fixes comments that
   contradict the code; adds a docstring only where the file already uses
   them. Keeps the document's voice and heading structure.
4. Ends with two lists: files it edited, and doc locations it found but did
   not touch (ambiguous intent, possible bug, needs a code change).

## How to use

After implementing or refactoring, before you commit:

```
@agent-mods:docs-updater update the docs for what I just changed
@agent-mods:docs-updater sync docs for the range main..HEAD, include CHANGELOG
```

Or just ask Claude to "run the docs-updater agent"; the description tells it
when to delegate. Review the reported "Could not update" list yourself: those
are the places where the agent suspected the code change, not the doc, might
be wrong.

Tool access is `Read, Glob, Grep, Edit, Write, Bash`. The agent body
restricts Bash to `git diff`, `git status` and `git log`; this is an
instruction, not an enforced permission (see REPORT-docs-updater.md).

## Disable

This is a prompt file, not a script, so `CLAUDE_MODS_DISABLE` cannot stop it.
Either do not invoke it, delete `agents/docs-updater.md` from your plugin
copy, or `claude plugin disable mods` to turn off the whole plugin.

## Terminal.app vs Ghostty

No difference. The agent produces only chat output and file edits.

## Permissions or packages

None. Needs `git` on PATH (ships with Xcode command line tools) and a git
repository as the working directory.
