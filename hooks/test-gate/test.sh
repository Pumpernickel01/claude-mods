#!/bin/bash
# Offline tests for test-gate. Run: bash test.sh   (exit non-zero on any failure)
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
GATE="$HERE/test_gate.py"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

export HOME="$TMP/home"                      # isolates ~/.cache marker and git config
mkdir -p "$HOME" "$TMP/bin"
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.com GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.com
export FAKE_NPM_LOG="$TMP/npm.log"
cat > "$TMP/bin/npm" <<'EOF'
#!/bin/bash
echo "$*" >> "$FAKE_NPM_LOG"
echo "  1) adds numbers"
echo "  1 failing"
exit "${FAKE_NPM_EXIT:-1}"
EOF
chmod +x "$TMP/bin/npm"
export PATH="$TMP/bin:$PATH"
unset CLAUDE_MODS_SKIP_TESTS CLAUDE_MODS_TEST_TIMEOUT CLAUDE_MODS_DISABLE

fails=0
ok()   { echo "ok   - $1"; }
bad()  { echo "FAIL - $1"; fails=$((fails + 1)); }

mkrepo() {  # $1 dir: git init + one commit of everything in it, then dirty tracked.txt
  echo base > "$1/tracked.txt"
  git -C "$1" init -q && git -C "$1" add -A && git -C "$1" commit -q -m init
  echo change >> "$1/tracked.txt"
}
run_gate() {  # $1 cwd, $2 session_id, $3 stop_hook_active
  printf '{"session_id":"%s","transcript_path":"/tmp/t.jsonl","cwd":"%s","hook_event_name":"Stop","stop_hook_active":%s,"last_assistant_message":"done"}' \
    "$2" "$1" "$3" | python3 "$GATE"
}

# --- npm project -----------------------------------------------------------
NPM="$TMP/npm-proj"; mkdir -p "$NPM"
echo '{"name":"x","scripts":{"test":"mocha"}}' > "$NPM/package.json"
mkrepo "$NPM"

out="$(run_gate "$NPM" s1 false)"
case "$out" in *'"decision": "block"'*'npm test --silent'*'1 failing'*) ok "(a) failing npm test -> block with tail";;
  *) bad "(a) failing npm test -> block with tail: $out";; esac
[ "$(grep -c 'test --silent' "$FAKE_NPM_LOG")" = 1 ] && ok "(a) fake npm called exactly once" || bad "(a) fake npm called exactly once"

out="$(run_gate "$NPM" s1 false)"
case "$out" in *'"decision"'*) bad "(h) same tree hash twice -> second run does not block: $out";;
  *'"systemMessage"'*'still fails'*) ok "(h) same tree hash twice -> systemMessage, no block";;
  *) bad "(h) same tree hash twice -> systemMessage, no block: $out";; esac

out="$(FAKE_NPM_EXIT=0 run_gate "$NPM" s1 false)"
[ -z "$out" ] && ok "(b) passing npm test -> silent" || bad "(b) passing npm test -> silent: $out"

out="$(run_gate "$NPM" s1 true)"
[ -z "$out" ] && ok "(d) stop_hook_active -> silent" || bad "(d) stop_hook_active -> silent: $out"

out="$(CLAUDE_MODS_SKIP_TESTS=1 run_gate "$NPM" s1 false)"
[ -z "$out" ] && ok "(e) CLAUDE_MODS_SKIP_TESTS=1 -> silent" || bad "(e) CLAUDE_MODS_SKIP_TESTS=1 -> silent: $out"

out="$(CLAUDE_MODS_DISABLE=other,test-gate run_gate "$NPM" s1 false)"
[ -z "$out" ] && ok "(j) CLAUDE_MODS_DISABLE -> silent" || bad "(j) CLAUDE_MODS_DISABLE -> silent: $out"

# (c) clean tree: npm must not be called
git -C "$NPM" checkout -q -- tracked.txt
: > "$FAKE_NPM_LOG"
out="$(run_gate "$NPM" s1 false)"
[ -z "$out" ] && [ ! -s "$FAKE_NPM_LOG" ] && ok "(c) clean tree -> silent, npm not called" || bad "(c) clean tree -> silent, npm not called: $out"

# --- Makefile projects -----------------------------------------------------
MK="$TMP/make-proj"; mkdir -p "$MK"
printf 'test:\n\texit 3\n' > "$MK/Makefile"
mkrepo "$MK"
out="$(run_gate "$MK" s2 false)"
case "$out" in *'"decision": "block"'*'make test'*'exit 3'*) ok "(f) make test exit 3 -> block";;
  *) bad "(f) make test exit 3 -> block: $out";; esac

SLOW="$TMP/slow-proj"; mkdir -p "$SLOW"
printf 'test:\n\tsleep 5\n' > "$SLOW/Makefile"
mkrepo "$SLOW"
t0=$SECONDS
out="$(CLAUDE_MODS_TEST_TIMEOUT=1 run_gate "$SLOW" s3 false)"
case "$out" in *'"decision"'*) bad "(g) timeout -> no block: $out";;
  *'"systemMessage"'*'exceeded 1s'*) ok "(g) timeout -> systemMessage";;
  *) bad "(g) timeout -> systemMessage: $out";; esac
[ $((SECONDS - t0)) -lt 4 ] && ok "(g) gate returned promptly after timeout" || bad "(g) gate took $((SECONDS - t0))s"

# --- nothing to run ----------------------------------------------------------
NONE="$TMP/none-proj"; mkdir -p "$NONE"
echo hi > "$NONE/README.md"
mkrepo "$NONE"
out="$(run_gate "$NONE" s4 false)"
[ -z "$out" ] && ok "(i) no test setup -> silent" || bad "(i) no test setup -> silent: $out"

PH="$TMP/placeholder-proj"; mkdir -p "$PH"
echo '{"scripts":{"test":"echo \"Error: no test specified\" && exit 1"}}' > "$PH/package.json"
mkrepo "$PH"
out="$(run_gate "$PH" s5 false)"
[ -z "$out" ] && ok "(l) npm placeholder test script -> silent" || bad "(l) npm placeholder test script -> silent: $out"

NOGIT="$TMP/nogit"; mkdir -p "$NOGIT"
echo '{"scripts":{"test":"mocha"}}' > "$NOGIT/package.json"
out="$(run_gate "$NOGIT" s6 false)"
[ -z "$out" ] && ok "(k) not a git repo -> silent" || bad "(k) not a git repo -> silent: $out"

out="$(printf '' | python3 "$GATE")"
[ -z "$out" ] && ok "(m) empty stdin -> silent" || bad "(m) empty stdin -> silent: $out"

echo "---"
[ "$fails" = 0 ] && echo "all tests passed" || echo "$fails test(s) FAILED"
exit "$fails"
