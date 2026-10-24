#!/bin/bash
# Offline checks for /mods:commit: SKILL.md shape, then the exact context the
# four !`...` commands render in a throwaway repo with one staged change.
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
SKILL="$HERE/SKILL.md"
fail() { echo "FAIL: $*" >&2; exit 1; }

[ "$(wc -l < "$SKILL")" -lt 60 ] || fail "SKILL.md must be under 60 lines"
for key in '^name: commit$' '^description: ' '^disable-model-invocation: true$' '^argument-hint: ' '^allowed-tools: .*Bash(git commit \*)'; do
  grep -q "$key" "$SKILL" || fail "frontmatter missing $key"
done
CMDS='git status --short
git diff --cached --stat
git diff --cached | head -c 30000
git log --oneline -15'
echo "$CMDS" | while IFS= read -r cmd; do
  grep -qF "!\`$cmd\`" "$SKILL" || fail "dynamic context missing: $cmd"
done
[ "$(grep -c '!`' "$SKILL")" -eq 4 ] || fail "stray !\` sequence would run as a command"
grep -q '\$ARGUMENTS' "$SKILL" || fail "missing \$ARGUMENTS placeholder"
grep -q 'context: fork' "$SKILL" && fail "must not fork: AskUserQuestion needs the main session"
echo "ok: SKILL.md shape"

# Throwaway repo. The -c flags keep it offline and prompt-free whatever the
# user's global git config does (signing, hooks templates).
TMP="$(mktemp -d /tmp/commit-skill.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT
g() { git -C "$TMP" -c user.name=dev -c user.email=dev@example.com -c commit.gpgsign=false "$@"; }
g init -q
printf 'def add(a, b):\n    return a + b\n' > "$TMP/calc.py"
g add calc.py && g commit -q -m 'feat(calc): add integer addition'
printf '# calc\n' > "$TMP/README.md"
g add README.md && g commit -q -m 'docs(readme): add project title'
printf 'def add(a, b):\n    return a + b\n\n\ndef sub(a, b):\n    return a - b\n' > "$TMP/calc.py"
printf 'from calc import sub\n\nassert sub(3, 1) == 2\n' > "$TMP/test_calc.py"
g add calc.py test_calc.py
echo scratch > "$TMP/notes.txt"   # unstaged: must appear in status, not in the diff
[ -n "$(g diff --cached --stat)" ] || fail "fixture has nothing staged"

cd "$TMP"
echo "$CMDS" | while IFS= read -r cmd; do
  printf '\n$ %s\n' "$cmd"
  bash -c "$cmd"
done
echo
echo "ok: rendered context"
