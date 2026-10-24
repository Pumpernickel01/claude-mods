#!/bin/bash
# Offline tests for the agent monitor (bash 3.2, < 30 s, exit 1 on any failure):
#   1. hooks/emit.py with FORMATS-shaped stdin for every event kind, timing, disable env
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
export CLAUDE_MODS_EVENT_LOG="$TMP/events.jsonl"
unset CLAUDE_MODS_DISABLE
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

echo "# log rotation: parallel writers rotate once and keep the rotated file"
python3 - "$HERE/../lib" "$TMP/rot/events.jsonl" <<'EOF2' && pass=$((pass+1)) || fail=$((fail+1))
import os, subprocess, sys
lib, log = sys.argv[1], sys.argv[2]
sys.path.insert(0, lib); os.environ["CLAUDE_MODS_EVENT_LOG"] = log
import events
os.makedirs(os.path.dirname(log), exist_ok=True)
with open(log, "wb") as f:
    f.write(b"x" * (events.ROTATE_BYTES + 1))
code = "import sys; sys.path.insert(0, sys.argv[1]); import events; events.emit('t', 'done', {'session_id': 's'})"
env = {**os.environ, "CLAUDE_MODS_EVENT_LOG": log}
for p in [subprocess.Popen([sys.executable, "-c", code, lib], env=env) for _ in range(8)]:
    p.wait()
kept, lines = os.path.getsize(log + ".1"), open(log).read().count("\n")
ok = kept == events.ROTATE_BYTES + 1 and lines == 8
print(("ok   - " if ok else "FAIL - ") + f"8 parallel writers: rotated file kept whole ({kept} bytes), {lines} lines in the new log")
sys.exit(0 if ok else 1)
EOF2

echo "# $pass passed, $fail failed"
[ "$fail" -eq 0 ]
