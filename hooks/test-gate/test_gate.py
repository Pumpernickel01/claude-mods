#!/usr/bin/env python3
"""test-gate: Stop hook. If Claude changed tracked files, run the project's
tests; block the stop (once per unchanged tree) when they fail."""
import glob
import hashlib
import json
import os
import re
import shutil
import signal
import subprocess
import sys

PYTEST = ["-q", "-x", "--no-header", "-p", "no:cacheprovider"]


def read(path):
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            return f.read()
    except OSError:
        return ""


def git(cwd, *args):
    try:
        p = subprocess.run(["git", "-C", cwd, *args], capture_output=True, text=True, timeout=5)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return p.stdout if p.returncode == 0 else None


def runs(cmd, cwd):
    try:
        return subprocess.run(cmd, cwd=cwd, capture_output=True, timeout=10).returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def detect(d, root):
    """Return the test command for directory d, or None. First match wins."""
    p = lambda *parts: os.path.join(d, *parts)  # noqa: E731
    if os.path.isfile(p("package.json")):
        try:
            script = json.loads(read(p("package.json"))).get("scripts", {}).get("test", "")
        except (ValueError, AttributeError):
            script = ""
        if script and "no test specified" not in script:
            for lock, cmd in (("pnpm-lock.yaml", ["pnpm", "test"]), ("yarn.lock", ["yarn", "test"]),
                              ("bun.lockb", ["bun", "run", "test"]), ("bun.lock", ["bun", "run", "test"])):
                if os.path.exists(p(lock)) or os.path.exists(os.path.join(root, lock)):
                    return cmd
            return ["npm", "test", "--silent"]
    if ("[tool.pytest" in read(p("pyproject.toml")) or os.path.isfile(p("pytest.ini"))
            or any(s in read(p(f)) for f in ("tox.ini", "setup.cfg") for s in ("[pytest]", "[tool:pytest]"))
            or glob.glob(p("tests", "**", "test_*.py"), recursive=True)
            or glob.glob(p("test", "**", "test_*.py"), recursive=True)):
        if runs(["python3", "-m", "pytest", "--version"], d):
            return ["python3", "-m", "pytest", *PYTEST]
        if 'name = "pytest"' in read(p("uv.lock")) and shutil.which("uv"):
            return ["uv", "run", "pytest", *PYTEST]
    if os.path.isfile(p("Cargo.toml")):
        return ["cargo", "test", "-q"]
    if os.path.isfile(p("go.mod")):
        return ["go", "test", "./..."]
    if re.search(r"^test\s*:", read(p("Makefile")), re.M):
        return ["make", "test"]
    if os.path.isfile(p("Package.swift")):
        return ["swift", "test"]
    return None  # *.xcodeproj / *.xcworkspace alone: deliberately nothing (needs a scheme, slow)


def main():
    if "test-gate" in os.environ.get("CLAUDE_MODS_DISABLE", "").split(","):
        return
    if os.environ.get("CLAUDE_MODS_SKIP_TESTS") == "1":
        return
    raw = sys.stdin.read()
    if not raw.strip():
        return
    data = json.loads(raw)
    if data.get("stop_hook_active"):
        return
    cwd = os.path.realpath(data.get("cwd") or os.getcwd())
    root = git(cwd, "rev-parse", "--show-toplevel")
    if not root or not git(cwd, "status", "--porcelain", "--untracked-files=no"):
        return  # not a repo, or nothing changed
    root = root.strip()
    d, cmd = cwd, None
    while True:
        cmd = detect(d, root)
        if cmd or d == root or d == os.path.dirname(d):
            break
        d = os.path.dirname(d)
    if not cmd or not shutil.which(cmd[0]):
        return
    try:
        timeout = int(os.environ.get("CLAUDE_MODS_TEST_TIMEOUT", "120"))
    except ValueError:
        timeout = 120
    shown = " ".join(cmd)
    env = {**os.environ, "CI": "1", "FORCE_COLOR": "0"}
    proc = subprocess.Popen(cmd, cwd=d, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, env=env, start_new_session=True)
    try:
        out, _ = proc.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        os.killpg(proc.pid, signal.SIGKILL)  # kill the real runner too, not just npm/make
        proc.wait()
        print(json.dumps({"systemMessage": f"test-gate: `{shown}` exceeded {timeout}s and was skipped; "
                                           "set CLAUDE_MODS_TEST_TIMEOUT to raise."}))
        return
    marker = os.path.join(os.path.expanduser("~"), ".cache", "claude-mods", "test-gate",
                          re.sub(r"[^\w.-]", "_", str(data.get("session_id", "none"))))
    if proc.returncode == 0:
        try:
            os.remove(marker)
        except OSError:
            pass
        return
    tree = hashlib.sha1((git(root, "diff", "HEAD", "--stat") or "").encode()).hexdigest()
    if read(marker).strip() == tree:
        print(json.dumps({"systemMessage": f"test-gate: `{shown}` still fails (exit {proc.returncode}) and the "
                                           "tree is unchanged since the last block; not blocking again."}))
        return
    os.makedirs(os.path.dirname(marker), mode=0o700, exist_ok=True)
    with open(marker, "w") as f:
        f.write(tree)
    head = f"test-gate: `{shown}` failed (exit {proc.returncode}). Fix the failing tests, then stop again. Last 40 lines:\n"
    tail = "\n".join(out.decode("utf-8", "replace").splitlines()[-40:])
    print(json.dumps({"decision": "block", "reason": head + tail[-(8000 - len(head)):]}))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass  # a broken hook must never break the session
