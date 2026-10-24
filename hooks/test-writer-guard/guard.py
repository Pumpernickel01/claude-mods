#!/usr/bin/env python3
"""test-writer-guard: PreToolUse (Edit|Write) hook. When the calling agent is the
test-writer subagent, deny any write outside recognised test paths. For every
other agent and for the main session it prints nothing and exits 0."""
import fnmatch
import json
import os
import re
import sys

MOD = "test-writer-guard"
AGENTS = ("test-writer", "mods:test-writer")  # bare name and plugin-scoped name
TEST_DIRS = ("tests", "test", "__tests__", "spec")
TEST_FILES = ("test_*.py", "*_test.py", "*.test.*", "*.spec.*", "*Tests.swift", "*_test.go")
# Bash commands that can create/modify files or history. Redirects: `>`/`>>` but not `2>&1`, `>&2`, `&>`.
WRITEISH = re.compile(r"""(?x)
    (?:^|[\s;&|(`])(?:tee|mv|cp|rm|rmdir|truncate|dd|install|patch|chmod|chown|ln|mkdir|touch
        |git\s+(?:commit|push|add|checkout|switch|restore|reset|stash|rebase|merge|rm|mv|clean|am|apply)
        |sed\s+-[a-zA-Z]*i|perl\s+-[a-zA-Z]*i|python3?\s+-c|node\s+-e
        |npm\s+(?:install|i|ci|uninstall|publish|link)|pnpm\s+(?:add|install|i|remove)|yarn\s+(?:add|remove)
        |pip3?\s+(?:install|uninstall)|uv\s+(?:add|remove|pip)|cargo\s+(?:add|install|remove)|brew\s+(?:install|uninstall))\b
  | (?<![\d&])>>?(?!&)
""")


def deny(reason):
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": reason,
    }}, separators=(",", ":")))


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
    if data.get("tool_name") == "Bash":
        # Bash is for running tests only: deny anything that can write files or history
        m = WRITEISH.search((data.get("tool_input") or {}).get("command") or "")
        if m:
            deny(f"test-writer may not write via Bash ({m.group(0).strip()}); use Edit/Write on test files or ask the main agent")
        return
    path = (data.get("tool_input") or {}).get("file_path")
    if not path:
        return
    cwd = os.path.realpath(data.get("cwd") or os.getcwd())
    real = os.path.realpath(os.path.join(cwd, path))
    # SECURITY.md: realpath, and the file must stay inside the session cwd
    if real.startswith(cwd + os.sep) and is_test_path(os.path.relpath(real, cwd)):
        return
    deny(f"test-writer may only write test files; ask the main agent to change {path}")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass  # a broken hook must never break the session
    sys.exit(0)
