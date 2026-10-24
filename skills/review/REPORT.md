# REPORT — skills/review (`/mods:review`)

## Files created

- `skills/review/SKILL.md` — the skill (55 lines; frontmatter `name: review`,
  `disable-model-invocation: true`, `argument-hint: "[path]"`, `allowed-tools`,
  `disallowed-tools` as specified; four `` !`…` `` dynamic-context blocks;
  checklist; severity-grouped report format; fixed closing lines).
- `skills/review/README.md`
- `skills/review/test.sh` (executable)
- `skills/review/REPORT.md` (this file)

## hooks.json / .mcp.json / settings.json snippets

**None.** This mod is a single Markdown skill. Claude Code loads
`skills/review/SKILL.md` from the plugin root automatically as `/mods:review`
(FORMATS.md §4, §7.1). There is deliberately **no `hooks.json` entry**, no
MCP server and no settings key. Read-only is enforced by the skill's own
frontmatter (`disallowed-tools`), not by a hook.

## Tests run

### 1. `claude plugin validate` (Claude Code 2.1.310)

Directly on the skill folder the validator refuses, because a bare skill
folder is not a plugin root (FORMATS.md §7.5: it validates marketplace.json,
else plugin.json, else the `skills/agents/commands` folders):

```
$ claude plugin validate ./skills/review
Validating plugin manifest: ~/claude-mods/skills/review

✘ Found 1 error:

  ❯ directory: No manifest found in directory. Expected .claude-plugin/marketplace.json or .claude-plugin/plugin.json

✘ Validation failed
exit=1
```

So the skill was validated inside a throwaway plugin root holding only
`skills/review/SKILL.md` (the same thing `test.sh` does):

```
$ P=$(mktemp -d) && mkdir -p "$P/skills/review" && cp skills/review/SKILL.md "$P/skills/review/" && claude plugin validate "$P"
Validating components in: /tmp/review-plugin.YG1Ka2

Plugin directory checks for /tmp/review-plugin.YG1Ka2. The plugin directory is the catalog that plugins are submitted to; this is a subset of what it runs.

✘ Found 2 problems the plugin directory refuses a submission for:

  ❯ README.md: README missing (README_MISSING). ...
  ❯ LICENSE: License missing (LICENSE_MISSING). ...

⚠ Found 1 plugin directory warning:

  ❯ .claude-plugin/plugin.json icon: No icon (ICON_MISSING). ...

ℹ Found 1 plugin directory note:

  ❯ .claude-plugin/plugin.json file: MANIFEST_NOT_FOUND. No .claude-plugin/plugin.json. This folder holds a skills tree (skills/<name>/SKILL.md), which Claude Code loads without a manifest, so the directory accepts it as a plugin; ...

These plugin directory checks do not change the result below. ...

✔ Validation passed
exit=0
```

`claude plugin validate --strict "$P"` printed the same and also exited 0.
Every item above is about the temp plugin root (README, LICENSE, icon,
plugin.json), i.e. orchestrator-owned files; nothing is reported against
`SKILL.md`. `claude plugin validate ~/claude-mods` (the real repo root) also
prints `✔ Validation passed`, exit 0, with the same root-level notes.

### 2. Dynamic context rendered in a temp repo

Fixture: `git init`, commit `app.py` using `with open(path) as f`, then
rewrite it to leave a `print()` in and an unchecked `open()`, plus an
untracked `notes.txt`. What the four `` !`…` `` blocks render:

```
$ git status --short
 M app.py
?? notes.txt

$ git diff --stat
 app.py | 5 +++--
 1 file changed, 3 insertions(+), 2 deletions(-)

$ git diff --cached --stat
(empty: nothing staged)

$ git ls-files --others --exclude-standard | head -50
notes.txt
```

The full diff the skill then tells Claude to read:

```
$ git diff
diff --git a/app.py b/app.py
index bf27725..150817a 100644
--- a/app.py
+++ b/app.py
@@ -1,5 +1,6 @@
 import json

 def load(path):
-    with open(path) as f:
-        return json.load(f)
+    print("loading", path)
+    f = open(path)
+    return json.load(f)
```

Expected report from the skill on this fixture: High `app.py:5` (file handle
from `open()` never closed, no error handling), Low/Nit `app.py:4` (leftover
`print(`), Nit `notes.txt` (untracked scratch file), verdict `fix first`.
Not observed live (see Known limitations).

### 3. `bash skills/review/test.sh` (offline, 0.67 s)

```
ok   has name: review
ok   has disable-model-invocation: true
ok   has disallowed-tools: Edit, Write, NotebookEdit, Bash(git commit *), Bash(git add *)
ok   has allowed-tools: Bash(git diff *), Bash(git status *), Bash(git ls-files *), Read, Grep, Glob
ok   has !`git status --short`
ok   has !`git diff --stat`
ok   has !`git diff --cached --stat`
ok   has !`git ls-files --others --exclude-standard | head -50`
ok   has $ARGUMENTS
ok   has No changes were made.
ok   has Critical
ok   has High
ok   has Medium
ok   has Low
ok   has Nit
ok   SKILL.md is 55 lines (< 60)
ok   status shows modified app.py
ok   status shows untracked notes.txt
ok   diff --stat lists app.py
ok   diff --cached --stat empty (nothing staged)
ok   ls-files lists notes.txt
ok   diff contains the leftover print(
ok   claude plugin validate --strict
ALL PASSED
exit=0
```

Env overrides: none used. The skill has no terminal-dependent code, so the
`TERM_PROGRAM=Apple_Terminal` / `TERM_PROGRAM=ghostty` runs required by
CONVENTIONS.md would exercise nothing; `test.sh` was run once under the build
session's `TERM_PROGRAM=herdr`.

## Needs from user

none (git on PATH is the only requirement).

## Terminal.app vs Ghostty differences

None. Output is plain Markdown in the chat transcript.

## Known limitations

- Not run end-to-end inside an interactive Claude session (this build session
  cannot open one). Frontmatter parsing, `!` expansion and the
  `disallowed-tools` enforcement are validated structurally, not observed.
- `allowed-tools: Bash(git diff *)` is the spec'd wildcard. Whether it also
  pre-approves the bare `git diff` (no trailing argument) that step 1 asks
  for was not verified; worst case the user gets one permission prompt.
- The four `!` blocks always show the whole tree; `$ARGUMENTS` narrows only
  the follow-up reads and the findings, per spec.
- Outside a git repo the `!` blocks render git's error text; the skill does
  not guard for that.
- Untracked list is capped at 50 entries (spec).

## Security notes

- Read-only by construction: `Edit`, `Write`, `NotebookEdit`,
  `Bash(git commit *)`, `Bash(git add *)` are removed from the tool pool.
- SECURITY.md §1 forbids mods reading `.env*`, keys and credentials. Step 1
  therefore tells Claude to report untracked `.env*`, `*.pem`, `*.key`,
  `*credentials*` as a High finding **without opening them**.
- No personal paths in the shipped files; the one `/tmp/...` path above is a
  `mktemp` name.
