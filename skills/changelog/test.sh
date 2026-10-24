#!/bin/bash
# Offline test for skills/changelog: runs the four !`...` context commands
# extracted from SKILL.md against a throwaway repo, then `claude plugin validate`.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
SKILL="$HERE/SKILL.md"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FAIL=0
ok()   { echo "ok   - $1"; }
fail() { echo "FAIL - $1"; FAIL=1; }

# Isolate git from the user's config so no real name/email/signing leaks into output.
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME=dev GIT_AUTHOR_EMAIL=dev@example.com
export GIT_COMMITTER_NAME=dev GIT_COMMITTER_EMAIL=dev@example.com

# --- frontmatter / size ---------------------------------------------------
grep -q '^name: changelog$' "$SKILL" && ok "name: changelog" || fail "name"
grep -q '^disable-model-invocation: true$' "$SKILL" && ok "disable-model-invocation" || fail "disable-model-invocation"
grep -q '^argument-hint: "\[from-ref\]' "$SKILL" && ok "argument-hint quoted" || fail "argument-hint"
grep -q '^allowed-tools: Bash(git describe \*), Bash(git log \*), Bash(git tag \*), Bash(git rev-list \*), Bash(git remote \*)$' "$SKILL" \
  && ok "allowed-tools" || fail "allowed-tools"
LINES=$(wc -l < "$SKILL" | tr -d ' ')
[ "$LINES" -lt 60 ] && ok "SKILL.md is $LINES lines (< 60)" || fail "SKILL.md is $LINES lines"

# --- extract the !`cmd` lines (a backtick-free prefix, command, closing backtick at EOL) ---
sed -n 's/^[^`]*!`\(.*\)`$/\1/p' "$SKILL" > "$TMP/cmds"
NCMD=$(wc -l < "$TMP/cmds" | tr -d ' ')
[ "$NCMD" = 4 ] && ok "4 dynamic-context commands found" || fail "expected 4 commands, got $NCMD"
NBANG=$(grep -o '!`' "$SKILL" | wc -l | tr -d ' ')  # any other !` would be run as a command by Claude Code
[ "$NBANG" = 4 ] && ok "no stray !\` in the body" || fail "found $NBANG occurrences of !\`, expected 4"

render() { # $1 = repo dir; writes $TMP/ctx.N and prints them
  i=0
  while IFS= read -r cmd; do
    i=$((i + 1))
    (cd "$1" && bash -c "$cmd") > "$TMP/ctx.$i" 2>&1
    echo "--- !\`$cmd\`"; cat "$TMP/ctx.$i"; echo
  done < "$TMP/cmds"
}

commit() { (cd "$1" && echo "$2" >> f && git add f && git commit -q -m "$2"); }

# --- repo A: tag + 5 conventional commits of mixed types ----------------------
A="$TMP/a"; git init -q -b main "$A"
commit "$A" "chore: initial commit"
(cd "$A" && git tag -a v1.0.0 -m v1.0.0 && git remote add origin git@github.com:example/project.git)
commit "$A" "feat(api)!: drop v1 endpoints"
commit "$A" "feat(cli): add --json flag"
commit "$A" "fix(parser): handle empty scope"
commit "$A" "docs: update readme"
commit "$A" "Tidy up whitespace"
echo; echo "=== rendered context, repo with tag ==="; render "$A"
[ "$(cat "$TMP/ctx.1")" = v1.0.0 ] && ok "last tag is v1.0.0" || fail "last tag: $(cat "$TMP/ctx.1")"
[ "$(cat "$TMP/ctx.2")" = v1.0.0 ] && ok "recent tags lists v1.0.0" || fail "recent tags"
N=$(grep -c . "$TMP/ctx.3")  # format: has no trailing newline, so not wc -l
[ "$N" = 5 ] && ok "5 commits since tag" || fail "expected 5 commit lines, got $N"
grep -q "$(printf '\tfeat(api)!: drop v1 endpoints\tdev\t')" "$TMP/ctx.3" && ok "tab-separated hash/subject/author/date" || fail "log format"
grep -q 'initial commit' "$TMP/ctx.3" && fail "tagged commit leaked into range" || ok "tagged commit excluded"
[ "$(cat "$TMP/ctx.4")" = git@github.com:example/project.git ] && ok "remote URL" || fail "remote: $(cat "$TMP/ctx.4")"

# --- repo B: no tag, no remote ---------------------------------------------------
B="$TMP/b"; git init -q -b main "$B"
commit "$B" "feat: first"
commit "$B" "fix: second"
echo "=== rendered context, repo without tag/remote ==="; render "$B"
[ "$(cat "$TMP/ctx.1")" = NO_TAG ] && ok "NO_TAG fallback" || fail "no-tag: $(cat "$TMP/ctx.1")"
[ -s "$TMP/ctx.2" ] && fail "tag list should be empty" || ok "empty tag list"
grep -q 'fix: second' "$TMP/ctx.3" && ok "root..HEAD fallback lists commits" || fail "no-tag log"
[ -s "$TMP/ctx.4" ] && fail "remote should be empty" || ok "empty remote is silent"

# --- claude plugin validate on an isolated plugin copy ----------------------------
if command -v claude >/dev/null; then
  P="$TMP/plugin/mods"; mkdir -p "$P/.claude-plugin" "$P/skills"
  printf '{"name":"mods","version":"0.0.0","description":"test","author":{"name":"test"}}\n' > "$P/.claude-plugin/plugin.json"
  cp -R "$HERE" "$P/skills/changelog"
  echo "=== claude plugin validate ==="
  claude plugin validate "$P" && ok "claude plugin validate" || fail "claude plugin validate"
  claude plugin validate --strict "$P" && ok "claude plugin validate --strict" || fail "claude plugin validate --strict"
else
  echo "skip - claude CLI not found"
fi

echo; [ "$FAIL" = 0 ] && echo "ALL PASSED" || { echo "SOME FAILED"; exit 1; }
