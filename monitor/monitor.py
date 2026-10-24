#!/usr/bin/env python3
"""Live agent monitor TUI (Textual). Started by monitor.sh as
    uv run --quiet --no-project --with 'textual>=0.80,<2' python monitor.py
Tails ~/.claude/agent-monitor/events.jsonl (CLAUDE_MODS_EVENT_LOG) written by monitor/hooks/emit.py.
Keys: a = all sessions / latest only, q = quit.
"""
import asyncio
import json
import os
import signal
import sys
import time
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "lib"))
from events import LOG_PATH  # noqa: E402
from termcap import detect  # noqa: E402

TC = detect()
if not TC.truecolor:
    os.environ.setdefault("TEXTUAL_COLOR_SYSTEM", "256")  # read by textual at import time

from rich.text import Text  # noqa: E402
from textual.app import App  # noqa: E402
from textual.widget import Widget  # noqa: E402
from textual.widgets import DataTable, Footer, Static, TabbedContent, TabPane  # noqa: E402

STATE_DIR = os.path.dirname(LOG_PATH)
PID_FILE = os.path.join(STATE_DIR, "monitor.pid")
META_FILE = os.path.join(STATE_DIR, "monitor.json")
ROTATE_BYTES = 20 * 1024 * 1024
MAIN = "main"
COLOURS = {"running": "yellow", "done": "green", "failed": "red"}


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
        return [ln.decode("utf-8", "replace") for ln in lines]


LABEL_W, SLOT_W = 16, 20
EDGE_CHARS = " ─│┄┆╭╮╯╰├┤┬┴┼"
JUNCTION = {
    frozenset("lu"): "╯", frozenset("ld"): "╮", frozenset("ru"): "╰", frozenset("rd"): "╭",
    frozenset("lud"): "┤", frozenset("rud"): "├", frozenset("lru"): "┴", frozenset("lrd"): "┬",
    frozenset("lrud"): "┼",
}


class Graph(Widget):
    """Main session left, agents in a column/grid right. Solid = spawn, dashed = SendMessage,
    a dot travels along an edge for 1 s after each event on it."""

    DEFAULT_CSS = "Graph { height: 1fr; width: 1fr; }"

    def __init__(self, model, **kw):
        super().__init__(**kw)
        self.model = model

    def render(self):
        w, h = self.size.width or 60, self.size.height or 20
        S = self.model.latest()
        if S is None:
            return Text("waiting for events...", style="dim")
        grid = [[" "] * w for _ in range(h)]
        sty = [[""] * w for _ in range(h)]

        def put(x, y, ch, style=""):
            if 0 <= x < w and 0 <= y < h:
                grid[y][x], sty[y][x] = ch, style

        main = S.nodes[MAIN]
        mlabel = f"[{main.name}]"
        my = h // 2
        pos = {MAIN: (1, my, len(mlabel))}
        agents = [n for k, n in S.nodes.items() if k != MAIN]
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

        for e in self.model.edges:
            draw(path(*e), e[2], "dim" if e[2] == "spawn" else "cyan")
        for nid, (x, y, _) in pos.items():
            n = S.nodes[nid]
            label = mlabel if nid == MAIN else f"[{n.name}]"[:LABEL_W]
            style = "bold blue" if nid == MAIN else COLOURS.get(n.status, "")
            for i, ch in enumerate(label):
                put(x + i, y, ch, style)
        now = time.time()
        self.model.pulses = [p for p in self.model.pulses if now - p[2] < 1.0]
        for (src, dst, kind), reverse, t0 in self.model.pulses:
            pts = path(src, dst, kind)
            if pts:
                pts = pts[::-1] if reverse else pts
                x, y = pts[min(len(pts) - 1, int((now - t0) * len(pts)))]
                if 0 <= x < w and 0 <= y < h and grid[y][x] in EDGE_CHARS:  # never over a label
                    put(x, y, "●", "bold white" if kind == "spawn" else "bold cyan")
        legend = "─ spawn  ┄ message  ● activity"
        for i, ch in enumerate(legend):
            put(i + 1, h - 1, ch, "dim")

        out = Text(no_wrap=True)
        for y in range(h):
            x = 0
            while x < w:
                j = x
                while j < w and sty[y][j] == sty[y][x]:
                    j += 1
                out.append("".join(grid[y][x:j]), sty[y][x] or None)
                x = j
            if y < h - 1:
                out.append("\n")
        return out


class MonitorApp(App):
    TITLE = "Claude agents"
    CSS = "DataTable { height: 1fr; } #totals { height: 1; padding: 0 1; color: $text-muted; }"
    BINDINGS = [("a", "toggle_all", "All sessions"), ("q", "quit", "Quit")]

    def __init__(self, log_path=LOG_PATH, guard=False):
        super().__init__()
        self.model, self.tail, self.guard = Model(), Tail(log_path), guard
        self.all_sessions, self.row_keys = False, set()

    def compose(self):
        with TabbedContent(initial="agents"):
            with TabPane("Agents", id="agents"):
                yield DataTable(id="table", cursor_type="row", zebra_stripes=True)
                yield Static(id="totals")
            with TabPane("Graph", id="graph"):
                yield Graph(self.model, id="graphw")
        yield Footer()

    def on_mount(self):
        self.cols = self.query_one(DataTable).add_columns(
            "Agent", "Task", "Status", "Start", "Elapsed", "Tools", "Last tool", "Tokens in/out")
        try:
            asyncio.get_running_loop().add_signal_handler(signal.SIGTERM, self.exit)
        except (NotImplementedError, RuntimeError):
            pass
        self.ingest()
        self.set_interval(0.5, self.ingest)
        self.set_interval(1.0, self.refresh_table)
        self.set_interval(0.1, self.tick_graph)
        self.set_interval(5.0, self.check_alive)

    def ingest(self):
        changed = False
        for line in self.tail.read():
            try:
                rec = json.loads(line)
            except ValueError:
                continue
            if isinstance(rec, dict):
                self.model.ingest(rec)
                changed = True
        try:
            if os.path.getsize(self.tail.path) > ROTATE_BYTES:
                os.replace(self.tail.path, self.tail.path + ".1")  # only the monitor rotates
        except OSError:
            pass
        if changed:
            self.refresh_table()

    def visible_sessions(self):
        if self.all_sessions:
            return list(self.model.sessions.values())
        S = self.model.latest()
        return [S] if S else []

    def cells(self, n, now, task_w):
        task = n.task if len(n.task) <= task_w else n.task[: task_w - 1] + "…"
        tok = tokens_in_out(n.tokens)
        return (Text(n.name, style="bold" if n.id == MAIN else ""), task,
                Text(n.status, style=COLOURS.get(n.status, "")),
                time.strftime("%H:%M:%S", time.localtime(n.start)), fmt_elapsed(n.elapsed(now)),
                str(n.tools), n.last_tool, f"{tok[0] / 1000:.1f}k/{tok[1] / 1000:.1f}k" if tok else "-")

    def refresh_table(self):
        table, now = self.query_one(DataTable), time.time()
        task_w = max(12, table.size.width - 78)
        r = d = f = tools = tin = tout = 0
        for S in self.visible_sessions():
            for n in S.nodes.values():
                key = f"{S.id}:{n.id}"
                cells = self.cells(n, now, task_w)
                if key in self.row_keys:
                    for col, val in zip(self.cols, cells):
                        table.update_cell(key, col, val, update_width=True)
                else:
                    table.add_row(*cells, key=key)
                    self.row_keys.add(key)
                tools += n.tools
                if n.id != MAIN:
                    r, d, f = r + (n.status == "running"), d + (n.status == "done"), f + (n.status == "failed")
                    tok = tokens_in_out(n.tokens)
                    if tok:
                        tin, tout = tin + tok[0], tout + tok[1]
        S = self.model.latest()
        up = fmt_elapsed((S.last if S.ended else now) - S.start) if S else "-"
        self.query_one("#totals", Static).update(
            f"{'ALL SESSIONS' if self.all_sessions else (S.id[:8] if S else 'no session')} · "
            f"agents {r} running / {d} done / {f} failed · tool calls {tools} · "
            f"agent tokens {tin / 1000:.1f}k in / {tout / 1000:.1f}k out (main cost: status line) · uptime {up}")

    def tick_graph(self):
        if self.query_one(TabbedContent).active == "graph":
            self.query_one(Graph).refresh()

    def action_toggle_all(self):
        self.all_sessions = not self.all_sessions
        self.query_one(DataTable).clear()
        self.row_keys.clear()
        self.refresh_table()

    def check_alive(self):
        """Orphan safety: quit when the PID file is gone/not ours, the parent terminal died,
        or the session that auto-opened us has ended."""
        if not self.guard:
            return
        try:
            with open(PID_FILE) as fh:
                mine = int(fh.read()) == os.getpid()
        except (OSError, ValueError):
            mine = False
        if not mine or os.getppid() == 1:
            self.exit()
            return
        try:
            with open(META_FILE) as fh:
                S = self.model.sessions.get(json.load(fh).get("session_id"))
        except (OSError, ValueError):
            S = None
        if S and S.ended:
            self.exit()


def main():
    os.makedirs(STATE_DIR, mode=0o700, exist_ok=True)
    try:
        with open(PID_FILE) as f:
            other = int(f.read())
        os.kill(other, 0)
        print(f"monitor already running (pid {other})")
        return 1
    except (OSError, ValueError):
        pass
    fd = os.open(PID_FILE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(str(os.getpid()))
    try:
        MonitorApp(guard=True).run()
    finally:
        try:
            with open(PID_FILE) as f:
                if int(f.read()) == os.getpid():
                    os.remove(PID_FILE)
        except (OSError, ValueError):
            pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
