#!/usr/bin/env python3
"""Agent-monitor event hooks: `python3 emit.py <kind>` reads the hook stdin JSON and
appends one record to ~/.claude/agent-monitor/events.jsonl through lib/events.py.

kinds (see REPORT.md for the hooks.json wiring):
  session_start  SessionStart            agent_start  PreToolUse Agent + SubagentStart
  tool_end       PostToolUse *           tool_fail    PostToolUseFailure *
  agent_stop     SubagentStop (sums the subagent transcript's token usage)
  session_stop   Stop                    session_end  SessionEnd
  prompt         UserPromptSubmit (first 120 chars)
  notification   Notification (its notification_type, no message text)
tool_end carries `target` (a file path, host or MCP server name) and `target_kind`
(file | host | mcp) derived from the tool input; the input itself is never logged.
Never blocks, never prints: any failure exits 0 quietly.
"""
import json
import os
import re
import shlex
import sys
import time
from urllib.parse import urlsplit

if "monitor" in os.environ.get("CLAUDE_MODS_DISABLE", "").split(","):
    sys.exit(0)

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.environ.get("CLAUDE_PLUGIN_ROOT") or os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, "lib"))
from events import emit  # noqa: E402

FILE_TOOLS = {"Read": "file_path", "Edit": "file_path", "Write": "file_path", "NotebookEdit": "notebook_path",
              "Glob": "path", "Grep": "path"}
# hosts a shell command reaches: the URL_AUTH / SCP_HOST / NET rules of activity-pane/hooks/flows.ts
# the whole authority (up to / ? # or a quote), one unit: url_host() takes the host out of it, so a regex can
# never backtrack into a password and call it the host
URL_AUTH = re.compile(r"\b(?:https?|wss?|ftp|mqtts?|coap|rtsp|tcp|udp)://([^\s/?#'\"]+)(['\"][^\s/?#]*)?", re.I)  # 2: cut by a quote


def url_host(authority, cut=False):
    """The host of a URL authority: after the last @, before the port. None when the authority holds a shell or
    template placeholder ($, backtick, braces, backslash) anywhere, when it was cut short (`cut`: a quote with text
    behind it, or an @ later in the same word, as in TOKEN:1234/pw@host), or when, with no @, what follows the host
    is not a port. An empty port (host:/x) is a port: words are read whole, quotes resolved, so nothing is
    cut at a quoted separator or space any more."""
    if cut or re.search(r"[${}`\\]", authority):
        return None
    user, _, hostport = authority.rpartition("@")
    bracket = hostport.startswith("[") and "]" in hostport
    if bracket:
        host, rest = hostport[1:hostport.index("]")], hostport[hostport.index("]") + 1:]
    else:
        host, sep, port = hostport.partition(":")
        rest = sep + port
    if not host:
        return None
    if not user and (rest and not re.fullmatch(r":\d*", rest) or not (bracket or host == "localhost" or hostlike(host))):
        return None  # with no userinfo the host must look like one: a bare token before a port is no host
    return host
SCP_HOST = re.compile(r"\b[\w.-]+@([\w.-]+):")
NET = {"ssh", "sftp", "mosh", "telnet", "nc", "ncat", "netcat", "socat", "ping", "ping6", "traceroute", "mtr",
       "nmap", "dig", "nslookup", "host", "ftp", "curl", "wget", "http", "https", "xh", "scp", "rsync"}
PREFIX = {"sudo", "time", "exec", "command", "nohup", "env"}


def hostlike(t):
    labels = t.split(".")
    if len(labels) < 2 or any(not 0 < len(l) <= 63 for l in labels):
        return False
    if all(re.fullmatch(r"[0-9]{1,3}", l) for l in labels):
        return len(labels) == 4 and all(int(l) <= 255 for l in labels)
    return all(re.match(r"^[\w-]+$", l) for l in labels) and labels[-1].isalpha()


UNRESOLVED = "(unresolved host)"  # a URL or net command whose host could not be named safely: listed, not guessed


def segments_of(command):
    """The command's words, quotes resolved, in segments split at ; | || && & and newlines, as a shell reads
    them, so a quoted separator or space stays inside its word. None when the quotes do not balance."""
    lex = shlex.shlex(command or "", posix=True, punctuation_chars=";|&\n")
    lex.whitespace, lex.whitespace_split = " \t\r", True
    lex.commenters = ""  # shlex would start a comment at a # inside a word and swallow TOKEN:123#x@host's @
    segments = [[]]
    try:
        for word in lex:
            if word and all(c in ";|&\n" for c in word):
                segments.append([])
            else:
                segments[-1].append(word)
    except ValueError:
        return None
    return segments


def url_hosts(word):
    """(host or None) for each URL in one shell word. A later @ in the word fails closed (None) unless the
    authority is plainly a host with no userinfo and either no port (every URL parser ends it at the /) or the @
    in the query or fragment: api.example.com/x?to=a@b is named, while user:p@ss/w@host, AbC/xyz@host and
    TOKEN:1234/pw@host, a password with a / in it, are not."""
    out = []
    for m in URL_AUTH.finditer(word):
        auth, tail = m.group(1), word[m.end():]
        plain = "@" not in auth and hostlike(url_host(auth) or "") and (":" not in auth or tail[:1] in ("?", "#"))
        out.append(url_host(auth, cut=len(m.group(2) or "") > 1 or ("@" in tail and not plain)))
    return out


def bash_hosts(command):
    """Hosts a shell command reaches, in order, once each; UNRESOLVED where a URL's host could not be named
    safely. Never returns the command itself."""
    found = []

    def add(h):
        if h and h not in found:
            found.append(h)
    segments = segments_of(command)
    if segments is None:
        # unbalanced quotes: nothing is read as a host, but a command that looks like a network call is listed
        lines = re.split(r"[\n;|&]+", command or "")
        is_net = any(([w for w in line.split() if w not in PREFIX and not re.match(r"^\w+=", w)] or [""])[0].split("/")[-1]
                     in NET | {"git"} for line in lines)
        return [UNRESOLVED] if is_net or URL_AUTH.search(command) or SCP_HOST.search(command) else []
    for words in segments:
        tokens = list(words)
        while tokens and (tokens[0] in PREFIX or re.match(r"^\w+=", tokens[0])):
            tokens.pop(0)
        program = (tokens[0] if tokens else "").split("/")[-1]
        before = len(found)
        unresolved = False
        for word in words:
            for host in url_hosts(word):
                if host:
                    add(host)
                else:
                    unresolved = True
        if program in NET or program == "git":
            for m in SCP_HOST.finditer(" ".join(words)):
                add(m.group(1))
        if program in NET and len(found) == before:
            prev = ""
            for t in tokens[1:]:
                flag, prev = prev.startswith("-"), t
                if "://" in t:
                    continue  # a URL the rule above found no host in: never read as a bare host either
                t = re.sub(r"^[^@\s]+@", "", t)
                # shortcut: a bare argument counts only when shaped like a host (labels of up to 63 chars, an
                # alphabetic top-level label, or an IPv4) and does not follow an option such as -H or -u, so a
                # token or header value is never taken for a host. Widen when a dotless host matters.
                if not t.startswith("-") and not flag and hostlike(t):
                    add(t)
                    break
        if unresolved and program in NET and len(found) == before:
            add(UNRESOLVED)  # a network call was made: listed, its host withheld
    return found


def target_of(tool, ti):
    """(target, kind) a tool call reaches: a file path, a host or an MCP server; (None, None) otherwise."""
    if not isinstance(ti, dict):
        return None, None
    if tool in FILE_TOOLS:
        v = ti.get(FILE_TOOLS[tool])
        return (v, "file") if isinstance(v, str) and v else (None, None)
    if tool == "WebFetch" and isinstance(ti.get("url"), str):
        try:
            host = urlsplit(ti["url"]).hostname  # the parser, not a regex: user@host tricks
        except ValueError:
            host = None
        return (host, "host") if host else (None, None)
    if tool == "Bash":
        hosts = bash_hosts(ti.get("command") if isinstance(ti.get("command"), str) else "")
        return (hosts[0], "host") if hosts else (None, None)  # shortcut: first host only; list them when the HUD draws several
    if isinstance(tool, str) and tool.startswith("mcp__"):
        server = tool.split("__")[1] if tool.count("__") >= 2 else None
        server = re.sub(r"^plugin_", "", server or "")
        return (re.sub(r"^(.+)_\1$", r"\1", server), "mcp") if server else (None, None)  # plugin_x_x -> x
    return None, None


USAGE_KEYS = ("input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")


def transcript_tokens(path, budget=2.0):
    """Sum usage over a subagent transcript, one usage per message id (the file repeats
    a message once per content block). Stops after `budget` seconds."""
    if not path or not os.path.isfile(path):
        return None
    deadline = time.monotonic() + budget
    seen = {}
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            for i, line in enumerate(f):
                if time.monotonic() > deadline:
                    break
                if '"usage"' not in line:
                    continue
                try:
                    rec = json.loads(line)
                except ValueError:
                    continue
                if rec.get("type") != "assistant":
                    continue
                msg = rec.get("message") or {}
                if isinstance(msg.get("usage"), dict):
                    seen[msg.get("id") or i] = msg["usage"]
    except OSError:
        return None
    if not seen:
        return None
    return {k: sum(int(u.get(k) or 0) for u in seen.values()) for k in USAGE_KEYS}


def main():
    kind = sys.argv[1] if len(sys.argv) > 1 else ""
    raw = "" if sys.stdin.isatty() else sys.stdin.read()
    if not raw.strip():
        return
    data = json.loads(raw)
    if kind == "session_start":
        emit("session_start", "running", data, source=data.get("source"))
    elif kind == "agent_start":
        if data.get("hook_event_name") == "PreToolUse":
            ti = data.get("tool_input") or {}
            # stdin agent_id/agent_type here belong to the spawner: record them as the parent
            parent = dict(data)
            parent.pop("agent_id", None)
            parent.pop("agent_type", None)
            emit("agent_start", "running", parent, parent_agent_id=data.get("agent_id"),
                 agent_type=ti.get("subagent_type") or "general-purpose", description=ti.get("description"),
                 task=(ti.get("prompt") or "")[:120] or None, tool_use_id=data.get("tool_use_id"),
                 name=ti.get("name"))  # what SendMessage addresses the agent by, when it has one
        else:
            emit("agent_start", "running", data)
    elif kind in ("tool_end", "tool_fail"):
        tool = data.get("tool_name")
        to = (data.get("tool_input") or {}).get("to") if tool == "SendMessage" else None
        try:
            target, target_kind = target_of(tool, data.get("tool_input"))
        except Exception:
            target = target_kind = None  # the record is worth more than its target
        emit("tool_end", "failed" if kind == "tool_fail" else "done", data, tool=tool,
             duration_ms=data.get("duration_ms"), tool_use_id=data.get("tool_use_id"), to=to,
             target=target, target_kind=target_kind)
    elif kind == "agent_stop":
        path = data.get("agent_transcript_path")
        emit("agent_stop", "done", data, agent_transcript_path=path, tokens=transcript_tokens(path))
    elif kind == "session_stop":
        emit("session_stop", "done", data)
    elif kind == "session_end":
        emit("session_end", "done", data, reason=data.get("reason"))
    elif kind == "prompt":
        emit("prompt", "done", data, text=(data.get("prompt") or "")[:120] or None)
    elif kind == "notification":
        emit("notification", "done", data, kind=data.get("notification_type"))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass
    sys.exit(0)
