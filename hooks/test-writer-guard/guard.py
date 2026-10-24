#!/usr/bin/env python3
"""test-writer-guard: PreToolUse (Edit|Write) hook. When the calling agent is the
test-writer subagent, deny any write outside recognised test paths. For every
other agent and for the main session it prints nothing and exits 0."""
import fnmatch
import json
import os
import sys

MOD = "test-writer-guard"
AGENTS = ("test-writer", "mods:test-writer")  # bare name and plugin-scoped name
TEST_DIRS = ("tests", "test", "__tests__", "spec")
TEST_FILES = ("test_*.py", "*_test.py", "*.test.*", "*.spec.*", "*Tests.swift", "*_test.go")


def is_test_path(rel):
    # rel is relative to cwd; a test dir anywhere in the path counts (JS puts __tests__ next to the code)
    *dirs, name = rel.split(os.sep)
    return any(d in TEST_DIRS for d in dirs) or any(fnmatch.fnmatchcase(name, g) for g in TEST_FILES)


def main():
    if MOD in os.environ.get("CLAUDE_MODS_DISABLE", "").split(","):
        return
    data = json.loads(sys.stdin.read() or "{}")
    if data.get("agent_type") not in AGENTS:
        return
    path = (data.get("tool_input") or {}).get("file_path")
    if not path:
        return
    cwd = os.path.realpath(data.get("cwd") or os.getcwd())
    real = os.path.realpath(os.path.join(cwd, path))
    # SECURITY.md: realpath, and the file must stay inside the session cwd
    if real.startswith(cwd + os.sep) and is_test_path(os.path.relpath(real, cwd)):
        return
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": f"test-writer may only write test files; ask the main agent to change {path}",
    }}, separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass  # a broken hook must never break the session
    sys.exit(0)
