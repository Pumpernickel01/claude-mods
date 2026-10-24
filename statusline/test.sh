#!/bin/bash
# Offline tests for statusline.py (bash 3.2). Exit non-zero on failure.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/home"
S5=$'\x1b[38;5;'; S2=$'\x1b[38;2;'

fail() { echo "FAIL: $*" >&2; exit 1; }
ok()   { echo "ok   $*"; }
# json <used_percentage|null> <dir>: FORMATS.md 3 sample, trimmed to the fields the script reads
json() {
  printf '{"cwd":"%s","session_id":"abc123","model":{"id":"claude-opus-5-5","display_name":"Opus"},"workspace":{"current_dir":"%s","project_dir":"%s","added_dirs":[],"git_worktree":"feature-xyz"},"version":"2.1.90","cost":{"total_cost_usd":0.01234,"total_duration_ms":45000},"context_window":{"context_window_size":200000,"used_percentage":%s,"remaining_percentage":null},"effort":{"level":"high"}}' "$2" "$2" "$2" "$1"
}
# run <ENV=val ...>: runs the script with a clean terminal env (this session leaks COLORTERM), JSON on stdin
run() { env -u COLORTERM -u NERD_FONT -u TMUX -u LC_ALL -u LC_CTYPE -u CLAUDE_MODS_DISABLE -u COLUMNS HOME="$TMP/home" LANG=en_US.UTF-8 "$@" python3 "$HERE/statusline.py"; }
apple()   { run TERM_PROGRAM=Apple_Terminal TERM=xterm-256color "$@"; }
ghostty() { run TERM_PROGRAM=ghostty TERM=xterm-ghostty COLORTERM=truecolor "$@"; }

# fixtures: one dirty repo, one clean repo, one plain dir (separate dirs because results are cached 3 s)
git -c init.defaultBranch=main init -q "$TMP/dirty" && echo a > "$TMP/dirty/f" && git -C "$TMP/dirty" add f && echo b > "$TMP/dirty/f"
git -c init.defaultBranch=main init -q "$TMP/clean"
mkdir -p "$TMP/plain"

# (a) Terminal.app: 256-colour only, thresholds, null, glyphs, git, worktree
OUT="$(json 30 "$TMP/dirty" | apple)"
[[ $OUT == *"$S5"* ]]   || fail "(a) no 256-colour SGR: $OUT"
[[ $OUT != *"$S2"* ]]   || fail "(a) emitted 24-bit SGR: $OUT"
[[ $OUT == *"${S5}114m"* ]] || fail "(a) 30% not green: $OUT"
[[ $OUT == *"Opus  "* ]] || fail "(a) model missing: $OUT"
[[ $OUT == *"git:main●"* ]] || fail "(a) dirty branch mark missing: $OUT"
[[ $OUT == *"wt:feature-xyz"* ]] || fail "(a) worktree missing: $OUT"
[[ $OUT == *"ctx 30% [███░░░░░░░]"* ]] || fail "(a) bar wrong: $OUT"
[[ $OUT == *'$0.01'* ]] || fail "(a) cost missing: $OUT"
[[ $OUT == *"effort:high"* ]] || fail "(a) effort missing: $OUT"
ok "(a) Apple_Terminal 30%: 256-colour only, green, git:main● wt, bar, cost, effort"
[[ "$(json 60 "$TMP/dirty" | apple)" == *"${S5}114m"* ]] || fail "(a) 60% not green"
[[ "$(json 65 "$TMP/dirty" | apple)" == *"${S5}178m"* ]] || fail "(a) 65% not yellow"
[[ "$(json 80 "$TMP/dirty" | apple)" == *"${S5}178m"* ]] || fail "(a) 80% not yellow"
[[ "$(json 85 "$TMP/dirty" | apple)" == *"${S5}167m"*"[█████████░]"* ]] || fail "(a) 85% not red"
ok "(a) colour switches: 60 green, 65 yellow, 80 yellow, 85 red"
OUT="$(json null "$TMP/dirty" | apple)"
[[ $OUT == *"ctx –"* && $OUT != *" ["* ]] || fail "(a) null ctx: $OUT"
ok "(a) null used_percentage renders 'ctx –' without a bar"
OUT="$(json 30 "$TMP/clean" | apple)"
[[ $OUT == *"git:main○"* ]] || fail "(a) clean mark: $OUT"
OUT="$(json 30 "$TMP/plain" | apple)"
[[ $OUT != *"git:"* ]] || fail "(a) non-repo showed git: $OUT"
ok "(a) clean repo ○, non-repo shows no git segment"
git -c init.defaultBranch=main init -q "$TMP/detached" && git -C "$TMP/detached" -c user.name=t -c user.email=t@t commit -q --allow-empty -m x && git -C "$TMP/detached" checkout -q --detach
OUT="$(json 30 "$TMP/detached" | apple)"
[[ $OUT =~ git:[0-9a-f]{7,}○ ]] || fail "(a) detached HEAD should show short SHA: $OUT"
ok "(a) detached HEAD falls back to the short SHA"

# (b) Ghostty: 24-bit colour, same thresholds
OUT="$(json 30 "$TMP/dirty" | ghostty)"
[[ $OUT == *"${S2}135;215;135m"* ]] || fail "(b) no 24-bit green: $OUT"
[[ "$(json 65 "$TMP/dirty" | ghostty)" == *"${S2}215;175;0m"* ]] || fail "(b) 65% not yellow"
[[ "$(json 85 "$TMP/dirty" | ghostty)" == *"${S2}215;95;95m"* ]] || fail "(b) 85% not red"
ok "(b) ghostty: 24-bit SGR, green/yellow/red at 30/65/85"
OUT="$(json 30 "$TMP/dirty" | ghostty NERD_FONT=1)"
[[ $OUT == *$'\xee\x82\xa0 main●'* && $OUT == *$'\xef\x8b\x9b Opus'* ]] || fail "(b) nerd glyphs: $OUT"
ok "(b) NERD_FONT=1 uses U+E0A0 branch and U+F2DB model glyphs"

# (c) LANG=C: pure ASCII
OUT="$(json 30 "$TMP/dirty" | run TERM_PROGRAM=Apple_Terminal TERM=xterm-256color LANG=C LC_ALL=C)"
[[ $OUT == *"git:main*"*"ctx 30% [###.......]"* ]] || fail "(c) ascii: $OUT"
[[ "$(json null "$TMP/clean" | run TERM_PROGRAM=Apple_Terminal TERM=xterm-256color LANG=C LC_ALL=C)" == *"git:main-"*"ctx -"* ]] || fail "(c) ascii null/clean"
LC_ALL=C python3 -c 'import sys; sys.exit(0 if all(ord(c) < 128 for c in sys.argv[1]) else 1)' "$OUT" || fail "(c) non-ASCII byte in: $OUT"
ok "(c) LANG=C falls back to * - # . and 'ctx -'"

# width: COLUMNS drops bar, then cost, then effort
FULL="$(json 30 "$TMP/dirty" | apple COLUMNS=200)"
[[ $FULL == *" ["* ]] || fail "COLUMNS=200 dropped the bar: $FULL"
# visible widths of this fixture: full 72, no bar 59, no bar+cost 52, no bar+cost+effort 39
OUT="$(json 30 "$TMP/dirty" | apple COLUMNS=60)"
[[ $OUT != *" ["* && $OUT == *'$0.01'* ]] || fail "COLUMNS=60 should drop only the bar: $OUT"
OUT="$(json 30 "$TMP/dirty" | apple COLUMNS=55)"
[[ $OUT != *'$'* && $OUT == *"effort"* ]] || fail "COLUMNS=55 should drop bar+cost: $OUT"
OUT="$(json 30 "$TMP/dirty" | apple COLUMNS=40)"
[[ $OUT != *" ["* && $OUT != *"effort"* && $OUT == *"ctx 30%"* ]] || fail "COLUMNS=40 should drop bar, cost, effort: $OUT"
ok "COLUMNS=60 drops the bar, 55 drops cost too, 40 drops effort too"

# disable, empty stdin, bad input
[ -z "$(json 30 "$TMP/dirty" | apple CLAUDE_MODS_DISABLE=other,statusline)" ] || fail "disabled but printed"
[ -z "$(apple </dev/null)" ] || fail "empty stdin printed"
OUT="$(printf '{"model":{"display_name":"Opus"},"context_window":"garbage"}' | apple)"; RC=$?
[ "$RC" = 0 ] && [ "$OUT" = "Opus" ] || fail "bad input: rc=$RC out=$OUT"
OUT="$(printf '{bad json' | apple)"; RC=$?
[ "$RC" = 0 ] && [ "$OUT" = "Claude" ] || fail "bad json: rc=$RC out=$OUT"
ok "disable prints nothing; empty stdin silent; bad input prints model name, exit 0"

# wrapper
[[ "$(json 30 "$TMP/dirty" | env -u COLORTERM HOME="$TMP/home" TERM_PROGRAM=Apple_Terminal bash "$HERE/statusline.sh")" == *"git:main●"* ]] || fail "statusline.sh wrapper"
ok "statusline.sh wrapper execs the python with stdin"

# cache file exists and is reused (3 s)
ls "$TMP/home/.cache/claude-mods/statusline/"*.json >/dev/null 2>&1 || fail "no cache files"
ok "git cache written to ~/.cache/claude-mods/statusline/"

# performance: 20 runs each, cold (cache removed before every run) and cached; p95 must be < 100 ms
json 30 "$TMP/dirty" > "$TMP/payload.json"
PERF="$(env -u COLORTERM HOME="$TMP/home" TERM_PROGRAM=Apple_Terminal TERM=xterm-256color python3 - "$HERE/statusline.py" "$TMP/payload.json" "$TMP/home/.cache/claude-mods/statusline" <<'EOF'
import shutil, subprocess, sys, time
script, payload, cache = sys.argv[1:4]
data = open(payload, "rb").read()
def bench(cold):
    ts = []
    for _ in range(20):
        if cold:
            shutil.rmtree(cache, ignore_errors=True)
        t = time.perf_counter()
        subprocess.run([sys.executable, script], input=data, capture_output=True)
        ts.append((time.perf_counter() - t) * 1000)
    ts.sort()
    return ts[9], ts[18]
for name, cold in (("cold git repo", True), ("cached", False)):
    p50, p95 = bench(cold)
    print(f"{name}: p50 {p50:.1f} ms  p95 {p95:.1f} ms")
    if p95 >= 100:
        sys.exit(1)
EOF
)" || fail "p95 >= 100 ms: $PERF"
echo "$PERF" | sed 's/^/     /'
ok "p95 < 100 ms (cold and cached)"

echo "all tests passed"
