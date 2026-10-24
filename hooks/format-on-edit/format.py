#!/usr/bin/env python3
"""format-on-edit: PostToolUse (Edit|Write) hook that runs the matching formatter
on the file Claude just changed. Silent on success and on formatter failure;
suggests a missing formatter once per session per tool."""
import json
import os
import shutil
import subprocess
import sys
import tempfile

if "format-on-edit" in os.environ.get("CLAUDE_MODS_DISABLE", "").split(","):
    sys.exit(0)

PRETTIER = (["prettier", "--write"], "npm i -g prettier")
CLANG = (["clang-format", "-i"], "brew install clang-format")
SHFMT = (["shfmt", "-w"], "brew install shfmt")
# ext -> [(argv, install hint)]; the first candidate on PATH runs, the first
# overall is the one suggested when none is installed
FORMATTERS = {
    ".py": [(["ruff", "format"], "brew install ruff"), (["black", "-q"], "brew install black")],
    ".rs": [(["rustfmt"], "rustup component add rustfmt")],
    ".go": [(["gofmt", "-w"], "brew install go")],
    ".sh": [SHFMT],
    ".bash": [SHFMT],
}
for _e in (".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".json", ".css", ".scss", ".html", ".md", ".yaml", ".yml"):
    FORMATTERS[_e] = [PRETTIER]
for _e in (".c", ".cc", ".cpp", ".h", ".hpp", ".m", ".mm"):
    FORMATTERS[_e] = [CLANG]

SKIP_DIRS = ("/node_modules/", "/.git/", "/vendor/", "/dist/", "/build/")
MARKER_DIR = os.path.join(tempfile.gettempdir(), "claude-mods-format-on-edit")


def main():
    data = json.loads(sys.stdin.read() or "{}")
    path = (data.get("tool_input") or {}).get("file_path")
    if not path:
        return
    cwd = os.path.realpath(data.get("cwd") or os.getcwd())
    path = os.path.realpath(os.path.join(cwd, path))
    # SECURITY.md: only act on files inside the session's cwd
    if not path.startswith(cwd + os.sep) or not os.path.isfile(path):
        return
    if any(s in "/" + os.path.relpath(path, cwd) for s in SKIP_DIRS):  # relative, so ~/build/proj is fine
        return
    ext = os.path.splitext(path)[1].lower()
    candidates = FORMATTERS.get(ext)
    if not candidates:
        return
    for argv, _hint in candidates:
        if shutil.which(argv[0]):
            try:
                subprocess.run(argv + [path], cwd=cwd, timeout=15,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            except (subprocess.TimeoutExpired, OSError):
                pass
            return
    argv, hint = candidates[0]
    marker = os.path.join(MARKER_DIR, f"{data.get('session_id', 'none')}.{argv[0]}")
    if os.path.exists(marker):
        return
    os.makedirs(MARKER_DIR, mode=0o700, exist_ok=True)
    open(marker, "a").close()
    msg = f"format-on-edit: no formatter for {ext} files; install with `{hint}` to enable auto-formatting."
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": msg}},
                     separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass  # a broken hook must never break the session
    sys.exit(0)
