#!/usr/bin/env python3
"""The column's Shell pane, with two views of Claude's agents and two memos.

    python3 shell_tabs.py <feed file>

The shell runs in a pty and passes straight through. Tab cycles Shell -> Agents
-> Agent graph -> Roster -> Keepsake -> Shell, Shift+Tab goes back one, Esc or q
returns to the shell.
In the shell, Tab switches only at the prompt: a program the shell runs keeps its
Tab. Arrows, PgUp/PgDn and the mouse wheel scroll a view taller than the pane; c
clears finished agents. A view draws on the alternate screen, so the shell's own
screen comes back as it was; what the shell printed meanwhile is held and written
on return. herdr's pane title follows the view.

Agents shows every agent the moment it is spawned, sub-agents under the agent that
spawned them, and who started, messaged or answered whom; finished agents stay,
greyed out, until c clears them. An agent goes by the first 6 characters of its
id (its transcript is agent-<id>.jsonl), its type or given name beside it, and a
bar of its progress: done items of the task list it keeps (TodoWrite), read from
that transcript, full once it has finished. Agent graph puts the main session in
the middle and scatters its agents around it as circles (● id over the progress
bar), every sub-agent around the agent that spawned it (as Obsidian's
graph view does), and streams dots along every edge whose agents are talking now;
with more agents than fit the pane, finished sibling leaves fold into one node
each (◌ ✗ 5 failed).

Agents come from ~/.claude/agent-monitor/events.jsonl (CLAUDE_MODS_EVENT_LOG),
which the claude-mods plugin's monitor hooks write; the session shown is the one
the feed names, or the latest in the log while it names none.

Roster lists the subagents one may call as @agent-<name>, each with what it does,
from the frontmatter of the files in ~/.claude/agents and the project's
.claude/agents; Keepsake shows ~/.claude/keepsake.md, one's own memo on how to
ask. Both are read at each redraw, so an edit shows at once. Stdlib only.
"""
import fcntl
import json
import math
import os
import pty
import re
import select
import signal
import struct
import subprocess
import sys
import termios
import textwrap
import time
import zlib
import tty
from datetime import datetime, timezone

LOG_PATH = os.environ.get("CLAUDE_MODS_EVENT_LOG") or os.path.expanduser("~/.claude/agent-monitor/events.jsonl")
MAIN = "main"
VIEWS = ["shell", "agents", "graph", "roster", "keepsake"]
LABELS = {"shell": "Shell", "agents": "Agents", "graph": "Agent graph", "roster": "Roster", "keepsake": "Keepsake"}
AGENT_DIRS = [os.path.expanduser("~/.claude/agents"), os.path.join(os.getcwd(), ".claude", "agents")]
KEEPSAKE_PATH = os.path.expanduser("~/.claude/keepsake.md")
FRONT = re.compile(r"^---\r?\n(.*?)\r?\n---", re.S)  # a subagent file's frontmatter
INLINE = re.compile(r"(`[^`]*`|\*\*[^*]+\*\*)")  # `code` and **bold** in a memo
SHIFT_TAB = b"\x1b[Z"
HELD_MAX = 8 * 1024 * 1024
KEYS = re.compile(rb"\x1b\[[<?0-9;]*[A-Za-z~]|\x1bO.|\x1b|.", re.S)
# the shell's alternate screen and mouse modes, so a view hands both back as it found them
MODES = re.compile(rb"\x1b\[\?(1049|1047|47|1000|1002|1003|1006)([hl])")
ALT_MODES, MOUSE_MODES = (b"1049", b"1047", b"47"), (b"1000", b"1002", b"1003", b"1006")
ARROWS = {b"\x1b[A": -1, b"\x1bOA": -1, b"\x1b[B": 1, b"\x1bOB": 1}
PAGES = {b"\x1b[5~": -1, b"\x1b[6~": 1}
WHEEL = re.compile(rb"\x1b\[<6([45]);\d+;\d+M")  # SGR mouse report: button 64 is wheel up, 65 down
# C0, DEL and C1: text from the log must never reach the terminal as an escape sequence
CONTROL = re.compile("[\x00-\x1f\x7f-\x9f]")

# Catppuccin Mocha, as the column's other viewers use.
MOCHA = {"text": "#cdd6f4", "blue": "#89b4fa", "mauve": "#cba6f7", "green": "#a6e3a1", "yellow": "#f9e2af", "red": "#f38ba8",
         "teal": "#94e2d5", "peach": "#fab387", "subtext0": "#a6adc8", "overlay1": "#7f849c", "overlay0": "#6c7086",
         "surface2": "#585b70", "surface0": "#313244"}
# Live agents draw bright; finished ones grey, so they read as no longer in use.
LIVE = ("starting", "running")
STATUS = {"starting": "peach", "running": "yellow", "idle": "subtext0", "failed": "red"}
SPINNER = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"
FLOW_AFTER_MESSAGE = 8.0  # seconds a message edge keeps flowing after its last message
FLOW_AFTER_RETURN = 3.0  # seconds a finished agent's edge flows back to its parent
HEX_ID = re.compile(r"[0-9a-f]{8,}")  # an agent id, as against a spawn's tool_use_id


def rgb(color):
    h = MOCHA[color]
    return ";".join(str(int(h[i:i + 2], 16)) for i in (1, 3, 5))


def line_of(segs, cols):
    """One screen row from (text, color, bold) pieces, cut to `cols` cells."""
    out, left = [], cols
    for text, color, bold in segs:
        text = CONTROL.sub(" ", text)[:max(0, left)]
        left -= len(text)
        if text and bold:
            text = f"\x1b[1m{text}\x1b[22m"
        out.append(f"\x1b[38;2;{rgb(color)}m{text}\x1b[39m" if text and color else text)
    return "".join(out)


def parse_ts(s):
    try:
        return datetime.strptime(s, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc).timestamp()
    except (TypeError, ValueError):
        return time.time()


def fmt_elapsed(sec):
    s = int(max(0, sec))
    return f"{s // 3600}:{s % 3600 // 60:02d}:{s % 60:02d}" if s >= 3600 else f"{s // 60}:{s % 60:02d}"


def tokens_in_out(tok):
    """in = prompt side (input + cache read + cache creation), out = output_tokens."""
    if not tok:
        return None
    tin = sum(int(tok.get(k) or 0) for k in ("input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"))
    return tin, int(tok.get("output_tokens") or 0)


def k(n):
    return f"{n / 1000:.1f}k"


class Node:
    def __init__(self, nid, kind, start):
        self.id, self.kind, self.start = nid, kind, start
        self.seed = start  # the graph places a node by this; start moves on when the agent reports in, seed never
        self.task, self.status, self.end, self.alias = "", "running", None, None
        self.tools, self.last_tool, self.tokens, self.parent = 0, "", None, None
        self.progress, self.progress_at, self.progress_mtime = None, 0.0, None  # %, when and which file state it was read

    @property
    def tag(self):
        """How the agent is shown: the start of its id, the end of a spawn's tool_use_id until it has one."""
        if self.id == MAIN:
            return MAIN
        return self.id[:6] if HEX_ID.fullmatch(self.id) else self.id[-6:]

    @property
    def is_live(self):
        return self.status in LIVE

    def elapsed(self, now):
        return (now if self.end is None else self.end) - self.start


class Session:
    def __init__(self, sid, ts):
        self.id, self.start, self.last, self.ended = sid, ts, ts, False
        self.transcript = None  # the session's transcript_path; its agents' transcripts sit beside it
        self.pending = []  # spawns (by tool_use_id) waiting for their SubagentStart, oldest first
        self.nodes = {MAIN: Node(MAIN, "session", ts)}
        self.comms = []  # (ts, kind, sender Node, receiver Node or the name it was sent to)
        self.names = {}  # Agent(name=...) -> agent id, so a SendMessage to a name finds its agent

    def node(self, nid, ts):
        if nid not in self.nodes:
            self.nodes[nid] = Node(nid, "agent", ts)
        return self.nodes[nid]

    def rekey(self, old, new):
        """A spawn shown under its tool_use_id takes its agent id, keeping its place."""
        self.nodes = {(new if nid == old else nid): n for nid, n in self.nodes.items()}
        self.nodes[new].id = new
        for n in self.nodes.values():
            if n.parent == old:
                n.parent = new

    def resolve(self, to):
        """The agent a SendMessage `to` names: its id, the name it was spawned with, or its id's tail."""
        if to in self.nodes:
            return self.nodes[to]
        if to in self.names:
            return self.nodes.get(self.names[to])
        if to == "main":
            return self.nodes[MAIN]
        return next((n for nid, n in self.nodes.items() if nid != MAIN and len(to) >= 4 and nid.endswith(to)), None)

    def retire(self, ts):
        """Agents still live when the session starts again or ends can no longer run: grey them."""
        for nid, n in self.nodes.items():
            if nid != MAIN and n.is_live:
                n.status, n.end = "gone", ts
        self.pending.clear()

    def clear(self):
        """Drops finished agents and the exchanges they were in; a live agent they spawned moves under main."""
        gone = {nid for nid, n in self.nodes.items() if nid != MAIN and not n.is_live}
        self.nodes = {nid: n for nid, n in self.nodes.items() if nid not in gone}
        for n in self.nodes.values():
            if n.parent in gone:
                n.parent = MAIN
        self.comms = [c for c in self.comms if c[2].id not in gone and getattr(c[3], "id", None) not in gone]


class Model:
    def __init__(self):
        self.sessions = {}

    def latest(self):
        return max(self.sessions.values(), key=lambda s: s.last, default=None)

    def ingest(self, rec):
        ev, ts = rec.get("event"), parse_ts(rec.get("ts"))
        sid = rec.get("session_id") or "unknown"
        S = self.sessions.get(sid) or self.sessions.setdefault(sid, Session(sid, ts))
        S.last = max(S.last, ts)
        S.transcript = rec.get("transcript_path") or S.transcript
        aid, main = rec.get("agent_id"), S.nodes[MAIN]
        if ev == "session_start":
            S.retire(ts)
            main.status, main.end, S.ended = "running", None, False
            main.task = os.path.basename(rec.get("cwd") or "")
        elif ev == "agent_start" and aid is None:
            # PreToolUse Agent: shown at once, as starting, under its tool_use_id until it has an agent id
            tid = rec.get("tool_use_id") or f"spawn·{ts}"
            n = S.node(tid, ts)
            n.kind = rec.get("agent_type") or "agent"
            n.task = rec.get("description") or rec.get("task") or ""
            n.parent, n.alias, n.status = rec.get("parent_agent_id") or MAIN, rec.get("name"), "starting"
            S.pending.append(tid)
            S.comms.append((ts, "spawn", S.node(n.parent, ts), n))
        elif ev == "agent_start":
            # SubagentStart: joined to the oldest waiting spawn of its type. An agent of another type
            # (one the engine runs itself) takes no spawn's place and is shown on its own.
            kind = rec.get("agent_type")
            tid = next((t for t in S.pending if not kind or S.nodes[t].kind == kind), None)
            if tid:
                S.pending.remove(tid)
                S.rekey(tid, aid)
            n = S.node(aid, ts)
            if not tid:
                n.kind, n.parent = kind or n.kind, n.parent or MAIN
            n.start, n.status, n.end = ts, "running", None
            if n.alias:
                S.names[n.alias] = aid
        elif ev == "tool_end":
            # only agents seen starting: a stop or a tool call of one never started is a fork the engine
            # runs itself (compaction, memory), not an agent anyone spawned
            n = S.nodes.get(aid) if aid else main
            if n is None:
                return
            n.tools += 1
            n.last_tool = rec.get("tool") or ""
            if aid is None and not S.ended:
                main.status = "running"
            if n.last_tool == "Agent" and rec.get("status") == "failed" and rec.get("tool_use_id") in S.pending:
                failed = S.nodes[rec["tool_use_id"]]  # the spawn itself failed
                S.pending.remove(rec["tool_use_id"])
                failed.status, failed.end = "failed", ts
            if n.last_tool == "SendMessage" and rec.get("to"):
                S.comms.append((ts, "message", n, S.resolve(rec["to"]) or str(rec["to"])))
        elif ev == "agent_stop" and aid in S.nodes:
            n = S.nodes[aid]
            n.status = "failed" if rec.get("status") == "failed" else "done"
            n.end, n.tokens = ts, rec.get("tokens") or n.tokens
            S.comms.append((ts, "return", n, S.node(n.parent or MAIN, ts)))
        elif ev == "session_stop":
            main.status = "idle"  # between turns: waiting for you, not gone
        elif ev == "session_end":
            S.retire(ts)
            main.status, main.end, S.ended = "done", ts, True


def progress_pct(S, n, now):
    """How far the agent has got: done items of the last task list it wrote (TodoWrite) in its transcript
    (<session transcript dir>/subagents/agent-<id>.jsonl), 100 once it is done; None until it keeps one.
    Read at most once a second while the agent runs and once more after it ends, and only when the file changed.
    shortcut: only TodoWrite (the whole list each call); add TaskCreate/TaskUpdate when an agent uses them."""
    if n.id == MAIN or n.kind == "fold" or not S.transcript or not HEX_ID.fullmatch(n.id):
        return None
    if n.status == "done":
        return 100.0
    if now - n.progress_at < 1 or (n.end is not None and n.progress_at > n.end):
        return n.progress
    n.progress_at = now
    path = os.path.join(S.transcript[:-len(".jsonl")], "subagents", f"agent-{n.id}.jsonl")
    try:
        st = os.stat(path)
        if st.st_mtime == n.progress_mtime:
            return n.progress
        with open(path, "rb") as f:
            f.seek(max(0, st.st_size - 65536))
            tail = f.read()
    except OSError:
        return n.progress
    n.progress_mtime = st.st_mtime
    for line in reversed(tail.splitlines()):
        if b'"name":"TodoWrite"' not in line:
            continue
        try:
            todos = next(c["input"]["todos"] for c in json.loads(line)["message"]["content"]
                         if c.get("type") == "tool_use" and c.get("name") == "TodoWrite")
        except (ValueError, KeyError, TypeError, StopIteration):
            continue  # a cut-off first line, or a list without the shape we know
        if todos:
            n.progress = sum(t.get("status") == "completed" for t in todos) * 100 / len(todos)
            break
    return n.progress


def bar(pct, cells):
    """A progress bar: `cells` wide, filled half-up, empty while pct is None."""
    n = 0 if pct is None else max(0, min(cells, int(pct * cells / 100 + 0.5)))
    return "█" * n + "░" * (cells - n)


def bar_tone(pct, live):
    return "overlay0" if not live or pct is None else "green"


def links(S, now):
    """Every edge as (sender, receiver, kind, flowing, backwards). Spawn edges run parent to child
    and flow while the child runs, then back for a moment once it returns; message edges run
    sender to receiver and flow for a while after each message."""
    out = []
    for nid, n in S.nodes.items():
        if nid != MAIN and n.parent in S.nodes:
            back = n.status == "done" and n.end is not None and now - n.end < FLOW_AFTER_RETURN
            out.append((n.parent, nid, "spawn", n.is_live or back, back))
    last = {}
    for ts, kind, src, dst in S.comms:
        if kind == "message" and isinstance(dst, Node) and src.id in S.nodes and dst.id in S.nodes:
            last[(src.id, dst.id)] = max(ts, last.get((src.id, dst.id), ts))
    out += [(src, dst, "msg", now - ts < FLOW_AFTER_MESSAGE, False) for (src, dst), ts in last.items()]
    return out


class Tail:
    """Reads new complete lines; reopens when the file is rotated (inode change) or shrinks."""

    def __init__(self, path):
        self.path, self.f, self.ino, self.buf = path, None, None, b""

    def read(self):
        try:
            st = os.stat(self.path)
        except OSError:
            return []
        if self.f is None or st.st_ino != self.ino or st.st_size < self.f.tell():
            if self.f:
                self.f.close()
            self.f, self.ino, self.buf = open(self.path, "rb"), st.st_ino, b""
        data = self.f.read()
        if not data:
            return []
        self.buf += data
        lines = self.buf.split(b"\n")
        self.buf = lines.pop()
        return lines


class Agents:
    """This session's agents, from the event log: the session the feed names, else the latest."""

    def __init__(self, feed_path, log_path=LOG_PATH):
        self.feed_path, self.log_path = feed_path, log_path
        self.sid, self.feed_stamp = None, None
        self.model, self.tail = Model(), Tail(log_path)

    def session(self):
        return self.model.sessions.get(self.sid) if self.sid else self.model.latest()

    def poll(self):
        """Reads what is new; true when anything changed. A new session id starts over."""
        try:
            st = os.stat(self.feed_path)
            if (st.st_mtime, st.st_size) != self.feed_stamp:
                with open(self.feed_path) as f:
                    sid = json.load(f).get("session")
                self.feed_stamp = (st.st_mtime, st.st_size)
                if sid and sid != self.sid:
                    if self.tail.f:
                        self.tail.f.close()
                    self.sid, self.model, self.tail = sid, Model(), Tail(self.log_path)
        except (OSError, ValueError, AttributeError):
            pass  # no feed yet, or caught mid-write: keep what we had
        needle = f'"session_id":"{self.sid}"'.encode() if self.sid else b""
        changed = False
        for line in self.tail.read():
            if needle not in line:
                continue  # another session's record: skipped before parsing
            try:
                rec = json.loads(line)
            except ValueError:
                continue
            # the byte check above is only a fast path; the parsed field decides
            if isinstance(rec, dict) and (not self.sid or rec.get("session_id") == self.sid):
                self.model.ingest(rec)
                changed = True
        return changed


def tab_strip(view, cols):
    """Shell  Agents  Agent graph, the shown one bold on surface0, and the keys at the right."""
    parts, used = [], 0
    for v in VIEWS:
        label = f" {LABELS[v]} "
        piece = line_of([(label, "text" if v == view else "overlay1", v == view)], cols - used)
        parts.append(f"\x1b[48;2;{rgb('surface0')}m{piece}\x1b[49m" if v == view and piece else piece)
        used += len(label)
    hint = "Tab next · Shift+Tab back · c clear finished · Esc shell"
    if cols - used > len(hint) + 2:
        parts.append(line_of([(" " * (cols - used - len(hint) - 1) + hint, "overlay0", False)], cols - used))
    return "".join(parts)


def cell(text, n):
    return text.ljust(n) if len(text) < n else text[: n - 2] + "… "


def tree(S):
    """The main session, then every agent under the one that spawned it, in spawn order: (node, depth)."""
    kids = {}
    for nid, n in S.nodes.items():
        if nid != MAIN:
            kids.setdefault(n.parent if n.parent in S.nodes else MAIN, []).append(n)
    out, seen, stack = [], set(), [(S.nodes[MAIN], 0)]
    while stack:
        n, depth = stack.pop()
        if n.id in seen:
            continue
        seen.add(n.id)
        out.append((n, depth))
        stack.extend((child, depth + 1) for child in reversed(kids.get(n.id, [])))
    return out


def comm_lines(S, count, cols, now):
    """The last `count` exchanges between agents: who started, messaged or answered whom."""
    word = {"spawn": "started", "message": "message", "return": "returned"}
    out = []
    for ts, kind, src, dst in S.comms[-count:] if count > 0 else []:
        to = dst.tag if isinstance(dst, Node) else dst
        text = (f"{time.strftime('%H:%M:%S', time.localtime(ts))}  {src.tag} {'┄▶' if kind == 'message' else '─▶'} "
                f"{to}  {word[kind]}")
        out.append(line_of([(text, "peach" if now - ts < FLOW_AFTER_MESSAGE else "overlay0", False)], cols))
    return out


def draw_agents(S, rows, cols, now, scroll=None):
    """The agent table; taller than the pane, it starts at row scroll["agents"] (clamped there)."""
    if S is None:
        return [line_of([("No agent events yet for this session.", "overlay1", False)], cols)]
    scroll = {} if scroll is None else scroll
    task_w = max(12, cols - 99)
    head = (cell("Agent", 10) + cell("Type", 11) + cell("Status", 11) + cell("Progress", 18) + cell("Elapsed", 9)
            + cell("Tools", 6) + cell("Task", task_w) + cell("Last tool", 12) + cell("Tokens in/out", 14) + "Start")
    log = comm_lines(S, min(len(S.comms), max(3, rows // 3)) if rows >= 12 else 0, cols, now)
    room = max(1, rows - 2 - (len(log) + 1 if log else 0))
    shown, where = tree(S), ""
    if len(shown) > room:
        room = max(1, room - 1)  # one row says where the table is scrolled to
        top = scroll["agents"] = max(0, min(scroll.get("agents", 0), len(shown) - room))
        where = f"rows {top + 1}–{min(top + room, len(shown))} of {len(shown)} · ↑↓ PgUp PgDn wheel · c clear finished"
        shown = shown[top: top + room]
    spin = SPINNER[int(now * 10) % len(SPINNER)]
    lines = [line_of([(head, "subtext0", True)], cols)]
    for n, depth in shown:
        tok = tokens_in_out(n.tokens)
        indent = "" if depth <= 1 else "  " * (depth - 2) + "└ "
        status = f"{spin} {n.status}" if n.is_live else ("✗ failed" if n.status == "failed" else n.status)
        grey = n.id != MAIN and not n.is_live  # finished: the whole row greyed out
        tone = "overlay0" if grey else None
        rest = (cell(fmt_elapsed(n.elapsed(now)), 9) + cell(str(n.tools), 6) + cell(n.task, task_w)
                + cell(n.last_tool, 12) + cell(f"{k(tok[0])}/{k(tok[1])}" if tok else "-", 14)
                + time.strftime("%H:%M:%S", time.localtime(n.start)))
        name_tone = "blue" if n.id == MAIN and n.status != "done" else tone
        status_tone = "red" if n.status == "failed" else tone if grey else STATUS.get(n.status, "overlay0")
        pct = progress_pct(S, n, now)
        progress = "" if n.id == MAIN else f"[{bar(pct, 10)}] " + ("  –" if pct is None else f"{pct:3.0f}%")
        lines.append(line_of([(cell(indent + n.tag, 10), name_tone, n.id == MAIN or n.is_live),
                              (cell("session" if n.id == MAIN else n.alias or n.kind, 11), tone, False),
                              (cell(status, 11), status_tone, n.is_live),
                              (cell(progress, 18), bar_tone(pct, n.is_live), False), (rest, tone, False)], cols))
    agents = [n for nid, n in S.nodes.items() if nid != MAIN]
    count = {s: sum(n.status == s for n in agents) for s in ("done", "failed", "gone")}
    toks = [t for t in (tokens_in_out(n.tokens) for n in agents) if t]
    up = fmt_elapsed((S.last if S.ended else now) - S.start)
    total = (f"agents {sum(n.is_live for n in agents)} running / {count['done']} done / {count['failed']} failed"
             + (f" / {count['gone']} gone" if count["gone"] else "")
             + f" · tool calls {sum(n.tools for n in S.nodes.values())} · "
             f"agent tokens {k(sum(t[0] for t in toks))} in / {k(sum(t[1] for t in toks))} out · uptime {up}")
    lines += [""] * max(0, room + 1 - len(lines))
    if where:
        lines.append(line_of([(where, "overlay0", False)], cols))
    if log:
        lines += [line_of([("Communication", "subtext0", True)], cols)] + log
    return lines[: rows - 1] + [line_of([(total, "overlay1", False)], cols)]


NODE_W = 8  # a node's cells: "● " and 6 of the id over an 8-cell progress bar; a node is 2 rows
U, D, L, R = 1, 2, 4, 8
JOIN = {L | R: "─", U | D: "│", D | R: "╭", D | L: "╮", U | R: "╰", U | L: "╯", U | D | R: "├", U | D | L: "┤",
        L | R | D: "┬", L | R | U: "┴", U | D | L | R: "┼", L: "─", R: "─", U: "│", D: "│"}
EDGE_CHARS = " " + "".join(JOIN.values())
_layouts = {}  # (nodes, w, view_h) -> positions: the simulation runs once per change, not per frame


def fold(placed, edges):
    """Finished sibling leaves as one node per parent and status (◌ ✗ 5 failed), for a graph with more
    agents than fit the pane; agents still live or talking stay themselves. Returns the rows and the folds' edges."""
    busy = {e[i] for e in edges if e[3] for i in (0, 1)}
    parents = {n.parent for n, _ in placed}
    groups = {}
    for n, _ in placed:
        if n.id not in parents and not n.is_live and n.id not in busy:
            groups.setdefault((n.parent, n.status), []).append(n)
    rows, extra = [], []
    for n, depth in placed:
        group = groups.get((n.parent, n.status), [])
        if len(group) < 2 or n not in group:
            rows.append((n, depth))
        elif n is group[0]:
            f = Node(f"{n.parent}·{n.status}", "fold", n.start)
            f.alias, f.status, f.parent = f"{len(group)} {n.status}", n.status, n.parent
            rows.append((f, depth))
            extra.append((n.parent, f.id, "spawn", False, False))
    return rows, extra


def layout(items, w, view_h):
    """Where every node goes: a force-directed graph as Obsidian draws one. items are
    (id, kind, seed, parent, depth, node width) in spawn order, the main session first; it is pinned to the
    middle of the view, every other node starts on a ring around its parent at an angle its seed gives it,
    then nodes repel one another and spawn edges pull them together (Fruchterman-Reingold). Each node (two
    rows tall) then takes the free row nearest the one the simulation gave it, rows in the view first (a cell
    of air at the sides, a row between nodes that share columns, so an edge can pass). Returns {id: (x0, y, x1)}
    of the top row and the canvas height; the same input always gives the same picture, so the graph holds
    still between frames."""
    key = (tuple(items), w, view_h)
    if key in _layouts:
        return _layouts[key]
    if len(_layouts) > 64:
        _layouts.clear()
    # Fruchterman-Reingold in a space where a node is about a round blob: a column is 0.4 of a unit (a node
    # and its gap, 10 cells, are 4 units) and its 2 rows plus a row of air one unit, so the spacing k that
    # shares the area out among the nodes is the same in both directions.
    n, SX, SY = len(items), 2.5, 3.0
    W, H = w / SX, view_h / SY
    k = math.sqrt(W * H / n)
    idx = {it[0]: i for i, it in enumerate(items)}
    px, py = [W / 2] * n, [H / 2] * n
    edges = []
    for i, (nid, kind, seed, parent, depth, length) in enumerate(items):
        if i == 0:
            continue
        p = idx.get(parent, 0)
        edges.append((p, i))
        a = zlib.crc32(f"{kind}{seed}".encode()) % 360 / 180 * math.pi
        px[i], py[i] = px[p] + math.cos(a) * k, py[p] + math.sin(a) * k
    rounds = 120
    for step in range(rounds):
        fx, fy = [0.0] * n, [0.0] * n
        for i in range(n):
            for j in range(i + 1, n):
                dx, dy = px[i] - px[j], py[i] - py[j]
                d2 = dx * dx + dy * dy or 1e-4
                f = k * k / d2  # repulsion k²/d along the unit vector
                fx[i], fy[i], fx[j], fy[j] = fx[i] + dx * f, fy[i] + dy * f, fx[j] - dx * f, fy[j] - dy * f
        for p, c in edges:
            dx, dy = px[c] - px[p], py[c] - py[p]
            f = math.sqrt(dx * dx + dy * dy) / k  # attraction d²/k along the unit vector
            fx[c], fy[c], fx[p], fy[p] = fx[c] - dx * f, fy[c] - dy * f, fx[p] + dx * f, fy[p] + dy * f
        heat = max(0.05, W / 10 * (1 - step / rounds))  # the farthest a node moves this round
        for i in range(1, n):
            f = math.sqrt(fx[i] ** 2 + fy[i] ** 2) or 1e-4
            px[i] = min(max(px[i] + fx[i] / f * min(f, heat), 0), W)
            py[i] = min(max(py[i] + fy[i] / f * min(f, heat), 0), H)
    px, py = [x * SX for x in px], [y * SY for y in py]
    box = [[max(0, min(w - it[5], round(px[i] - it[5] / 2))), min(view_h - 2, round(py[i])), it[5]] for i, it in enumerate(items)]
    box[0][1] = view_h // 2  # main stays in the middle row

    def touch(a, b):  # share columns (less than a cell of air) and rows closer than three (2 rows + air)
        return a[0] <= b[0] + b[2] and b[0] <= a[0] + a[2] and abs(a[1] - b[1]) < 3

    for j in range(1, n):  # in spawn order, each label takes the free row nearest the one the simulation gave it
        want = box[j][1]
        for y in sorted(range(view_h + 3 * n), key=lambda y: (y >= view_h, abs(y - want), y)):  # in the view first
            box[j][1] = y
            if not any(touch(box[i], box[j]) for i in range(j)):
                break
    assert not any(touch(box[i], box[j]) for i in range(n) for j in range(i + 1, n)), "nodes overlap"
    pos = {it[0]: (b[0], b[1], b[0] + b[2] - 1) for it, b in zip(items, box)}
    _layouts[key] = pos, max(view_h, max(b[1] for b in box) + 2)
    return _layouts[key]


def rng(a, b):
    """a to b, both included, in whichever direction b lies."""
    return range(a, b + (1 if b >= a else -1), 1 if b >= a else -1)


def route(sx, sy, bx, dx, dy):
    """The cells of an elbow: along row sy to the bus column bx, along it to row dy, then on to dx."""
    return [(x, sy) for x in rng(sx, bx)] + [(bx, y) for y in rng(sy, dy)][1:] + [(x, dy) for x in rng(bx, dx)][1:]


def route_v(sx, sy, my, dx, dy):
    """The cells of an elbow turned on its side: down column sx to row my, along it to dx, on to row dy."""
    return [(sx, y) for y in rng(sy, my)] + [(x, my) for x in rng(sx, dx)][1:] + [(dx, y) for y in rng(my, dy)][1:]


def draw_graph(model, S, rows, cols, now, scroll=None):
    """The main session in the middle, agents around it and sub-agents around the agent that spawned them,
    as circles (● id over the agent's progress bar), placed by a force-directed layout (see layout()) so no
    two nodes touch. Edges are box-drawing elbows
    (never stair-stepping diagonals): solid = spawn, dashed = message. Dots stream along every edge whose
    agents are talking now; finished agents and idle edges are grey. More agents than fit the pane: finished
    sibling leaves fold, and what still does not fit scrolls, from row scroll["graph"] (clamped there)."""
    if S is None:
        return [line_of([("No agent events yet for this session.", "overlay1", False)], cols)]
    scroll = {} if scroll is None else scroll
    w, view_h = cols, max(1, rows - 1)  # the last row is the legend
    edges = links(S, now)
    placed = [(n, depth) for n, depth in tree(S) if n.id != MAIN]  # spawn order: parents land before their kids
    per_row = max(1, w // (NODE_W + 2))
    if len(placed) + 1 > per_row * (view_h // 3) // 2:  # half the cells a node per third row allows is the densest it still reads
        placed, extra = fold(placed, edges)
        edges += extra

    def rows_of(n):
        """The node's text rows: the circle and id, then the progress bar (none for main and folds)."""
        if n.id == MAIN:
            return ["● main"]
        if n.kind == "fold":
            return ["◌ " + ("✗ " if n.status == "failed" else "") + n.alias]
        return [("✗ " if n.status == "failed" else "● ") + n.tag, bar(progress_pct(S, n, now), NODE_W)]

    main = S.nodes[MAIN]
    nodes = {MAIN: main, **{n.id: n for n, _ in placed}}
    items = [(MAIN, main.kind, main.seed, None, 0, len(rows_of(main)[0]))]
    items += [(n.id, n.kind, n.seed, n.parent if n.parent in nodes else MAIN, d, max(map(len, rows_of(n))))
              for n, d in placed]
    pos, h = layout(items, w, view_h)

    taken = {(x, y + dy) for x0, y, x1 in pos.values() for x in range(x0, x1 + 1) for dy in (0, 1)}  # node cells, for edges to steer round

    def clearest(candidates, cells):
        """The candidate (bus column or row) whose run crosses the fewest label cells, the middle one on a tie."""
        mid = (candidates[0] + candidates[-1]) / 2
        return min(candidates, key=lambda c: (sum(cell in taken for cell in cells(c)), abs(c - mid)))

    def path(src, dst):
        """From inside the sender's top row to inside the receiver's (nodes paint over the ends): a lying elbow
        through the gap when the nodes are side by side, a standing one through the rows between them otherwise."""
        if src not in pos or dst not in pos:
            return []
        (sx0, sy, sx1), (dx0, dy, dx1) = pos[src], pos[dst]
        if sx1 < dx0 - 1 or dx1 < sx0 - 1:
            ax, bx = (sx1, dx0) if sx1 < dx0 else (sx0, dx1)  # out of the facing sides
            bus = clearest(list(range(min(ax, bx) + 1, max(ax, bx))), lambda c: [(c, y) for y in rng(sy, dy)])
            return route(ax, sy, bus, bx, dy)
        cx, cy = (sx0 + sx1) // 2, (dx0 + dx1) // 2
        rows = list(range(min(sy, dy) + 1, max(sy, dy))) or [(sy + dy) // 2]
        return route_v(cx, sy, clearest(rows, lambda r: [(x, r) for x in rng(cx, cy)]), cy, dy)

    grid = [[" "] * w for _ in range(h)]
    sty = [[None] * w for _ in range(h)]
    bits = {}

    def put(x, y, ch, style=None):
        if 0 <= x < w and 0 <= y < h:
            grid[y][x], sty[y][x] = ch, style

    def draw(pts, kind, style):
        for i, (x, y) in enumerate(pts):
            m = L | R if len(pts) == 1 else 0
            for j in (i - 1, i + 1):
                if 0 <= j < len(pts):
                    ox, oy = pts[j]
                    m |= U if oy < y else D if oy > y else L if ox < x else R
            if kind == "msg" and i % 2 and m in (L | R, U | D):
                continue  # dashed, corners kept
            m = bits[(x, y)] = bits.get((x, y), 0) | m
            put(x, y, JOIN[m], style)

    live_tone = {"spawn": "blue", "msg": "peach"}
    for src, dst, kind, flowing, _ in sorted(edges, key=lambda e: e[3]):  # idle first, live drawn over them
        draw(path(src, dst), kind, (live_tone[kind] if flowing else "surface2", False))
    for nid, (x, y, _) in pos.items():
        n = nodes[nid]
        if nid == MAIN:
            style = ("blue", main.status == "running") if main.status != "done" else ("overlay0", False)
        else:
            style = (STATUS[n.status], True) if n.is_live else ("overlay0", False)
        text = rows_of(n)
        for i, ch in enumerate(text[0]):
            put(x + i, y, ch, style)
        if len(text) > 1:
            for i, ch in enumerate(text[1]):
                put(x + i, y + 1, ch, (bar_tone(n.progress, n.is_live), False))
    phase = int(now * 10)  # one cell per tenth of a second, the graph's redraw rate
    for src, dst, kind, flowing, back in edges:
        if not flowing:
            continue
        pts = path(src, dst)
        for i, (x, y) in enumerate(pts[::-1] if back else pts):
            if (i - phase) % 4 == 0 and 0 <= x < w and 0 <= y < h and grid[y][x] in EDGE_CHARS:  # never over a node
                put(x, y, "•", ("text", True) if kind == "spawn" else ("peach", True))
    off = scroll["graph"] = max(0, min(scroll.get("graph", 0), h - view_h))
    legend = " ─ spawn  ┄ message  • talking  grey: finished  █ progress"
    if h > view_h:
        legend += f"  · rows {off + 1}–{off + view_h} of {h} ↑↓"

    lines = []
    for y in range(off, off + view_h):
        segs, x = [], 0
        while x < w:
            j = x
            while j < w and sty[y][j] == sty[y][x]:
                j += 1
            color, bold = sty[y][x] or (None, False)
            segs.append(("".join(grid[y][x:j]), color, bold))
            x = j
        lines.append(line_of(segs, w))
    return lines + [line_of([(legend, "overlay0", False)], w)]


def inline(text, color):
    """A memo row as (text, color, bold) pieces: `code` in peach, **bold** bold, the rest in `color`."""
    segs = []
    for part in INLINE.split(text):
        if len(part) > 1 and part[0] == "`" == part[-1]:
            segs.append((part[1:-1], "peach", False))
        elif len(part) > 4 and part.startswith("**") and part.endswith("**"):
            segs.append((part[2:-2], color, True))
        elif part:
            segs.append((part, color, False))
    return segs


def md_rows(text, cols):
    """Markdown as screen rows of at most `cols` cells: headings, rules, bullets and numbered steps (their
    text hung under the lead), quotes, `code` and **bold**.
    shortcut: a mark's own characters count toward the wrap, so a marked row ends a few cells early; fine for a memo"""
    rows = []
    for src in text.replace("\r", "").split("\n"):
        heading = re.match(r"^(#{1,6})\s+(.*)$", src)
        item = re.match(r"^(\s*)([-*]|\d+\.)\s+(.*)$", src)
        if not src.strip():
            rows.append("")
        elif re.match(r"^\s*(-{3,}|\*{3,})\s*$", src):
            rows.append(line_of([("─" * cols, "overlay0", False)], cols))
        elif heading:
            tone = "mauve" if len(heading.group(1)) == 1 else "blue"
            rows += [line_of([(w, tone, True)], cols) for w in textwrap.wrap(heading.group(2), cols)]
        elif item:
            step = item.group(2)[0].isdigit()
            lead = f"{item.group(1)}{item.group(2) if step else '•'} "
            hang = " " * len(lead)
            for w in textwrap.wrap(item.group(3), cols, initial_indent=lead, subsequent_indent=hang):
                head = lead if w.startswith(lead) else hang
                rows.append(line_of([(head, "yellow" if step else "overlay1", False)] + inline(w[len(head):], "text"), cols))
        elif src.startswith(">"):
            rows += [line_of(inline(w, "overlay1"), cols) for w in textwrap.wrap(src[1:].strip(), cols)]
        else:
            rows += [line_of(inline(w, "text"), cols) for w in textwrap.wrap(src.strip(), cols)]
    return rows


def read_agents(dirs=AGENT_DIRS):
    """Every subagent file's frontmatter name and description, (name, description) by name. Of two files
    with one name the later dir wins, as a project agent overrides a user one.
    shortcut: a one-line description only; a YAML > or | block shows as its marker"""
    agents = {}
    for d in dirs:
        for root, _, files in os.walk(d):
            for f in sorted(files):
                if not f.endswith(".md"):
                    continue
                try:
                    with open(os.path.join(root, f), encoding="utf-8", errors="replace") as fh:
                        front = FRONT.match(fh.read(65536))
                except OSError:
                    continue
                if not front:
                    continue

                def field(key):
                    m = re.search(rf"^{key}:[ \t]*(.*?)[ \t]*$", front.group(1), re.M)
                    return m.group(1).strip("\"'") if m else ""

                if field("name") and field("description"):
                    agents[field("name")] = field("description")
    return sorted(agents.items())


def draw_doc(view, body, note, rows, cols, scroll, empty):
    """A memo view: its rows from where it is scrolled to (clamped there), a status row last."""
    if not body:
        return [line_of([(empty, "overlay1", False)], cols)]
    room = max(1, rows - 1)
    top = scroll[view] = max(0, min(scroll.get(view, 0), len(body) - room))
    where = f" · rows {top + 1}–{min(top + room, len(body))} of {len(body)} · ↑↓ PgUp PgDn wheel" if len(body) > room else ""
    shown = body[top: top + room]
    return shown + [""] * (room - len(shown)) + [line_of([(note + where, "overlay1", False)], cols)]


def draw_roster(rows, cols, scroll, dirs=AGENT_DIRS):
    """The agents one may call: each as a heading with what it does under it."""
    agents = read_agents(dirs)
    body = md_rows("\n".join(f"## @agent-{name}\n{desc}" for name, desc in agents), cols)
    return draw_doc("roster", body, f"{len(agents)} agents", rows, cols, scroll,
                    "No agents yet: write one to ~/.claude/agents/<name>.md with name and description in its frontmatter.")


def draw_keepsake(rows, cols, scroll, path=KEEPSAKE_PATH):
    """One's own memo on how to ask, from ~/.claude/keepsake.md."""
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            text = f.read(256 * 1024)
    except OSError:
        text = ""
    return draw_doc("keepsake", md_rows(text, cols) if text.strip() else [], "~/.claude/keepsake.md", rows, cols, scroll,
                    "No keepsake yet: write it to ~/.claude/keepsake.md")


def screen(view, agents, rows, cols, now, scroll=None):
    """Every row of the pane for a view: the tab strip, the view, blanks to the bottom."""
    scroll = {} if scroll is None else scroll
    if view == "roster":
        body = draw_roster(rows - 1, cols, scroll)
    elif view == "keepsake":
        body = draw_keepsake(rows - 1, cols, scroll)
    elif view == "agents":
        body = draw_agents(agents.session(), rows - 1, cols, now, scroll)
    else:
        body = draw_graph(agents.model, agents.session(), rows - 1, cols, now, scroll)
    return ([tab_strip(view, cols)] + body + [""] * rows)[:rows]


def write(data, fd=1):
    while data:
        data = data[os.write(fd, data):]


def size_of(fd):
    rows, cols = struct.unpack("hhhh", fcntl.ioctl(fd, termios.TIOCGWINSZ, b"\0" * 8))[:2]
    return rows or 24, cols or 80


def main():
    feed_path = sys.argv[1] if len(sys.argv) > 1 else ""
    shell = os.environ.get("SHELL") or "/bin/zsh"
    pid, fd = pty.fork()
    if pid == 0:
        os.execvp(shell, [shell, "-l"])  # login, as herdr starts its pane shells on macOS

    state = {"view": "shell", "used_alt": False, "modes": {}}  # modes: what the shell's output set last
    scroll = {v: 0 for v in VIEWS}
    held = bytearray()
    agents = Agents(feed_path)
    herdr = os.environ.get("HERDR_BIN_PATH") or "herdr"
    pane = os.environ.get("HERDR_PANE_ID")
    saved = termios.tcgetattr(0) if os.isatty(0) else None
    carry = b""

    def resize(*_):
        if os.isatty(0):
            fcntl.ioctl(fd, termios.TIOCSWINSZ, fcntl.ioctl(0, termios.TIOCGWINSZ, b"\0" * 8))

    def title(view):
        if pane:
            try:
                subprocess.run([herdr, "pane", "rename", pane, LABELS[view]], stdin=subprocess.DEVNULL,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=2)
            except (OSError, subprocess.SubprocessError):
                pass

    def at_prompt():
        """True while the shell itself has the terminal, not a program it runs."""
        try:
            return os.tcgetpgrp(fd) == pid
        except OSError:
            return False

    def mouse_back():
        """Mouse reports off again, or as the program in the shell had them."""
        return b"\x1b[?1000l\x1b[?1006l" + b"".join(b"\x1b[?" + m + b"h" for m in MOUSE_MODES if state["modes"].get(m))

    def show(view):
        if view == state["view"]:
            return
        if state["view"] == "shell":
            agents.poll()
            # The shell's screen stays on the main screen. A full-screen program the shell runs
            # is on the alternate one already: it is asked to redraw on the way back instead.
            state["used_alt"] = not any(state["modes"].get(m) for m in ALT_MODES)
            # mouse reports on, for the wheel
            write((b"\x1b[?1049h" if state["used_alt"] else b"") + b"\x1b[?25l\x1b[?1000h\x1b[?1006h")
        elif view == "shell":
            write((b"\x1b[?1049l" if state["used_alt"] else b"\x1b[2J") + b"\x1b[?25h" + mouse_back() + bytes(held))
            held.clear()
            if not state["used_alt"]:
                try:
                    os.killpg(os.tcgetpgrp(fd), signal.SIGWINCH)
                except OSError:
                    pass
        state["view"] = view
        title(view)

    def keys_in_view(data):
        page = max(1, size_of(0)[0] // 2)
        for key in KEYS.findall(data):
            at = VIEWS.index(state["view"])
            if key == b"\t":
                show(VIEWS[(at + 1) % len(VIEWS)])
            elif key == SHIFT_TAB:
                show(VIEWS[at - 1])
            elif key in (b"\x1b", b"q"):
                show("shell")
            elif key == b"c":
                if agents.session():
                    agents.session().clear()
            else:
                wheel = WHEEL.match(key)
                step = ARROWS.get(key, 0) + PAGES.get(key, 0) * page + ((3 if wheel.group(1) == b"5" else -3) if wheel else 0)
                scroll[state["view"]] = max(0, scroll[state["view"]] + step)  # the view clamps the far end
            if state["view"] == "shell":
                return

    signal.signal(signal.SIGWINCH, resize)
    resize()
    if saved:
        tty.setraw(0)
    status = None
    try:
        while True:
            live = state["view"] != "shell"
            # a view polls the log and redraws every turn: 10 a second for the graph's flow, 4 for the table
            ready, _, _ = select.select([0, fd], [], [], {"graph": 0.1, "agents": 0.25}.get(state["view"], 0.5))
            # macOS does not always wake select when the shell exits, so ask each turn
            done, status = os.waitpid(pid, os.WNOHANG)
            if done:
                while select.select([fd], [], [], 0)[0]:
                    try:
                        data = os.read(fd, 65536)
                    except OSError:
                        break
                    if not data:
                        break
                    held.extend(data) if live else write(data)
                break
            status = None
            if fd in ready:
                try:
                    data = os.read(fd, 65536)
                except OSError:
                    break  # the shell exited
                if not data:
                    break
                for m in MODES.finditer(carry + data):
                    state["modes"][m.group(1)] = m.group(2) == b"h"
                carry = data[-16:]
                if state["view"] == "shell":
                    write(data)
                else:
                    held.extend(data)
                    # shortcut: past 8 MB of output while a view is up the oldest is dropped,
                    # which may cut an escape sequence; spool to a file if that ever matters
                    del held[: max(0, len(held) - HELD_MAX)]
            if 0 in ready:
                data = os.read(0, 4096)
                if not data:
                    break
                if state["view"] == "shell":
                    # Tab alone in a read is the key, not part of a paste; at the prompt only, so a
                    # program the shell runs keeps its Tab
                    if data == b"\t" and at_prompt():
                        show("agents")
                    else:
                        before, hit, after = data.partition(SHIFT_TAB)
                        write(before, fd)
                        if hit:
                            show(VIEWS[-1])
                            keys_in_view(after)
                else:
                    keys_in_view(data)
            if state["view"] != "shell":
                agents.poll()
                rows, cols = size_of(0)
                lines = screen(state["view"], agents, rows, cols, time.time(), scroll)
                write("".join(f"\x1b[{r + 1};1H\x1b[2K{line}" for r, line in enumerate(lines)).encode())
    finally:
        if state["view"] != "shell":
            if state["used_alt"]:
                write(b"\x1b[?1049l")
            write(b"\x1b[?25h" + mouse_back())
            title("shell")
        if saved:
            termios.tcsetattr(0, termios.TCSANOW, saved)  # TCSAFLUSH would wait for unread output
    if status is None:
        _, status = os.waitpid(pid, 0)
    return os.waitstatus_to_exitcode(status)


if __name__ == "__main__":
    sys.exit(main())
