#!/bin/bash
# Offline tests for snapshot.py (bash 3.2 compatible). Exit non-zero on failure.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export CLAUDE_MODS_SNAPSHOT_DIR="$TMP/snaps"
unset CLAUDE_MODS_DISABLE CLAUDE_MODS_SNAPSHOT_KEEP_DAYS

fail() { echo "FAIL: $*" >&2; exit 1; }
ok()   { echo "ok   $*"; }
mode() { stat -f %Lp "$1" 2>/dev/null || stat -c %a "$1"; }
count() { ls -1 "$1" 2>/dev/null | wc -l | tr -d ' '; }
# run <cwd> <transcript_path> <trigger>: feeds PreCompact JSON, sets OUT and RC
run() {
  OUT="$(printf '{"session_id":"abc123","transcript_path":"%s","cwd":"%s","hook_event_name":"PreCompact","trigger":"%s","custom_instructions":null}' \
    "$2" "$1" "$3" | python3 "$HERE/snapshot.py")"; RC=$?
}

SRC="$TMP/transcript.jsonl"
printf '{"type":"user","message":"hi"}\n{"type":"assistant","message":"hello"}\n' > "$SRC"
mkdir -p "$TMP/my proj"

# 1. manual trigger: named copy, 0600 file, 0700 dir, nothing printed
run "$TMP/my proj" "$SRC" manual
[ "$RC" = 0 ] || fail "exit $RC"
[ -z "$OUT" ] || fail "printed: $OUT"
F=$(echo "$CLAUDE_MODS_SNAPSHOT_DIR"/my_proj-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]-manual.jsonl)
[ -f "$F" ] || fail "no snapshot named my_proj-YYYYMMDD-HHMMSS-manual.jsonl in $CLAUDE_MODS_SNAPSHOT_DIR: $(ls "$CLAUDE_MODS_SNAPSHOT_DIR")"
cmp -s "$SRC" "$F" || fail "copy differs from source"
[ "$(mode "$F")" = 600 ] || fail "file mode $(mode "$F")"
[ "$(mode "$CLAUDE_MODS_SNAPSHOT_DIR")" = 700 ] || fail "dir mode $(mode "$CLAUDE_MODS_SNAPSHOT_DIR")"
ok "manual snapshot: $(basename "$F") mode 600, dir 700, silent"

# 2. cwd inside a git repo: project = basename of toplevel
git init -q "$TMP/repo" && mkdir -p "$TMP/repo/sub"
run "$TMP/repo/sub" "$SRC" auto
[ "$RC" = 0 ] || fail "exit $RC (git case)"
ls "$CLAUDE_MODS_SNAPSHOT_DIR"/repo-*-auto.jsonl >/dev/null 2>&1 || fail "git toplevel name not used: $(ls "$CLAUDE_MODS_SNAPSHOT_DIR")"
ok "git toplevel basename used for project"

# 3. prune: 40-day-old snapshot deleted, old non-matching file kept, fresh ones kept
OLD="$(python3 -c 'import time;print(time.strftime("%Y%m%d%H%M",time.localtime(time.time()-40*86400)))')"
: > "$CLAUDE_MODS_SNAPSHOT_DIR/old-20250101-120000-auto.jsonl"; : > "$CLAUDE_MODS_SNAPSHOT_DIR/notes.txt"
touch -t "$OLD" "$CLAUDE_MODS_SNAPSHOT_DIR/old-20250101-120000-auto.jsonl" "$CLAUDE_MODS_SNAPSHOT_DIR/notes.txt"
BEFORE=$(count "$CLAUDE_MODS_SNAPSHOT_DIR")
run "$TMP/my proj" "$SRC" auto  # different trigger than step 1: same-second runs share a name
[ ! -e "$CLAUDE_MODS_SNAPSHOT_DIR/old-20250101-120000-auto.jsonl" ] || fail "old snapshot not pruned"
[ -e "$CLAUDE_MODS_SNAPSHOT_DIR/notes.txt" ] || fail "notes.txt was deleted"
[ "$(count "$CLAUDE_MODS_SNAPSHOT_DIR")" = "$BEFORE" ] || fail "expected $BEFORE files (one pruned, one added), got $(count "$CLAUDE_MODS_SNAPSHOT_DIR")"
ok "pruned only the 40-day-old snapshot; notes.txt and fresh snapshots kept"

# 4. missing transcript: exit 0, nothing created
BEFORE=$(count "$CLAUDE_MODS_SNAPSHOT_DIR")
run "$TMP/my proj" "$TMP/does-not-exist.jsonl" manual
[ "$RC" = 0 ] || fail "exit $RC on missing transcript"
[ "$(count "$CLAUDE_MODS_SNAPSHOT_DIR")" = "$BEFORE" ] || fail "file created for missing transcript"
ok "missing transcript: exit 0, nothing created"

# 5. empty stdin: exit 0
OUT="$(python3 "$HERE/snapshot.py" </dev/null)"; RC=$?
[ "$RC" = 0 ] && [ -z "$OUT" ] || fail "empty stdin: exit $RC out '$OUT'"
ok "empty stdin: exit 0, silent"

# 6. disable convention: nothing created at all
export CLAUDE_MODS_SNAPSHOT_DIR="$TMP/snaps2"
CLAUDE_MODS_DISABLE="other-mod,precompact-snapshot" run "$TMP/my proj" "$SRC" manual
[ "$RC" = 0 ] || fail "exit $RC when disabled"
[ ! -e "$CLAUDE_MODS_SNAPSHOT_DIR" ] || fail "disabled hook created $CLAUDE_MODS_SNAPSHOT_DIR"
ok "CLAUDE_MODS_DISABLE=precompact-snapshot creates nothing"

echo "all tests passed"
