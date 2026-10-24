#!/usr/bin/env python3
"""Desktop notification when Claude stops or needs you. Stop + Notification hooks.

Carries project name and status only (SECURITY.md): never prompt text or paths.
Always exits 0; never blocks.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import time

if "notify" in os.environ.get("CLAUDE_MODS_DISABLE", "").split(","):
    sys.exit(0)

ROOT = os.environ.get("CLAUDE_PLUGIN_ROOT") or os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

SKIP = ("auth_success", "elicitation_", "quota_", "plugin_notification")
LABELS = {
    "permission_prompt": "Needs permission",
    "idle_prompt": "Waiting for you",
    "agent_needs_input": "Agent needs input",
    "agent_completed": "Agent finished",
}
BUNDLE = {  # terminal-notifier -activate target so a click focuses the right app
    "apple_terminal": "com.apple.Terminal",
    "ghostty": "com.mitchellh.ghostty",
    "iterm2": "com.googlecode.iterm2",
    "vscode": "com.microsoft.VSCode",
}
MARKERS = os.path.expanduser("~/.cache/claude-mods/notify")
RATE_S = 2
# strings travel as argv (never interpolated into the script text)
OSA = ["osascript", "-e", "on run argv",
       "-e", "display notification (item 1 of argv) with title (item 2 of argv) subtitle (item 3 of argv)",
       "-e", "end run", "--"]


def clean(s):
    # control chars would terminate the OSC sequence or garble the popup
    return re.sub(r"[\x00-\x1f\x7f-\x9f]", " ", str(s))[:80]


def project(cwd):
    try:
        top = subprocess.run(["git", "-C", cwd, "rev-parse", "--show-toplevel"],
                             capture_output=True, text=True, timeout=1).stdout.strip()
    except Exception:
        top = ""
    return os.path.basename(top or cwd.rstrip("/")) or "~"


def rate_limited(session_id):
    os.makedirs(MARKERS, mode=0o700, exist_ok=True)
    mark = os.path.join(MARKERS, re.sub(r"[^A-Za-z0-9_-]", "_", session_id)[:64] or "none")
    try:
        if time.time() - os.stat(mark).st_mtime < RATE_S:
            return True
    except OSError:
        pass
    with open(mark, "w"):
        pass
    return False


def main():
    sys.path.insert(0, os.path.join(ROOT, "lib"))
    from termcap import detect  # inside main so an import failure still exits 0
    data = json.loads(sys.stdin.read() or "{}")
    if data.get("hook_event_name") == "Notification":
        ntype = str(data.get("notification_type", ""))
        if ntype.startswith(SKIP):
            return
        body = LABELS.get(ntype) or clean(data.get("title") or data.get("message") or "Notification")
    else:
        body = "Finished"
    session_id = str(data.get("session_id", ""))
    if rate_limited(session_id):
        return
    title, sub = "Claude Code", clean(project(str(data.get("cwd") or os.getcwd())))
    tc = detect()
    tn = shutil.which("terminal-notifier")
    cmd = None
    if tn:
        cmd = [tn, "-title", title, "-subtitle", sub, "-message", body, "-group", "claude-code-" + session_id]
        if tc.terminal in BUNDLE:
            cmd += ["-activate", BUNDLE[tc.terminal]]
    elif tc.notify == "osascript":
        cmd = OSA + [body, title, sub]
    elif shutil.which("notify-send"):
        cmd = ["notify-send", f"{title}: {sub}", body]
    if cmd:
        subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5)
    if tc.terminal == "ghostty" or tc.notify == "osc9":
        # OSC 777 has no subtitle field, so the project rides in the title; ';' is its separator
        t, b = f"{title}: {sub}".replace(";", ","), body.replace(";", ",")
        print(json.dumps({"terminalSequence": f"\x1b]777;notify;{t};{b}\x1b\\"}))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass
    sys.exit(0)
