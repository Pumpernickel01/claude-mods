#!/usr/bin/env python3
"""Agent-monitor event hooks: `python3 emit.py <kind>` reads the hook stdin JSON and
appends one record to ~/.claude/agent-monitor/events.jsonl through lib/events.py.

kinds (see REPORT.md for the hooks.json wiring):
  session_start  SessionStart            agent_start  PreToolUse Agent + SubagentStart
  tool_end       PostToolUse *           tool_fail    PostToolUseFailure *
  agent_stop     SubagentStop (sums the subagent transcript's token usage)
  session_stop   Stop                    session_end  SessionEnd (closes an auto-opened monitor)
Never blocks, never prints: any failure exits 0 quietly.
"""
import json
import os
import sys
import time

if "monitor" in os.environ.get("CLAUDE_MODS_DISABLE", "").split(","):
    sys.exit(0)

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.environ.get("CLAUDE_PLUGIN_ROOT") or os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, "lib"))
from events import LOG_PATH, emit  # noqa: E402

STATE_DIR = os.path.dirname(LOG_PATH)
PID_FILE = os.path.join(STATE_DIR, "monitor.pid")
META_FILE = os.path.join(STATE_DIR, "monitor.json")
MONITOR_SH = os.path.join(ROOT, "monitor", "monitor.sh")
USAGE_KEYS = ("input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")


def transcript_tokens(path, budget=2.0):
    """Sum usage over a subagent transcript, one usage per message id (the file repeats
    a message once per content block). Stops after `budget` seconds."""
    if not path or not os.path.isfile(path):
        return None
    deadline = time.monotonic() + budget
    seen = {}
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            for i, line in enumerate(f):
                if time.monotonic() > deadline:
                    break
                if '"usage"' not in line:
                    continue
                try:
                    rec = json.loads(line)
                except ValueError:
                    continue
                if rec.get("type") != "assistant":
                    continue
                msg = rec.get("message") or {}
                if isinstance(msg.get("usage"), dict):
                    seen[msg.get("id") or i] = msg["usage"]
    except OSError:
        return None
    if not seen:
        return None
    return {k: sum(int(u.get(k) or 0) for u in seen.values()) for k in USAGE_KEYS}


def monitor_running():
    try:
        with open(PID_FILE) as f:
            os.kill(int(f.read().strip()), 0)
        return True
    except (OSError, ValueError):
        return False


def spawn(*args):
    import subprocess

    subprocess.Popen([MONITOR_SH, *args], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                     stderr=subprocess.DEVNULL, start_new_session=True)


def main():
    kind = sys.argv[1] if len(sys.argv) > 1 else ""
    raw = "" if sys.stdin.isatty() else sys.stdin.read()
    if not raw.strip():
        return
    data = json.loads(raw)
    sid = data.get("session_id")
    if kind == "session_start":
        emit("session_start", "running", data, source=data.get("source"))
    elif kind == "agent_start":
        if data.get("hook_event_name") == "PreToolUse":
            ti = data.get("tool_input") or {}
            # stdin agent_id/agent_type here belong to the spawner: record them as the parent
            parent = dict(data)
            parent.pop("agent_id", None)
            parent.pop("agent_type", None)
            emit("agent_start", "running", parent, parent_agent_id=data.get("agent_id"),
                 agent_type=ti.get("subagent_type") or "general-purpose", description=ti.get("description"),
                 task=(ti.get("prompt") or "")[:120] or None, tool_use_id=data.get("tool_use_id"))
            if os.environ.get("CLAUDE_MODS_MONITOR_AUTO") == "1" and not monitor_running():
                spawn("open", sid or "")
        else:
            emit("agent_start", "running", data)
    elif kind in ("tool_end", "tool_fail"):
        tool = data.get("tool_name")
        to = (data.get("tool_input") or {}).get("to") if tool == "SendMessage" else None
        emit("tool_end", "failed" if kind == "tool_fail" else "done", data, tool=tool,
             duration_ms=data.get("duration_ms"), tool_use_id=data.get("tool_use_id"), to=to)
    elif kind == "agent_stop":
        path = data.get("agent_transcript_path")
        emit("agent_stop", "done", data, agent_transcript_path=path, tokens=transcript_tokens(path))
    elif kind == "session_stop":
        emit("session_stop", "done", data)
    elif kind == "session_end":
        emit("session_end", "done", data, reason=data.get("reason"))
        try:
            with open(META_FILE) as f:
                auto_sid = json.load(f).get("session_id")
        except (OSError, ValueError):
            auto_sid = None
        if sid and auto_sid == sid:
            spawn("close")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass
    sys.exit(0)
