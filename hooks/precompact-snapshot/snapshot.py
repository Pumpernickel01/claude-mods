#!/usr/bin/env python3
"""PreCompact hook: copy the transcript to ~/.claude/snapshots/ before compaction, prune old copies.

Prints nothing (PreCompact discards systemMessage), never blocks, always exits 0.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import time

MOD = "precompact-snapshot"
SAFE = re.compile(r"[^A-Za-z0-9._-]")
SNAPSHOT = re.compile(r"^.+-\d{8}-\d{6}-.+\.jsonl$")


def project_name(cwd):
    try:
        top = subprocess.run(["git", "-C", cwd, "rev-parse", "--show-toplevel"],
                             capture_output=True, text=True, timeout=5).stdout.strip()
    except Exception:
        top = ""
    return SAFE.sub("_", os.path.basename(top or cwd.rstrip("/"))) or "project"


def main():
    if MOD in os.environ.get("CLAUDE_MODS_DISABLE", "").split(","):
        return
    data = json.loads(sys.stdin.read() or "{}")
    src = os.path.realpath(data.get("transcript_path") or "")
    if not src.endswith(".jsonl") or not os.path.isfile(src):
        return
    out_dir = os.environ.get("CLAUDE_MODS_SNAPSHOT_DIR") or os.path.expanduser("~/.claude/snapshots")
    os.makedirs(out_dir, mode=0o700, exist_ok=True)
    os.chmod(out_dir, 0o700)  # makedirs mode is masked by umask and skipped for existing dirs
    stamp = time.strftime("%Y%m%d-%H%M%S")
    trigger = SAFE.sub("_", str(data.get("trigger") or "unknown"))
    dest = os.path.join(out_dir, f"{project_name(data.get('cwd') or os.getcwd())}-{stamp}-{trigger}.jsonl")
    # shortcut: same project+trigger within one second overwrites the earlier copy, add a counter if parallel sessions collide
    shutil.copyfile(src, dest)
    os.chmod(dest, 0o600)

    cutoff = time.time() - float(os.environ.get("CLAUDE_MODS_SNAPSHOT_KEEP_DAYS") or 30) * 86400
    for entry in os.scandir(out_dir):
        if SNAPSHOT.match(entry.name) and entry.is_file(follow_symlinks=False) \
                and entry.stat(follow_symlinks=False).st_mtime < cutoff:
            os.remove(entry.path)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass  # a broken hook must never break compaction
    sys.exit(0)
