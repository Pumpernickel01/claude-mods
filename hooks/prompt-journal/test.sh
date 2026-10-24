#!/bin/bash
# Offline test for prompt-journal. Exit non-zero on first failure.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HERE/journal.py"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $1" >&2; exit 1; }
mode() { python3 -c 'import os,sys;print("%o" % (os.stat(sys.argv[1]).st_mode & 0o777))' "$1"; }

# run <json> : feed stdin, assert exit 0 and empty stdout
run() {
  out="$(printf '%s' "$1" | python3 "$HOOK")" || fail "exit code non-zero"
  [ -z "$out" ] || fail "stdout not empty: $out"
}

mkdir -p "$TMP/plainproj" "$TMP/myrepo/sub"
git -C "$TMP/myrepo" init -q
export CLAUDE_MODS_JOURNAL_DIR="$TMP/journal"   # must not pre-exist: tests makedirs(0700)
DAY="$CLAUDE_MODS_JOURNAL_DIR/$(date +%Y-%m-%d).md"

# 1. multi-line prompt with markdown characters and a ">" line, plain dir
PROMPT1='Fix the **bug** in `foo.py`:\n\n- item 1\n- item 2\n> quoted line\n# not a heading'
run "{\"session_id\":\"abc\",\"cwd\":\"$TMP/plainproj\",\"hook_event_name\":\"UserPromptSubmit\",\"prompt\":\"$PROMPT1\"}"
# 2. slash command from inside a git repo subdir -> project is the repo toplevel name
run "{\"session_id\":\"abc\",\"cwd\":\"$TMP/myrepo/sub\",\"hook_event_name\":\"UserPromptSubmit\",\"prompt\":\"/review this\"}"

[ -f "$DAY" ] || fail "day file missing: $DAY"
[ "$(mode "$CLAUDE_MODS_JOURNAL_DIR")" = 700 ] || fail "dir mode $(mode "$CLAUDE_MODS_JOURNAL_DIR")"
[ "$(mode "$DAY")" = 600 ] || fail "file mode $(mode "$DAY")"

python3 - "$DAY" <<'PY' || fail "content check"
import re, sys
t = open(sys.argv[1], encoding="utf-8").read()
want1 = ("> Fix the **bug** in `foo.py`:\n>\n> - item 1\n> - item 2\n> > quoted line\n> # not a heading\n\n")
want2 = "> /review this\n\n"
h = re.findall(r"^## (\d\d:\d\d:\d\d) · (.+)$", t, re.M)
assert [p for _, p in h] == ["plainproj", "myrepo"], h
i1, i2 = t.index(want1), t.index(want2)
assert i1 < i2, "entries out of order"
assert t.count("## ") == 2, t
PY

# 3. empty / whitespace prompt writes nothing (fresh dir must stay absent)
export CLAUDE_MODS_JOURNAL_DIR="$TMP/j-empty"
run "{\"cwd\":\"$TMP/plainproj\",\"hook_event_name\":\"UserPromptSubmit\",\"prompt\":\"  \n\"}"
run "{\"cwd\":\"$TMP/plainproj\",\"hook_event_name\":\"UserPromptSubmit\"}"
[ ! -e "$CLAUDE_MODS_JOURNAL_DIR" ] || fail "empty prompt wrote something"

# 4. subagent prompt (agent_id present) writes nothing
export CLAUDE_MODS_JOURNAL_DIR="$TMP/j-agent"
run "{\"cwd\":\"$TMP/plainproj\",\"agent_id\":\"a1\",\"agent_type\":\"Explore\",\"hook_event_name\":\"UserPromptSubmit\",\"prompt\":\"internal\"}"
[ ! -e "$CLAUDE_MODS_JOURNAL_DIR" ] || fail "agent prompt wrote something"

# 5. disable convention writes nothing
export CLAUDE_MODS_JOURNAL_DIR="$TMP/j-disabled"
CLAUDE_MODS_DISABLE="other,prompt-journal" run "{\"cwd\":\"$TMP/plainproj\",\"hook_event_name\":\"UserPromptSubmit\",\"prompt\":\"hello\"}"
[ ! -e "$CLAUDE_MODS_JOURNAL_DIR" ] || fail "disabled hook wrote something"

# 6. garbage stdin / empty stdin: exit 0, silent
out="$(printf 'not json' | python3 "$HOOK")" && [ -z "$out" ] || fail "garbage stdin"
out="$(python3 "$HOOK" </dev/null)" && [ -z "$out" ] || fail "empty stdin"

echo "PASS: all prompt-journal checks"
