# REPORT — skills/commit (`/mods:commit`)

## Files created

- `skills/commit/SKILL.md` — the skill (54 lines; frontmatter `name: commit`, `disable-model-invocation: true`, `argument-hint`, `allowed-tools` for `git diff/status/log/rev-parse/commit`; four `` !`...` `` dynamic-context blocks; approval via AskUserQuestion; heredoc `git commit` form).
- `skills/commit/test.sh` (executable) — offline: asserts SKILL.md shape (line count, frontmatter keys, the four context commands verbatim, no stray `` !` ``, `$ARGUMENTS` present, no `context: fork`), then builds a throwaway repo with two conventional commits, one staged modification, one staged new file and one unstaged file, and prints what the four context commands render.
- `skills/commit/README.md` — what / how / disable / terminal differences / permissions.
- `skills/commit/REPORT.md` — this file.

No scripts beyond `test.sh`; the skill is prompt-only, so `lib/termcap.*` and `lib/events.*` are not used (nothing to detect, nothing to log).

## hooks.json / .mcp.json / settings.json snippets

None needed. Plugin skills load automatically from `skills/<name>/SKILL.md`; the `allowed-tools` frontmatter carries the Bash pre-approvals, so no permission entry is required either.

## Tests run (command + result, with env overrides used)

Env overrides: not applicable (text-only skill, no terminal detection). Not tested in a live `/mods:commit` session (see Known limitations).

```
$ claude plugin validate ~/claude-mods/skills
Validating components in: ~/claude-mods/skills

✔ Validation passed
exit=0
```

```
$ claude plugin validate ~/claude-mods
Validating components in: ~/claude-mods
... (plugin-directory submission checks: README_MISSING, LICENSE_MISSING, ICON_MISSING warning,
     MANIFEST_NOT_FOUND note — all about the repo root / .claude-plugin, i.e. orchestrator files,
     none about skills/commit) ...
✔ Validation passed
exit=0
```

```
$ bash ~/claude-mods/skills/commit/test.sh
ok: SKILL.md shape

$ git status --short
M  calc.py
A  test_calc.py
?? notes.txt

$ git diff --cached --stat
 calc.py      | 4 ++++
 test_calc.py | 3 +++
 2 files changed, 7 insertions(+)

$ git diff --cached | head -c 30000
diff --git a/calc.py b/calc.py
index 4693ad3..4c2d043 100644
--- a/calc.py
+++ b/calc.py
@@ -1,2 +1,6 @@
 def add(a, b):
     return a + b
+
+
+def sub(a, b):
+    return a - b
diff --git a/test_calc.py b/test_calc.py
new file mode 100644
index 0000000..cd97d1b
--- /dev/null
+++ b/test_calc.py
@@ -0,0 +1,3 @@
+from calc import sub
+
+assert sub(3, 1) == 2

$ git log --oneline -15
1e9d407 docs(readme): add project title
1af1237 feat(calc): add integer addition

ok: rendered context
exit=0
```

The four `$ ...` blocks above are exactly what Claude Code substitutes into SKILL.md before Claude reads it (hashes differ per run). `notes.txt` shows the unstaged file appearing in status but not in the staged diff, which is why the skill tells Claude to draft from the staged diff only.

## Needs from user

none

## Terminal.app vs Ghostty differences

none (plain chat text)

## Known limitations

- Not exercised live: the `/mods:commit` invocation, the AskUserQuestion yes/edit/cancel loop, and whether `Bash(git commit *)` in `allowed-tools` also covers the `git commit -m "$(cat <<'EOF' ... EOF)"` command-substitution form without a permission prompt. Unverified either way; worst case is one extra prompt.
- Staged diff is cut at 30 KB (`head -c 30000`); very large commits get a message drafted from the first 30 KB plus the `--stat` summary.
- The skill only reads what Claude Code renders at invocation time; staging more files after typing `/mods:commit` requires re-running it.

## Security notes

Nothing to report. The skill never stages, amends, bypasses hooks or pushes, and only runs the five `git` subcommands listed in `allowed-tools`. `test.sh` uses a fixture identity (`dev@example.com`) and a `mktemp` repo removed on exit.
