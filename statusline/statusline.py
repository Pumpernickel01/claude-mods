#!/usr/bin/env python3
"""Claude Code status line: model, git branch + dirty mark, context bar, cost, effort on one line.

Reads the statusLine stdin JSON (FORMATS.md 3). Colours come from lib/termcap.py: 24-bit SGR
only when tc.truecolor, else 256-colour indices. Git state is cached 3 s per directory so big
repos never exceed the 100 ms budget. Any failure prints just the model name and exits 0.
"""
import hashlib
import json
import os
import subprocess
import sys
import time

MOD = "statusline"
ROOT = os.environ.get("CLAUDE_PLUGIN_ROOT") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "lib"))
CACHE_DIR = os.path.expanduser("~/.cache/claude-mods/statusline")
GIT_TIMEOUT = 0.05
# role -> (256-colour index, xterm-palette RGB of that same index)
PALETTE = {"green": (114, (135, 215, 135)), "yellow": (178, (215, 175, 0)),
           "red": (167, (215, 95, 95)), "dim": (245, (138, 138, 138))}
MODEL = "Claude"  # set as soon as stdin is parsed; the exception fallback prints it


def git(args, cwd):
    # GIT_OPTIONAL_LOCKS=0: never write index.lock from a status line
    return subprocess.run(["git", "-C", cwd] + args, capture_output=True, text=True,
                          timeout=GIT_TIMEOUT, env={**os.environ, "GIT_OPTIONAL_LOCKS": "0"})


def git_state(cwd):
    """[branch, dirty] or None (not a repo / git too slow), cached 3 s per directory."""
    path = os.path.join(CACHE_DIR, hashlib.sha1(cwd.encode()).hexdigest()[:16] + ".json")
    try:
        with open(path) as f:
            c = json.load(f)
        if time.time() - c["t"] < 3:
            return c["git"]
    except Exception:
        pass
    state = None
    try:
        r = git(["symbolic-ref", "--short", "-q", "HEAD"], cwd)
        if r.returncode in (0, 1):  # 1 = detached HEAD; 128 = not a repo
            branch = r.stdout.strip() or git(["rev-parse", "--short", "HEAD"], cwd).stdout.strip() or "detached"
            dirty = (git(["diff", "--quiet"], cwd).returncode != 0
                     or git(["diff", "--cached", "--quiet"], cwd).returncode != 0)
            state = [branch, dirty]
    except subprocess.TimeoutExpired:
        pass
    try:
        os.makedirs(CACHE_DIR, mode=0o700, exist_ok=True)
        tmp = f"{path}.{os.getpid()}"
        with open(tmp, "w") as f:
            json.dump({"t": time.time(), "git": state}, f)
        os.replace(tmp, path)
    except Exception:
        pass
    return state


def main():
    global MODEL
    if MOD in os.environ.get("CLAUDE_MODS_DISABLE", "").split(","):
        return
    raw = sys.stdin.read()
    if not raw.strip():
        return
    data = json.loads(raw)
    MODEL = (data.get("model") or {}).get("display_name") or MODEL
    from termcap import detect
    tc = detect()
    uni, nf = tc.unicode, tc.nerdfont

    def paint(role, s):
        idx, (r, g, b) = PALETTE[role]
        return (f"\x1b[38;2;{r};{g};{b}m" if tc.truecolor else f"\x1b[38;5;{idx}m") + s + "\x1b[0m"

    ws = data.get("workspace") or {}
    st = git_state(ws.get("current_dir") or data.get("cwd") or os.getcwd())
    pct = (data.get("context_window") or {}).get("used_percentage")
    cost = (data.get("cost") or {}).get("total_cost_usd")
    effort = (data.get("effort") or {}).get("level")

    def build(paint, bar, with_cost, with_effort):
        segs = [(" " if nf else "") + MODEL]
        if st:
            mark = ("●" if st[1] else "○") if uni else ("*" if st[1] else "-")
            g = (" " if nf else "git:") + st[0] + mark
            segs.append(paint("dim", g + (f" wt:{ws['git_worktree']}" if ws.get("git_worktree") else "")))
        if pct is None:
            segs.append(paint("dim", "ctx " + ("–" if uni else "-")))
        else:
            role = "red" if pct > 80 else "yellow" if pct > 60 else "green"
            n = max(0, min(10, int(pct / 10 + 0.5)))  # half-up; round() would give 85% -> 8 cells
            full, empty = ("█", "░") if uni else ("#", ".")
            ctx = f"ctx {pct:.0f}%" + (f" [{full * n}{empty * (10 - n)}]" if bar else "")
            segs.append(paint(role, ctx))
        if with_cost and cost is not None:
            segs.append(f"${cost:.2f}")
        if with_effort and effort:
            segs.append(paint("dim", f"effort:{effort}"))
        return "  ".join(segs)

    try:
        cols = int(os.environ.get("COLUMNS", 0))
    except ValueError:
        cols = 0
    for flags in ((1, 1, 1), (0, 1, 1), (0, 0, 1), (0, 0, 0)):  # drop bar, then cost, then effort
        if not cols or len(build(lambda r, s: s, *flags)) <= cols:
            break
    print(build(paint, *flags))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print(MODEL)  # never a traceback: a broken status line must not break the session
    sys.exit(0)
