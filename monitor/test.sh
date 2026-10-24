#!/bin/bash
# Offline tests for the agent monitor (bash 3.2, < 30 s, exit 1 on any failure):
#   1. hooks/emit.py with FORMATS-shaped stdin for every event kind, timing, disable env
#   2. headless TUI under Terminal.app-like and Ghostty-like env (uv run, Textual from cache)
#   3. monitor.sh with fake osascript/tmux on PATH (no window is ever opened)
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
export CLAUDE_MODS_EVENT_LOG="$TMP/events.jsonl"
unset CLAUDE_MODS_DISABLE CLAUDE_MODS_MONITOR_AUTO TMUX
LOG="$CLAUDE_MODS_EVENT_LOG"
pass=0; fail=0
ok()    { pass=$((pass+1)); echo "ok   - $1"; }
bad()   { fail=$((fail+1)); echo "FAIL - $1"; }
check() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (got '$2', want '$3')"; fi; }
hook()  { printf '%s' "$2" | python3 "$HERE/hooks/emit.py" "$1"; }
field() { tail -1 "$LOG" | python3 -c 'import json,sys; v=json.load(sys.stdin).get(sys.argv[1]); print(json.dumps(v, sort_keys=True) if isinstance(v,(dict,list)) else v)' "$1"; }
lines() { [ -f "$LOG" ] && wc -l < "$LOG" | tr -d ' ' || echo 0; }

echo "# 1. hooks"
BASE='"session_id":"abc123","transcript_path":"/tmp/x.jsonl","cwd":"/tmp/proj","permission_mode":"default"'
LONG="$(printf 'p%.0s' $(seq 1 200))"
cat > "$TMP/agent.jsonl" <<EOF
{"type":"assistant","agentId":"a1","message":{"id":"m1","usage":{"input_tokens":10,"output_tokens":5,"cache_read_input_tokens":100,"cache_creation_input_tokens":50}}}
{"type":"assistant","agentId":"a1","message":{"id":"m1","usage":{"input_tokens":10,"output_tokens":5,"cache_read_input_tokens":100,"cache_creation_input_tokens":50}}}
{"type":"user","message":{"role":"user","content":"tool result"}}
not json at all
{"type":"assistant","agentId":"a1","message":{"id":"m2","usage":{"input_tokens":1,"output_tokens":2,"cache_read_input_tokens":3,"cache_creation_input_tokens":4}}}
EOF
out="$(hook session_start "{$BASE,\"hook_event_name\":\"SessionStart\",\"source\":\"startup\"}")"
check "session_start event" "$(field event)" "session_start"
check "session_start keeps session_id" "$(field session_id)" "abc123"
check "hooks print nothing on stdout" "$out" ""
hook agent_start "{$BASE,\"hook_event_name\":\"PreToolUse\",\"agent_id\":\"aparent\",\"agent_type\":\"general-purpose\",\"tool_name\":\"Agent\",\"tool_input\":{\"description\":\"Explore repo\",\"subagent_type\":\"Explore\",\"prompt\":\"$LONG\"},\"tool_use_id\":\"toolu_01\"}"
check "PreToolUse Agent -> agent_start" "$(field event)" "agent_start"
check "  agent_id is null (not yet known)" "$(field agent_id)" "None"
check "  spawner recorded as parent_agent_id" "$(field parent_agent_id)" "aparent"
check "  agent_type from subagent_type" "$(field agent_type)" "Explore"
check "  description" "$(field description)" "Explore repo"
check "  task is first 120 chars of prompt" "$(field task | wc -c | tr -d ' ')" "121"
check "  tool_use_id" "$(field tool_use_id)" "toolu_01"
hook agent_start "{$BASE,\"hook_event_name\":\"SubagentStart\",\"agent_id\":\"a1\",\"agent_type\":\"Explore\"}"
check "SubagentStart -> agent_start with agent_id" "$(field agent_id)" "a1"
hook tool_end "{$BASE,\"hook_event_name\":\"PostToolUse\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"npm test\"},\"tool_response\":{},\"tool_use_id\":\"toolu_02\",\"duration_ms\":12}"
check "PostToolUse -> tool_end" "$(field event)" "tool_end"
check "  tool" "$(field tool)" "Bash"
check "  main session agent_id null" "$(field agent_id)" "None"
check "  duration_ms" "$(field duration_ms)" "12"
check "  status done" "$(field status)" "done"
check "  no tool_input leaked" "$(field tool_input)" "None"
hook tool_end "{$BASE,\"hook_event_name\":\"PostToolUse\",\"agent_id\":\"a1\",\"agent_type\":\"Explore\",\"tool_name\":\"SendMessage\",\"tool_input\":{\"to\":\"a2\",\"summary\":\"hi\",\"message\":\"secret body\"},\"tool_response\":{},\"tool_use_id\":\"toolu_03\",\"duration_ms\":3}"
check "SendMessage records to" "$(field to)" "a2"
check "  sender agent_id" "$(field agent_id)" "a1"
hook tool_fail "{$BASE,\"hook_event_name\":\"PostToolUseFailure\",\"tool_name\":\"Edit\",\"tool_input\":{},\"tool_use_id\":\"toolu_04\",\"error\":\"boom\",\"is_interrupt\":false,\"duration_ms\":5}"
check "PostToolUseFailure -> tool_end failed" "$(field status)" "failed"
check "  tool" "$(field tool)" "Edit"
check "  error text not logged" "$(field error)" "None"
hook agent_stop "{$BASE,\"hook_event_name\":\"SubagentStop\",\"stop_hook_active\":false,\"agent_id\":\"a1\",\"agent_type\":\"Explore\",\"agent_transcript_path\":\"$TMP/agent.jsonl\",\"last_assistant_message\":\"done\"}"
check "SubagentStop -> agent_stop" "$(field event)" "agent_stop"
check "  tokens summed once per message id" "$(field tokens)" '{"cache_creation_input_tokens": 54, "cache_read_input_tokens": 103, "input_tokens": 11, "output_tokens": 7}'
check "  last_assistant_message not logged" "$(field last_assistant_message)" "None"
hook agent_stop "{$BASE,\"hook_event_name\":\"SubagentStop\",\"agent_id\":\"a9\",\"agent_type\":\"Plan\",\"agent_transcript_path\":\"$TMP/missing.jsonl\"}"
check "  missing transcript -> no tokens field" "$(field tokens)" "None"
hook session_stop "{$BASE,\"hook_event_name\":\"Stop\",\"stop_hook_active\":true,\"last_assistant_message\":\"x\"}"
check "Stop -> session_stop" "$(field event)" "session_stop"
hook session_end "{$BASE,\"hook_event_name\":\"SessionEnd\",\"reason\":\"other\"}"
check "SessionEnd -> session_end" "$(field event)" "session_end"
check "  reason" "$(field reason)" "other"
n="$(lines)"
CLAUDE_MODS_DISABLE=notify,monitor hook tool_end "{$BASE,\"hook_event_name\":\"PostToolUse\",\"tool_name\":\"Bash\",\"tool_input\":{},\"tool_use_id\":\"t\"}"
check "disabled via CLAUDE_MODS_DISABLE -> no line" "$(lines)" "$n"
printf '' | python3 "$HERE/hooks/emit.py" tool_end; check "empty stdin -> exit 0, no line" "$?:$(lines)" "0:$n"
printf 'garbage' | python3 "$HERE/hooks/emit.py" tool_end; check "bad JSON -> exit 0" "$?" "0"
python3 - "$HERE/hooks/emit.py" "$TMP/agent.jsonl" <<'EOF' || bad "hook timing"
import json, subprocess, sys, time
emit, tr = sys.argv[1], sys.argv[2]
base = {"session_id": "abc123", "cwd": "/tmp/proj", "tool_name": "Bash", "tool_input": {}, "tool_use_id": "t"}
cases = {"session_start": {"hook_event_name": "SessionStart"},
         "agent_start": {"hook_event_name": "PreToolUse", "tool_name": "Agent", "tool_input": {"prompt": "x"}},
         "tool_end": {"hook_event_name": "PostToolUse"}, "tool_fail": {"hook_event_name": "PostToolUseFailure"},
         "agent_stop": {"hook_event_name": "SubagentStop", "agent_id": "a1", "agent_transcript_path": tr},
         "session_stop": {"hook_event_name": "Stop"}, "session_end": {"hook_event_name": "SessionEnd"}}
worst = 0
for kind, extra in cases.items():
    data = json.dumps({**base, **extra}).encode()
    t0 = time.perf_counter()
    for _ in range(10):
        subprocess.run([sys.executable, emit, kind], input=data, check=True)
    ms = (time.perf_counter() - t0) * 100
    worst = max(worst, ms)
    print(f"     {kind:14s} {ms:5.1f} ms avg of 10")
print(("ok   - " if worst < 50 else "FAIL - ") + f"every hook kind < 50 ms (worst {worst:.1f} ms)")
sys.exit(0 if worst < 50 else 1)
EOF
[ $? -eq 0 ] && pass=$((pass+1)) || fail=$((fail+1))

echo "# fakes for monitor.sh (nothing real is opened)"
mkdir -p "$TMP/bin"
export FAKE_LOG="$TMP/fake.log"
cat > "$TMP/bin/osascript" <<'EOF'
#!/bin/bash
printf '%s\n' "$*" >> "$FAKE_LOG"
case "$*" in
  *screen.js*) echo "0 25 1728 1117" ;;
  *ghostty_open*) echo "terminal:t-1" ;;
  *terminal_open*) echo "4242" ;;
esac
EOF
cat > "$TMP/bin/tmux" <<'EOF'
#!/bin/bash
printf '%s\n' "$*" >> "$FAKE_LOG"
[ "$1" = split-window ] && echo "%7"
EOF
chmod +x "$TMP/bin/osascript" "$TMP/bin/tmux"
export PATH="$TMP/bin:$PATH"
META="$TMP/monitor.json"; PIDF="$TMP/monitor.pid"
SH="$HERE/monitor.sh"

echo "# auto-open handshake: PreToolUse Agent opens, SessionEnd closes"
rm -f "$FAKE_LOG"
CLAUDE_MODS_MONITOR_AUTO=1 TMUX=/tmp/fake,1,0 hook agent_start "{$BASE,\"hook_event_name\":\"PreToolUse\",\"tool_name\":\"Agent\",\"tool_input\":{\"description\":\"d\",\"subagent_type\":\"Explore\",\"prompt\":\"p\"},\"tool_use_id\":\"toolu_05\"}"
i=0; while [ ! -f "$META" ] && [ $i -lt 30 ]; do sleep 0.1; i=$((i+1)); done
check "monitor.json written by detached monitor.sh open" "$(python3 -c 'import json,sys; m=json.load(open(sys.argv[1])); print(m["backend"], m["id"], m["session_id"])' "$META" 2>/dev/null)" "tmux %7 abc123"
grep -q '^split-window -h -l 45% -P -F #{pane_id} cd ' "$FAKE_LOG" && ok "tmux split-window received the monitor command" || bad "tmux split-window args: $(cat "$FAKE_LOG" 2>/dev/null)"
hook session_end "{\"session_id\":\"other\",\"hook_event_name\":\"SessionEnd\",\"reason\":\"other\"}"
sleep 0.3; [ -f "$META" ] && ok "SessionEnd of another session leaves the monitor alone" || bad "closed by a foreign session"
hook session_end "{$BASE,\"hook_event_name\":\"SessionEnd\",\"reason\":\"other\"}"
i=0; while [ -f "$META" ] && [ $i -lt 30 ]; do sleep 0.1; i=$((i+1)); done
[ -f "$META" ] && bad "SessionEnd did not close the auto-opened monitor" || ok "SessionEnd closes the auto-opened monitor"
grep -q '^kill-pane -t %7$' "$FAKE_LOG" && ok "tmux kill-pane %7" || bad "no kill-pane: $(cat "$FAKE_LOG")"

echo "# 2. TUI headless, both terminal env sets"
python3 - "$TMP/synthetic.jsonl" <<'EOF'
import json, sys, time
S = "sess0001-0000-0000-0000-000000000000"
t0 = time.time() - 300
def rec(i, event, status, **kw):
    r = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(t0 + i)) + ".000Z", "event": event, "status": status,
         "session_id": S, "agent_id": None, "agent_type": None, "cwd": "/tmp/proj", "transcript_path": None}
    r.update(kw); return r
recs = [
    rec(0, "session_start", "running", source="startup"),
    rec(1, "agent_start", "running", agent_type="Explore", description="Explore the repo layout", task="Find every caller of foo()", tool_use_id="toolu_a1"),
    rec(2, "agent_start", "running", agent_id="a1a1a1a1", agent_type="Explore"),
    rec(3, "agent_start", "running", agent_type="general-purpose", description="Review the diff", task="Review src/ for bugs", tool_use_id="toolu_a2"),
    rec(4, "agent_start", "running", agent_id="b2b2b2b2", agent_type="general-purpose"),
    rec(5, "tool_end", "done", agent_id="a1a1a1a1", agent_type="Explore", tool="Read", duration_ms=12, tool_use_id="t1"),
    rec(6, "tool_end", "done", agent_id="b2b2b2b2", agent_type="general-purpose", tool="Grep", duration_ms=30, tool_use_id="t2"),
    rec(7, "tool_end", "done", tool="SendMessage", to="a1a1a1a1", duration_ms=2, tool_use_id="t3"),
    rec(8, "tool_end", "done", agent_id="a1a1a1a1", agent_type="Explore", tool="SendMessage", to="b2b2b2b2", duration_ms=2, tool_use_id="t4"),
    rec(9, "agent_start", "running", agent_type="Plan", description="Plan the migration", task="Plan it", tool_use_id="toolu_a3"),
    rec(10, "tool_end", "failed", tool="Agent", duration_ms=40, tool_use_id="toolu_a3"),
    rec(11, "tool_start", "running", tool="Bash"),  # another mod's record: ignored
    rec(12, "agent_stop", "done", agent_id="b2b2b2b2", agent_type="general-purpose",
        tokens={"input_tokens": 1000, "output_tokens": 500, "cache_read_input_tokens": 15000, "cache_creation_input_tokens": 4000}),
    rec(13, "tool_end", "done", tool="Bash", duration_ms=5, tool_use_id="t5"),
]
with open(sys.argv[1], "w") as f:
    f.write("\n".join(json.dumps(r) for r in recs) + "\nthis line is not json\n")
EOF
for envset in "TERM_PROGRAM=Apple_Terminal TERM=xterm-256color" "TERM_PROGRAM=ghostty TERM=xterm-ghostty COLORTERM=truecolor"; do
  out="$(env -u COLORTERM -u TEXTUAL_COLOR_SYSTEM $envset uv run --quiet --no-project --with 'textual>=0.80,<2' python "$HERE/test_tui.py" "$TMP/synthetic.jsonl" 2>&1)"
  rc=$?
  first="$(printf '%s\n' "$out" | head -1)"
  case "$envset" in
    TERM_PROGRAM=Apple_Terminal*) want="ok tui TERM_PROGRAM=Apple_Terminal truecolor=False TEXTUAL_COLOR_SYSTEM=256" ;;
    *) want="ok tui TERM_PROGRAM=ghostty truecolor=True TEXTUAL_COLOR_SYSTEM=None" ;;
  esac
  if [ $rc -eq 0 ] && [ "$first" = "$want" ]; then ok "TUI under $envset"; printf '%s\n' "$out" | tail -n +2 | sed 's/^/     |/'
  else bad "TUI under $envset (rc=$rc)"; printf '%s\n' "$out" | tail -20; fi
done

echo "# 3. monitor.sh backends"
run_sh() { rm -f "$FAKE_LOG" "$META" "$PIDF"; env -u TMUX "$@"; }
out="$(run_sh env TMUX=/tmp/fake,1,0 TERM_PROGRAM=ghostty bash "$SH" open sid1)"
check "tmux wins over TERM_PROGRAM" "$out" "monitor opened: tmux pane %7"
check "  meta" "$(python3 -c 'import json,sys; m=json.load(open(sys.argv[1])); print(m["backend"], m["id"], m["session_id"])' "$META")" "tmux %7 sid1"
out="$(bash "$SH" status)"; check "  status without pid" "$out" "monitor not running"
TMUX=/tmp/fake,1,0 bash "$SH" close >/dev/null; grep -q '^kill-pane -t %7$' "$FAKE_LOG" && ok "  close kills the pane" || bad "  close: $(cat "$FAKE_LOG")"
[ -f "$META" ] && bad "  meta not removed" || ok "  meta removed"

out="$(run_sh env TERM_PROGRAM=ghostty TERM=xterm-ghostty bash "$SH" open)"
check "ghostty backend" "$out" "monitor opened: Ghostty terminal t-1"
grep -q "^$HERE/applescript/ghostty_open.applescript shell:cd '" "$FAKE_LOG" && ok "  osascript got script path + shell: command as argv" || bad "  osascript args: $(cat "$FAKE_LOG")"
bash "$SH" close >/dev/null; grep -q "^$HERE/applescript/ghostty_close.applescript terminal t-1$" "$FAKE_LOG" && ok "  close passes kind + id" || bad "  close: $(cat "$FAKE_LOG")"

out="$(run_sh env TERM_PROGRAM=Apple_Terminal TERM=xterm-256color bash "$SH" open)"
check "apple_terminal backend" "$out" "monitor opened: Terminal.app window 4242"
grep -q "^-l JavaScript $HERE/applescript/screen.js$" "$FAKE_LOG" && ok "  screen size via JXA" || bad "  no screen.js call"
grep -q "^$HERE/applescript/terminal_open.applescript cd '.*monitor.py; exit 0 25 1728 1117$" "$FAKE_LOG" && ok "  terminal_open got command + 4 screen numbers" || bad "  terminal_open args: $(cat "$FAKE_LOG")"
bash "$SH" close >/dev/null; grep -q "^$HERE/applescript/terminal_close.applescript 4242$" "$FAKE_LOG" && ok "  close passes window id" || bad "  close: $(cat "$FAKE_LOG")"

out="$(run_sh env TERM_PROGRAM=herdr bash "$SH" open)"
check "unknown terminal falls back to Terminal.app and says so" "$out" "monitor opened: Terminal.app window 4242 (terminal 'herdr' is not scriptable; used Terminal.app)"
bash "$SH" close >/dev/null

echo 999999 > "$PIDF"
check "status with stale pid file" "$(bash "$SH" status)" "monitor not running (stale pid file)"
check "close with stale pid file" "$(bash "$SH" close)" "monitor not running"
[ -f "$PIDF" ] && bad "  stale pid file not removed" || ok "  stale pid file removed"
check "toggle with nothing running opens" "$(run_sh env TERM_PROGRAM=Apple_Terminal bash "$SH" toggle)" "monitor opened: Terminal.app window 4242"
echo $$ > "$PIDF"; check "status with live pid" "$(bash "$SH" status)" "monitor running (pid $$, terminal 4242)"
check "open while running is a no-op" "$(bash "$SH" open)" "monitor already running (pid $$)"
rm -f "$PIDF" "$META"
check "bad argument -> usage, exit 2" "$(bash "$SH" bogus >/dev/null 2>&1; echo $?)" "2"

echo "# AppleScript grammar (compile only, nothing runs)"
for f in terminal_open terminal_close; do
  /usr/bin/osacompile -o "$TMP/$f.scpt" "$HERE/applescript/$f.applescript" 2>"$TMP/err" && ok "  $f.applescript compiles" || bad "  $f: $(cat "$TMP/err")"
done
if [ -d /Applications/Ghostty.app ]; then
  for f in ghostty_open ghostty_close; do
    /usr/bin/osacompile -o "$TMP/$f.scpt" "$HERE/applescript/$f.applescript" 2>"$TMP/err" && ok "  $f.applescript compiles against Ghostty.sdef" || bad "  $f: $(cat "$TMP/err")"
  done
else echo "skip - Ghostty not installed, its scripts not compiled"; fi
scr="$(/usr/bin/osascript -l JavaScript "$HERE/applescript/screen.js" 2>&1)"
case "$scr" in [0-9]*\ [0-9]*\ [0-9]*\ [0-9]*) ok "  screen.js returns 4 integers ($scr)";; *) bad "  screen.js: $scr";; esac

echo "# $pass passed, $fail failed"
[ "$fail" -eq 0 ]
