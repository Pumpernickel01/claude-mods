#!/bin/bash
# Offline checks for the review skill: frontmatter, size, dynamic-context commands, plugin validate.
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL="$DIR/SKILL.md"
fail=0
ok()   { echo "ok   $1"; }
bad()  { echo "FAIL $1"; fail=1; }
has()  { grep -qF -- "$1" "$SKILL" && ok "has $1" || bad "missing $1"; }

has 'name: review'
has 'disable-model-invocation: true'
has 'disallowed-tools: Edit, Write, NotebookEdit, Bash(git commit *), Bash(git add *)'
has 'allowed-tools: Bash(git diff *), Bash(git status *), Bash(git ls-files *), Read, Grep, Glob'
has '!`git status --short`'
has '!`git diff --stat`'
has '!`git diff --cached --stat`'
has '!`git ls-files --others --exclude-standard | head -50`'
has '$ARGUMENTS'
has 'No changes were made.'
for s in Critical High Medium Low Nit; do has "$s"; done

lines=$(( $(wc -l < "$SKILL") ))
[ "$lines" -lt 60 ] && ok "SKILL.md is $lines lines (< 60)" || bad "SKILL.md is $lines lines (>= 60)"

# Fixture: a repo with a print() left in, an unchecked open() and an untracked file.
T=$(mktemp -d "${TMPDIR:-/tmp}/review-test.XXXXXX")
trap 'rm -rf "$T"' EXIT
(
  cd "$T" && git init -q . && git config user.email t@example.com && git config user.name t
  printf 'import json\n\ndef load(path):\n    with open(path) as f:\n        return json.load(f)\n' > app.py
  git add app.py && git commit -q -m init
  printf 'import json\n\ndef load(path):\n    print("loading", path)\n    f = open(path)\n    return json.load(f)\n' > app.py
  printf 'scratch\n' > notes.txt
) || bad "fixture setup"
status=$(cd "$T" && git status --short)
echo "$status" | grep -q '^ M app.py$' && ok "status shows modified app.py" || bad "status: $status"
echo "$status" | grep -q '^?? notes.txt$' && ok "status shows untracked notes.txt" || bad "status: $status"
(cd "$T" && git diff --stat) | grep -q 'app.py' && ok "diff --stat lists app.py" || bad "diff --stat"
[ -z "$(cd "$T" && git diff --cached --stat)" ] && ok "diff --cached --stat empty (nothing staged)" || bad "diff --cached --stat"
(cd "$T" && git ls-files --others --exclude-standard | head -50) | grep -qx 'notes.txt' && ok "ls-files lists notes.txt" || bad "ls-files"
(cd "$T" && git diff) | grep -q '^+    print(' && ok "diff contains the leftover print(" || bad "diff lacks print("

# The validator wants a plugin root (skills/<name>/SKILL.md), not a bare skill folder (FORMATS.md 7.5).
if command -v claude >/dev/null 2>&1; then
  mkdir -p "$T/plugin/skills/review" && cp "$SKILL" "$T/plugin/skills/review/SKILL.md"
  claude plugin validate --strict "$T/plugin" >/dev/null 2>&1 && ok "claude plugin validate --strict" || bad "claude plugin validate --strict"
else
  echo "skip claude plugin validate (claude not on PATH)"
fi

[ "$fail" -eq 0 ] && echo "ALL PASSED" || echo "SOME FAILED"
exit "$fail"
