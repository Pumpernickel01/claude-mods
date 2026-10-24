#!/usr/bin/env python3
"""command-guard: PreToolUse hook on Bash. Denies a short, fixed list of
destructive or secret-reading commands; everything else passes silently."""
import json
import os
import re
import shlex
import subprocess
import sys

if "command-guard" in os.environ.get("CLAUDE_MODS_DISABLE", "").split(","):
    sys.exit(0)

HOME = os.path.expanduser("~")
PREFIX = {"sudo", "env", "command", "exec", "nohup", "time", "nice"}
SHELLS = {"bash", "sh", "zsh", "dash"}
READERS = {"cat", "less", "more", "head", "tail", "grep", "rg", "awk", "sed", "cut",
           "sort", "strings", "xxd", "hexdump", "base64", "od", "vi", "vim", "nano",
           "open", "cp", "mv", "scp", "rsync", "curl", "source", ".", "python",
           "python3", "node", "ruby", "perl", "tee", "wc"}
FATAL_RM = {"/", HOME, HOME + "/Library", "/System", "/Library", "/usr", "/etc",
            "/var", "/bin", "/sbin"}
SECRET = re.compile(r"""(?x)
    (?:^|/)\.env(?:\.(?!example$|sample$|template$|dist$)[^/]+)?$
  | (?:^|/)\.ssh/id_[^/]*(?<!\.pub)$
  | \.(?:pem|key|p12|pfx|keystore|jks|keychain-db)$
  | (?:^|/)\.aws/credentials$
  | (?:^|/)\.docker/config\.json$
  | (?:^|/)\.kube/config$
  | (?:^|/)\.(?:netrc|git-credentials|pypirc)$
  | (?:^|/)credentials\.json$
  | (?:^|/)service-account[^/]*\.json$
  | /Library/Keychains(?:/|$)
""")
DISKUTIL = re.compile(r"(?i)^(?:erase\w*|secureerase|zerodisk|randomdisk|partitiondisk|reformat)$")
KEYCHAIN = {"find-generic-password", "find-internet-password", "dump-keychain", "export",
            "add-generic-password", "add-internet-password", "delete-generic-password",
            "delete-internet-password", "delete-keychain", "unlock-keychain",
            "set-keychain-password", "import"}
OP = re.compile(r"[;&|()<>]+")
BRANCH = re.compile(r"^\+?(?:[^:]*:)?(?:refs/heads/)?(?:main|master)$")


def lex(cmd, quoted):
    s = shlex.shlex(cmd, posix=True, punctuation_chars=True)
    s.whitespace_split = True
    if not quoted:  # fallback for unbalanced quotes (heredoc bodies with apostrophes)
        s.quotes = s.escape = ""
    return [t.strip("'\"") for t in s]


def segments(cmd):
    """Split into simple commands; returns (list of token lists, redirect targets)."""
    cmd = cmd.replace("\n", ";").replace("`", ";")
    try:
        tokens = lex(cmd, True)
    except ValueError:
        tokens = lex(cmd, False)
    segs, cur, redirects, i = [], [], [], 0
    while i < len(tokens):
        t = tokens[i]
        if OP.fullmatch(t):
            if ("<" in t or ">" in t) and "(" not in t and ")" not in t:
                if i + 1 < len(tokens):
                    redirects.append(tokens[i + 1])
                    i += 1
            elif cur:
                segs.append(cur)
                cur = []
        else:
            cur.append(t)
        i += 1
    if cur:
        segs.append(cur)
    return segs, redirects


def strip_prefix(seg):
    while seg and (seg[0] in PREFIX or re.fullmatch(r"\w+=.*", seg[0])):
        seg = seg[1:]
        while seg and seg[0].startswith("-"):
            seg = seg[1:]
    return seg


def is_secret(tok):
    p = os.path.expandvars(os.path.expanduser(tok.rsplit("@", 1)[-1]))
    return bool(SECRET.search(p)) or p == HOME + "/.npmrc"


def fatal_rm_target(tok, cwd):
    p = os.path.normpath(os.path.join(cwd, os.path.expandvars(os.path.expanduser(tok))))
    if p.startswith("/Users/*"):
        return True
    if p.endswith("/*"):
        p = p[:-2] or "/"
    return p in FATAL_RM


def current_branch(cwd):
    try:
        r = subprocess.run(["git", "-C", cwd, "symbolic-ref", "--short", "-q", "HEAD"],
                           capture_output=True, text=True, timeout=2)
        return r.stdout.strip() if r.returncode == 0 else ""
    except (OSError, subprocess.SubprocessError):
        return ""


def check(cmd, cwd):
    """Return (rule, reason) for the first hit, or None."""
    segs, redirects = segments(cmd)
    for t in redirects:
        if is_secret(t):
            return "secret-file", f"redirect touches {t}, a secrets file; use .env.example or a redacted copy, or ask the user to run the command themselves."
    for seg in segs:
        seg = strip_prefix(seg)
        if not seg:
            continue
        name, args = os.path.basename(seg[0]), seg[1:]
        if name in SHELLS and "-c" in args:
            hit = check(args[args.index("-c") + 1], cwd)
            if hit:
                return hit
        if name == "eval":
            hit = check(" ".join(args), cwd)
            if hit:
                return hit
        if name == "rm":
            flags = [a for a in args if a.startswith("-")]
            rec = any(a == "--recursive" or re.fullmatch(r"-[a-zA-Z]*[rR][a-zA-Z]*", a) for a in flags)
            force = any(a == "--force" or re.fullmatch(r"-[a-zA-Z]*f[a-zA-Z]*", a) for a in flags)
            if rec and force:
                for a in args:
                    if not a.startswith("-") and fatal_rm_target(a, cwd):
                        return "rm-system-path", f"rm -rf targets {a}, a system or home directory; delete a specific project path instead, or ask the user to do it."
        if name == "git" and "push" in args:
            pargs = args[args.index("push") + 1:]
            force = any(a == "-f" or a == "--force" or re.fullmatch(r"-[a-z]*f[a-z]*", a) for a in pargs)
            refs = [a for a in pargs if not a.startswith("-")]
            force = force or any(a.startswith("+") for a in refs)
            named = any(BRANCH.match(a) for a in refs)
            # "git push -f" / "git push -f origin": branch comes from HEAD of cwd
            implicit = len(refs) < 2 and current_branch(cwd) in ("main", "master")
            if force and (named or implicit):
                return "force-push-protected", "force-push to main/master would rewrite shared history; push to a feature branch, or use --force-with-lease after confirming with the user."
        if name == "diskutil" and any(DISKUTIL.match(a) for a in args):
            return "disk-wipe", "diskutil would erase or repartition a disk; ask the user to run disk operations themselves."
        if name == "dd" and any(re.match(r"^of=/dev/(?:r?disk|sd|nvme)", a) for a in args):
            return "disk-wipe", "dd writing to a raw device would destroy the disk; write to a file (of=image.img) or ask the user."
        if name == "chmod":
            rec = any(a == "--recursive" or re.fullmatch(r"-[a-zA-Z]*R[a-zA-Z]*", a) for a in args)
            if rec and any(re.fullmatch(r"0*777|(?:a|ugo)[+=]rwx", a) for a in args):
                return "chmod-777-recursive", "recursive 777 makes every file world-writable; use chmod -R 755 for directories or chmod +x on the specific files."
        if name == "csrutil" and "disable" in args:
            return "security-bypass", "csrutil disable turns off System Integrity Protection; this is the user's call, ask them to do it from Recovery themselves."
        if name == "spctl" and ({"--master-disable", "--global-disable"} & set(args)):
            return "security-bypass", "spctl --master-disable turns off Gatekeeper; ask the user to allow the specific app instead."
        if name == "nvram" and re.search(r"amfi_get_out_of_my_way|csr-active-config", " ".join(args)):
            return "security-bypass", "nvram boot-args/csr-active-config would weaken SIP or AMFI; ask the user to change firmware settings themselves."
        if name in READERS:
            for a in args:
                if is_secret(a):
                    return "secret-file", f"{name} touches {a}, a secrets file; use .env.example or a redacted copy, or ask the user to run the command themselves."
        if name == "security" and (KEYCHAIN & set(args)):
            sub = next(a for a in args if a in KEYCHAIN)
            return "keychain-access", f"security {sub} reads or modifies the macOS keychain; ask the user for the value or to run it themselves."
    return None


def main():
    raw = sys.stdin.read()
    if not raw.strip():
        return 0
    try:
        data = json.loads(raw)
    except ValueError as e:
        print(f"command-guard: stdin is not JSON ({e}); blocking", file=sys.stderr)
        return 2
    cmd = (data.get("tool_input") or {}).get("command") if isinstance(data, dict) else None
    if not isinstance(cmd, str):
        return 0
    hit = check(cmd, data.get("cwd") or ".")
    if hit:
        print(json.dumps({"hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": f"{hit[0]}: {hit[1]}"}}))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # fail closed: a crashed guard must not silently allow
        print(f"command-guard: internal error ({e!r}); blocking. Disable with CLAUDE_MODS_DISABLE=command-guard", file=sys.stderr)
        sys.exit(2)
