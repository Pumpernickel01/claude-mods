#!/usr/bin/env python3
"""UserPromptSubmit hook: append each prompt to ~/claude-journal/YYYY-MM-DD.md.

Never prints (plain stdout would become additionalContext) and always exits 0.
"""
import json
import os
import subprocess
import sys
import time


def main():
    if "prompt-journal" in os.environ.get("CLAUDE_MODS_DISABLE", "").split(","):
        return
    data = json.loads(sys.stdin.read() or "{}")
    prompt = data.get("prompt")
    if data.get("agent_id") or not isinstance(prompt, str) or not prompt.strip():
        return

    cwd = data.get("cwd") or os.getcwd()
    try:
        top = subprocess.run(["git", "-C", cwd, "rev-parse", "--show-toplevel"],
                             capture_output=True, text=True, timeout=2)
        project = os.path.basename(top.stdout.strip()) if top.returncode == 0 else ""
    except Exception:
        project = ""
    project = project or os.path.basename(os.path.normpath(cwd))

    now = time.localtime()
    body = "\n".join("> " + line if line else ">" for line in prompt.splitlines())
    entry = f"## {time.strftime('%H:%M:%S', now)} · {project}\n\n{body}\n\n"

    journal_dir = os.path.expanduser(
        os.environ.get("CLAUDE_MODS_JOURNAL_DIR") or os.path.join("~", "claude-journal"))
    os.makedirs(journal_dir, mode=0o700, exist_ok=True)
    path = os.path.join(journal_dir, time.strftime("%Y-%m-%d", now) + ".md")
    fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
    with os.fdopen(fd, "a", encoding="utf-8") as f:
        f.write(entry)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass
    sys.exit(0)
