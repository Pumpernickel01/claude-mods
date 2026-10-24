#!/usr/bin/env python3
"""test-writer-guard: PreToolUse (Edit|Write|Bash) hook. When the calling agent is
the test-writer subagent, deny any write outside recognised test paths and any
Bash command that is not a known test runner or read-only git/file command.
For every other agent and for the main session it prints nothing and exits 0."""
import fnmatch
import json
import os
import shlex
import sys

MOD = "test-writer-guard"
AGENTS = ("test-writer", "mods:test-writer")  # bare name and plugin-scoped name
TEST_DIRS = ("tests", "test", "__tests__", "spec")
TEST_FILES = ("test_*.py", "*_test.py", "*.test.*", "*.spec.*", "*Tests.swift", "*_test.go")

# Bash allowlist: argv[0] (after allowed VAR= prefixes) -> required first argument (str or tuple), None = any.
RUNNERS = {
    "pytest": None, "jest": None, "vitest": None, "mocha": None, "tox": None, "nox": None,
    "npm": "test", "pnpm": "test", "yarn": "test", "bun": "test", "npx": ("jest", "vitest", "mocha"),
    "go": "test", "cargo": "test", "swift": "test", "make": "test", "dotnet": "test",
    "mvn": "test", "gradle": "test", "./gradlew": "test", "ctest": None, "rspec": None,
    "python": "-m", "python3": "-m",           # python -m pytest / unittest only
    "git": ("status", "diff", "log", "show", "ls-files", "grep", "rev-parse", "branch"),
}
READONLY = {"ls", "cat", "head", "tail", "grep", "rg", "find", "wc", "echo", "pwd", "which",
            "true", "false", "sort", "uniq", "cut", "tr", "diff", "stat", "file", "test", "[", "sleep"}
# flags that turn a read-only or test command into a write or an exec
DENY_FLAGS = {
    "find": {"-exec", "-execdir", "-ok", "-okdir", "-delete", "-fls", "-fprint", "-fprint0", "-fprintf"},
    "sort": {"-o", "--output"}, "uniq": set(), "rg": {"--pre", "--pre-glob"},
    "git": {"-c", "--exec-path", "--git-dir", "--work-tree", "-D", "-d", "-M", "-m", "-f", "--force",
            "--output", "-u", "--set-upstream-to", "--unset-upstream", "--edit-description"},
    "npx": {"-c", "--call", "-p", "--package", "-y", "--yes"},
}
# VAR=value prefixes that cannot change what a command executes (PAGER, GIT_*, DYLD_* etc. can)
ENV_OK = {"CI", "NODE_ENV", "FORCE_COLOR", "NO_COLOR", "TERM", "LANG", "LC_ALL", "TZ", "COLUMNS",
          "RUST_BACKTRACE", "RUST_LOG", "DEBUG", "PYTHONDONTWRITEBYTECODE"}
PREFIX = {"env", "command", "time"}


def deny(reason):
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": reason,
    }}, separators=(",", ":")))


def is_test_path(rel):
    # rel is relative to cwd; a test dir anywhere in the path counts (JS puts __tests__ next to the code)
    *dirs, name = rel.split(os.sep)
    return any(d in TEST_DIRS for d in dirs) or any(fnmatch.fnmatchcase(name, g) for g in TEST_FILES)


def segments(line):
    """Simple commands of one shell line; raises ValueError on redirections, substitutions, bad quotes."""
    if "`" in line or "$(" in line or "<(" in line or ">(" in line:
        raise ValueError("command substitution is not allowed")
    s = shlex.shlex(line, posix=True, punctuation_chars=True)
    s.whitespace_split, s.commenters = True, ""   # '#' is data; the shell is the only comment parser
    tokens = list(s)
    segs, cur, i = [], [], 0
    while i < len(tokens):
        t = tokens[i]
        if t and set(t) <= set(";&|()<>"):
            # fd duplication (2>&1, >&2) is fine; every other redirection writes or reads a file
            if t == ">&" and i + 1 < len(tokens) and tokens[i + 1].isdigit():
                i += 2
                continue
            if ">" in t or "<" in t:
                raise ValueError(f"redirection {t} is not allowed")
            if cur:
                segs.append(cur)
            cur = []
        else:
            cur.append(t)
        i += 1
    return segs + ([cur] if cur else [])


def bash_problem(cmd):
    """Return a reason string if the command is not an allowlisted read-only/test command."""
    try:
        segs = [seg for line in cmd.splitlines() for seg in segments(line)]
    except ValueError as e:
        return str(e) or "unbalanced quotes"
    for seg in segs:
        while seg and (seg[0] in PREFIX or ("=" in seg[0] and not seg[0].startswith("-"))):
            if "=" in seg[0] and seg[0].split("=", 1)[0] not in ENV_OK:
                return f"environment prefix `{seg[0].split('=', 1)[0]}=` is not allowed"
            seg = seg[1:]
        if not seg:
            continue
        name, args = seg[0], seg[1:]
        if any(a.split("=", 1)[0] in DENY_FLAGS.get(name, ()) for a in args):
            return f"`{name}` with a write/exec flag is not allowed"
        if name in READONLY:
            continue
        if name not in RUNNERS:
            return f"`{name}` is not a test runner or read-only command"
        need = RUNNERS[name]
        if need is None:
            continue
        first = args[0] if args else ""
        if name in ("python", "python3"):
            if first != "-m" or (args[1:2] or [""])[0] not in ("pytest", "unittest"):
                return "python may only run `-m pytest` or `-m unittest`"
        elif isinstance(need, tuple):
            if first not in need:
                return f"`{name} {first}` is not read-only"
            if first == "branch" and any(not a.startswith("-") for a in args[1:]):
                return "`git branch <name>` creates a branch"
        elif first != need and not (name in ("npm", "pnpm", "yarn", "bun") and first == "run" and
                                    (args[1:2] or [""])[0].startswith("test")):
            return f"`{name}` may only run its `{need}` script"
    return None


def main():
    if MOD in os.environ.get("CLAUDE_MODS_DISABLE", "").split(","):
        return
    data = json.loads(sys.stdin.read() or "{}")
    if data.get("agent_type") not in AGENTS:
        return
    try:
        tool_input = data.get("tool_input") or {}
        if data.get("tool_name") == "Bash":
            cmd = tool_input.get("command")
            if not isinstance(cmd, str):
                return deny("test-writer Bash command must be a plain string")
            why = bash_problem(cmd)
            if why:
                deny(f"test-writer may only run tests and read-only commands via Bash: {why}; "
                     "use Edit/Write on test files or ask the main agent")
            return
        path = tool_input.get("file_path")
        if not path:
            return
        cwd = os.path.realpath(data.get("cwd") or os.getcwd())
        real = os.path.realpath(os.path.join(cwd, path))
        # SECURITY.md: realpath, and the file must stay inside the session cwd
        if real.startswith(cwd + os.sep) and is_test_path(os.path.relpath(real, cwd)):
            return
        deny(f"test-writer may only write test files; ask the main agent to change {path}")
    except Exception as e:  # fail closed once we know the caller is test-writer
        deny(f"test-writer-guard could not evaluate this call ({type(e).__name__}); denied")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass  # unparseable stdin or unknown caller: never break the main session
    sys.exit(0)
