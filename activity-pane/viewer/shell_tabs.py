#!/usr/bin/env python3
"""The column's Shell pane, with two more views of Claude's agents.

    python3 shell_tabs.py <feed file>

The shell runs in a pty and passes straight through. Shift+Tab leaves it for
Agents; there Tab cycles Agents -> Agent graph -> Shell, Shift+Tab goes back one,
Esc or q returns to the shell. A view draws on the alternate screen, so the
shell's own screen comes back as it was; what the shell printed meanwhile is
held and written on return. herdr's pane title follows the view.

Agents come from ~/.claude/agent-monitor/events.jsonl (CLAUDE_MODS_EVENT_LOG),
which the claude-mods plugin's monitor hooks write; the session shown is the one
the feed names, or the latest in the log while it names none. Stdlib only.
"""
import fcntl
import json
import os
import pty
import re
import select
import signal
import struct
import subprocess
import sys
import termios
import time
import tty
from datetime import datetime, timezone

LOG_PATH = os.environ.get("CLAUDE_MODS_EVENT_LOG") or os.path.expanduser("~/.claude/agent-monitor/events.jsonl")
MAIN = "main"
VIEWS = ["shell", "agents", "graph"]
LABELS = {"shell": "Shell", "agents": "Agents", "graph": "Agent graph"}
SHIFT_TAB = b"\x1b[Z"
HELD_MAX = 8 * 1024 * 1024
KEYS = re.compile(rb"\x1b\[[<?0-9;]*[A-Za-z~]|\x1bO.|\x1b|.", re.S)
ALT_SCREEN = re.compile(rb"\x1b\[\?(?:1049|1047|47)([hl])")
# C0, DEL and C1: text from the log must never reach the terminal as an escape sequence
CONTROL = re.compile("[\x00-\x1f\x7f-\x9f]")

# Catppuccin Mocha, as the column's other viewers use.
MOCHA = {"text": "#cdd6f4", "blue": "#89b4fa", "green": "#a6e3a1", "yellow": "#f9e2af", "red": "#f38ba8",
         "teal": "#94e2d5", "subtext0": "#a6adc8", "overlay1": "#7f849c", "overlay0": "#6c7086", "surface0": "#313244"}
STATUS = {"running": "yellow", "done": "green", "failed": "red"}


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
        self.task, self.status, self.end = "", "running", None
        self.tools, self.last_tool, self.tokens, self.parent = 0, "", None, None

    @property
    def name(self):
        return "main session" if self.id == MAIN else f"{self.kind}·{self.id[-4:]}"

    def elapsed(self, now):
        return (now if self.end is None else self.end) - self.start


class Session:
    def __init__(self, sid, ts):
        self.id, self.start, self.last, self.ended = sid, ts, ts, False
        self.pending = []  # PreToolUse Agent records waiting for their SubagentStart (joined by order)
        self.nodes = {MAIN: Node(MAIN, "session", ts)}

    def node(self, nid, ts):
        if nid not in self.nodes:
            self.nodes[nid] = Node(nid, "agent", ts)
        return self.nodes[nid]


class Model:
    def __init__(self):
        self.sessions = {}
        self.edges = []  # (src, dst, kind) kind: spawn | msg
        self.pulses = []  # (edge, reverse, t0)

    def latest(self):
        return max(self.sessions.values(), key=lambda s: s.last, default=None)

    def pulse(self, src, dst, kind, reverse=False):
        e = (src, dst, kind)
        if e not in self.edges:
            self.edges.append(e)
        self.pulses.append((e, reverse, time.time()))

    def ingest(self, rec):
        ev, ts = rec.get("event"), parse_ts(rec.get("ts"))
        sid = rec.get("session_id") or "unknown"
        S = self.sessions.get(sid) or self.sessions.setdefault(sid, Session(sid, ts))
        S.last = max(S.last, ts)
        aid, main = rec.get("agent_id"), S.nodes[MAIN]
        if ev == "session_start":
            main.status = "running"
            main.task = os.path.basename(rec.get("cwd") or "")
        elif ev == "agent_start":
            if aid is None:  # PreToolUse Agent: description/task/type known, agent id not yet
                S.pending.append(rec)
            else:  # SubagentStart: join to the oldest pending spawn of this session
                pre = S.pending.pop(0) if S.pending else {}
                n = S.node(aid, ts)
                n.kind = pre.get("agent_type") or rec.get("agent_type") or "agent"
                n.task = pre.get("description") or pre.get("task") or ""
                n.parent = pre.get("parent_agent_id") or MAIN
                n.start, n.status = ts, "running"
                self.pulse(n.parent, aid, "spawn")
        elif ev == "tool_end":
            n = S.node(aid or MAIN, ts)
            n.tools += 1
            n.last_tool = rec.get("tool") or ""
            if aid is None:
                main.status = "running"
            if n.last_tool == "Agent" and rec.get("status") == "failed":
                pre = next((p for p in S.pending if p.get("tool_use_id") == rec.get("tool_use_id")), None)
                if pre:  # the spawn itself failed: show it as a failed row keyed by its tool_use_id
                    S.pending.remove(pre)
                    f = S.node(rec["tool_use_id"], parse_ts(pre.get("ts")))
                    f.kind, f.task = pre.get("agent_type") or "agent", pre.get("description") or ""
                    f.status, f.end, f.parent = "failed", ts, aid or MAIN
            if n.last_tool == "SendMessage" and rec.get("to"):
                self.pulse(n.id, rec["to"], "msg")
        elif ev == "agent_stop" and aid:
            n = S.node(aid, ts)
            n.status = "failed" if rec.get("status") == "failed" else "done"
            n.end, n.tokens = ts, rec.get("tokens") or n.tokens
            self.pulse(n.parent or MAIN, aid, "spawn", reverse=True)
        elif ev == "session_stop":
            main.status = "done"
        elif ev == "session_end":
            main.status, main.end, S.ended = "done", ts, True


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
    hint = "Tab next · Shift+Tab back · Esc shell"
    if cols - used > len(hint) + 2:
        parts.append(line_of([(" " * (cols - used - len(hint) - 1) + hint, "overlay0", False)], cols - used))
    return "".join(parts)


def cell(text, n):
    return text.ljust(n) if len(text) < n else text[: n - 2] + "… "


def draw_agents(S, rows, cols, now):
    if S is None:
        return [line_of([("No agent events yet for this session.", "overlay1", False)], cols)]
    task_w = max(12, cols - 79)
    head = (cell("Agent", 16) + cell("Status", 9) + cell("Elapsed", 9) + cell("Tools", 6) + cell("Task", task_w)
            + cell("Last tool", 12) + cell("Tokens in/out", 14) + "Start")
    main, agents = S.nodes[MAIN], [n for nid, n in S.nodes.items() if nid != MAIN]
    shown = [main] + agents[-max(0, rows - 3):]  # the newest agents when they do not all fit
    lines = [line_of([(head, "subtext0", True)], cols)]
    for n in shown:
        tok = tokens_in_out(n.tokens)
        rest = (cell(fmt_elapsed(n.elapsed(now)), 9) + cell(str(n.tools), 6) + cell(n.task, task_w)
                + cell(n.last_tool, 12) + cell(f"{k(tok[0])}/{k(tok[1])}" if tok else "-", 14)
                + time.strftime("%H:%M:%S", time.localtime(n.start)))
        lines.append(line_of([(cell(n.name, 16), "blue" if n is main else None, n is main),
                              (cell(n.status, 9), STATUS.get(n.status), False), (rest, None, False)], cols))
    r = sum(n.status == "running" for n in agents)
    d = sum(n.status == "done" for n in agents)
    f = sum(n.status == "failed" for n in agents)
    toks = [t for t in (tokens_in_out(n.tokens) for n in agents) if t]
    up = fmt_elapsed((S.last if S.ended else now) - S.start)
    total = (f"agents {r} running / {d} done / {f} failed · tool calls {sum(n.tools for n in S.nodes.values())} · "
             f"agent tokens {k(sum(t[0] for t in toks))} in / {k(sum(t[1] for t in toks))} out · uptime {up}")
    lines += [""] * max(0, rows - len(lines) - 1)
    return lines[: rows - 1] + [line_of([(total, "overlay1", False)], cols)]


LABEL_W, SLOT_W = 16, 20
EDGE_CHARS = " ─│┄┆╭╮╯╰├┤┬┴┼"
JUNCTION = {
    frozenset("lu"): "╯", frozenset("ld"): "╮", frozenset("ru"): "╰", frozenset("rd"): "╭",
    frozenset("lud"): "┤", frozenset("rud"): "├", frozenset("lru"): "┴", frozenset("lrd"): "┬",
    frozenset("lrud"): "┼",
}


def draw_graph(model, S, rows, cols, now):
    """Main session left, agents in a column (grid when tall) right. Solid = spawn,
    dashed = SendMessage; a dot runs along an edge for 1 s after each event on it."""
    if S is None:
        return [line_of([("No agent events yet for this session.", "overlay1", False)], cols)]
    w, h = cols, rows
    grid = [[" "] * w for _ in range(h)]
    sty = [[None] * w for _ in range(h)]

    def put(x, y, ch, style=None):
        if 0 <= x < w and 0 <= y < h:
            grid[y][x], sty[y][x] = ch, style

    main = S.nodes[MAIN]
    mlabel = f"[{main.name}]"
    my = h // 2
    pos = {MAIN: (1, my, len(mlabel))}
    agents = [n for nid, n in S.nodes.items() if nid != MAIN]
    x0 = min(22, max(len(mlabel) + 6, w // 3))
    spacing = 2 if len(agents) * 2 <= h - 1 else 1
    cap = max(1, (h - 1) // spacing)
    for i, n in enumerate(agents):
        col, row = divmod(i, cap)
        in_col = min(cap, len(agents) - col * cap)  # centre each column's block on the main row
        top = min(max(0, my - (in_col - 1) * spacing // 2), max(0, h - 1 - (in_col - 1) * spacing))
        x, y = x0 + col * SLOT_W, top + row * spacing
        if x + 4 < w and y < h - 1:
            pos[n.id] = (x, y, x + LABEL_W - 1)

    def path(src, dst, kind):
        if src not in pos or dst not in pos:
            return []
        sx, sy, sr = pos[src]
        dx, dy, dr = pos[dst]
        step = 1 if dy > sy else -1
        if src == MAIN and kind == "spawn":  # trunk just left of the agent column
            bus, start = x0 - 2, sr + 1
            tail = [(x, dy) for x in range(bus + 1, dx)]
        else:  # messages and agent-spawned agents run on a bus right of the agent nodes
            bus = max(sr, dr) + (2 if kind == "spawn" else 3)
            start = x0 - 1 if src == MAIN else sr + 1
            tail = [(x, dy) for x in range(bus - 1, dr, -1)]
        return ([(x, sy) for x in range(start, bus)] + [(bus, y) for y in range(sy, dy, step)]
                + [(bus, dy)] + tail)

    dirs_at = {}

    def draw(pts, kind, style):
        hch, vch = ("─", "│") if kind == "spawn" else ("┄", "┆")
        for i, (x, y) in enumerate(pts):
            d = dirs_at.setdefault((x, y, kind), set())
            for o in (pts[i - 1] if i else None, pts[i + 1] if i + 1 < len(pts) else None):
                if o is None:
                    continue
                d.add("l" if o[0] < x else "r" if o[0] > x else "u" if o[1] < y else "d")
            ch = JUNCTION.get(frozenset(d)) or (vch if d and d <= {"u", "d"} else hch)
            put(x, y, ch, style)

    for e in model.edges:
        draw(path(*e), e[2], ("overlay0", False) if e[2] == "spawn" else ("teal", False))
    for nid, (x, y, _) in pos.items():
        n = S.nodes[nid]
        label = mlabel if nid == MAIN else f"[{n.name}]"[:LABEL_W]
        style = ("blue", True) if nid == MAIN else (STATUS.get(n.status), False)
        for i, ch in enumerate(label):
            put(x + i, y, ch, style)
    model.pulses = [p for p in model.pulses if now - p[2] < 1.0]
    for (src, dst, kind), reverse, t0 in model.pulses:
        pts = path(src, dst, kind)
        if pts:
            pts = pts[::-1] if reverse else pts
            x, y = pts[min(len(pts) - 1, int((now - t0) * len(pts)))]
            if 0 <= x < w and 0 <= y < h and grid[y][x] in EDGE_CHARS:  # never over a label
                put(x, y, "●", ("text", True) if kind == "spawn" else ("teal", True))
    for i, ch in enumerate("─ spawn  ┄ message  ● activity"):
        put(i + 1, h - 1, ch, ("overlay0", False))

    lines = []
    for y in range(h):
        segs, x = [], 0
        while x < w:
            j = x
            while j < w and sty[y][j] == sty[y][x]:
                j += 1
            color, bold = sty[y][x] or (None, False)
            segs.append(("".join(grid[y][x:j]), color, bold))
            x = j
        lines.append(line_of(segs, w))
    return lines


def screen(view, agents, rows, cols, now):
    """Every row of the pane for a view: the tab strip, the view, blanks to the bottom."""
    body = (draw_agents(agents.session(), rows - 1, cols, now) if view == "agents"
            else draw_graph(agents.model, agents.session(), rows - 1, cols, now))
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

    state = {"view": "shell", "used_alt": False, "child_alt": False, "redraw": False}
    held = bytearray()
    agents = Agents(feed_path)
    herdr = os.environ.get("HERDR_BIN_PATH") or "herdr"
    pane = os.environ.get("HERDR_PANE_ID")
    saved = termios.tcgetattr(0) if os.isatty(0) else None
    carry = b""

    def resize(*_):
        if os.isatty(0):
            fcntl.ioctl(fd, termios.TIOCSWINSZ, fcntl.ioctl(0, termios.TIOCGWINSZ, b"\0" * 8))
        state["redraw"] = True

    def title(view):
        if pane:
            try:
                subprocess.run([herdr, "pane", "rename", pane, LABELS[view]], stdin=subprocess.DEVNULL,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=2)
            except (OSError, subprocess.SubprocessError):
                pass

    def show(view):
        if view == state["view"]:
            return
        if state["view"] == "shell":
            agents.poll()
            agents.model.pulses.clear()  # what was read to catch up is no live event
            # The shell's screen stays on the main screen. A full-screen program the shell runs
            # is on the alternate one already: it is asked to redraw on the way back instead.
            state["used_alt"] = not state["child_alt"]
            write((b"\x1b[?1049h" if state["used_alt"] else b"") + b"\x1b[?25l")
        elif view == "shell":
            write((b"\x1b[?1049l" if state["used_alt"] else b"\x1b[2J") + b"\x1b[?25h" + bytes(held))
            held.clear()
            if not state["used_alt"]:
                try:
                    os.killpg(os.tcgetpgrp(fd), signal.SIGWINCH)
                except OSError:
                    pass
        state["view"] = view
        title(view)
        state["redraw"] = True

    def keys_in_view(data):
        for key in KEYS.findall(data):
            at = VIEWS.index(state["view"])
            if key == b"\t":
                show(VIEWS[(at + 1) % len(VIEWS)])
            elif key == SHIFT_TAB:
                show(VIEWS[at - 1])
            elif key in (b"\x1b", b"q"):
                show("shell")
            if state["view"] == "shell":
                return

    signal.signal(signal.SIGWINCH, resize)
    resize()
    if saved:
        tty.setraw(0)
    last_draw = 0.0
    status = None
    try:
        while True:
            live = state["view"] != "shell"
            ready, _, _ = select.select([0, fd], [], [], 0.1 if live and agents.model.pulses else 0.5)
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
                for m in ALT_SCREEN.finditer(carry + data):
                    state["child_alt"] = m.group(1) == b"h"
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
                    before, hit, after = data.partition(SHIFT_TAB)
                    write(before, fd)
                    if hit:
                        show("agents")
                        keys_in_view(after)
                else:
                    keys_in_view(data)
            if state["view"] != "shell":
                now = time.time()
                if agents.poll() or state["redraw"] or agents.model.pulses or now - last_draw >= 1:
                    rows, cols = size_of(0)
                    lines = screen(state["view"], agents, rows, cols, now)
                    write("".join(f"\x1b[{r + 1};1H\x1b[2K{line}" for r, line in enumerate(lines)).encode())
                    state["redraw"], last_draw = False, now
    finally:
        if state["view"] != "shell":
            if state["used_alt"]:
                write(b"\x1b[?1049l")
            write(b"\x1b[?25h")
            title("shell")
        if saved:
            termios.tcsetattr(0, termios.TCSANOW, saved)  # TCSAFLUSH would wait for unread output
    if status is None:
        _, status = os.waitpid(pid, 0)
    return os.waitstatus_to_exitcode(status)


if __name__ == "__main__":
    sys.exit(main())
