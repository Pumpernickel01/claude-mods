"""Tests for shell_tabs.py: the agents read from the log, what each view draws, and
the wrapper itself in a real pty. Run as `python3 viewer/shell_tabs_test.py` from
the mod folder."""
import json
import os
import pty
import re
import select
import sys
import tempfile
import time
import unittest
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import shell_tabs  # noqa: E402

SID = "sess0001-0000-0000-0000-000000000000"
ANSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")


def rec(i, event, **extra):
    ts = datetime.fromtimestamp(1792850000 + i, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    fields = {"ts": ts, "event": event, "status": "running", "session_id": SID, "agent_id": None, "cwd": "/tmp/proj"}
    return json.dumps({**fields, **extra}, separators=(",", ":"))


LOG = "\n".join([
    rec(0, "session_start"),
    rec(1, "agent_start", agent_type="Explore", description="Explore the repo", tool_use_id="toolu_a1"),
    rec(2, "agent_start", agent_id="a1a1a1a1", agent_type="Explore"),
    rec(3, "tool_end", agent_id="a1a1a1a1", tool="Read", status="done"),
    rec(4, "agent_start", session_id="other", agent_id="zzzzzzzz", agent_type="Elsewhere"),
    rec(5, "agent_start", agent_type="Plan", description="Plan it", tool_use_id="toolu_a2"),
    rec(6, "tool_end", tool="Agent", status="failed", tool_use_id="toolu_a2"),
    rec(7, "agent_stop", agent_id="a1a1a1a1", status="done", tokens={
        "input_tokens": 1000, "output_tokens": 500, "cache_read_input_tokens": 15000, "cache_creation_input_tokens": 4000}),
    "this line is not json",
    "",
])


def plain(lines):
    return [ANSI.sub("", line) for line in lines]


class Files(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.log = os.path.join(self.dir.name, "events.jsonl")
        self.feed = os.path.join(self.dir.name, "feed.json")
        with open(self.log, "w") as f:
            f.write(LOG)
        with open(self.feed, "w") as f:
            json.dump({"calls": [], "flows": [], "session": SID}, f)

    def tearDown(self):
        self.dir.cleanup()


class Views(Files):
    def agents(self):
        agents = shell_tabs.Agents(self.feed, self.log)
        self.addCleanup(lambda: agents.tail.f and agents.tail.f.close())
        return agents

    def test_agents_table_shows_this_session_only(self):
        agents = self.agents()
        self.assertTrue(agents.poll())
        text = "\n".join(plain(shell_tabs.draw_agents(agents.session(), 12, 120, time.time())))
        self.assertRegex(text, r"Explore·a1a1\s+done .*Explore the repo.*Read\s+20\.0k/0\.5k")
        self.assertRegex(text, r"Plan·u_a2\s+failed .*Plan it")
        self.assertNotIn("Elsewhere", text)
        self.assertIn("agents 0 running / 1 done / 1 failed · tool calls 2", text)

    def test_control_characters_from_the_log_never_reach_the_screen(self):
        with open(self.log, "a") as f:
            f.write(rec(8, "agent_start", agent_type="Bad", description="x\x1b]52;c;aGk=\x07y\x9b2J", tool_use_id="t9") + "\n")
            f.write(rec(9, "agent_start", agent_id="b9b9b9b9", agent_type="Bad") + "\n")
        agents = self.agents()
        agents.poll()
        drawn = "".join(shell_tabs.draw_agents(agents.session(), 12, 140, time.time()))
        self.assertIn("x ]52;c;aGk= y 2J", drawn)
        self.assertNotIn("\x07", drawn)
        self.assertNotIn("\x9b", drawn)
        self.assertNotIn("\x1b]", drawn)

    def test_only_records_whose_own_session_id_matches_are_read(self):
        with open(self.log, "a") as f:  # another session's record carrying this session's id nested inside
            f.write(json.dumps({"ts": "2026-10-24T12:00:09.000Z", "event": "session_start", "session_id": "other",
                                "extra": {"session_id": SID}}, separators=(",", ":")) + "\n")
        agents = self.agents()
        agents.poll()
        self.assertEqual(list(agents.model.sessions), [SID])

    def test_graph_draws_the_spawn_tree(self):
        agents = self.agents()
        agents.poll()
        lines = plain(shell_tabs.draw_graph(agents.model, agents.session(), 12, 80, time.time()))
        self.assertEqual(len(lines), 12)
        text = "\n".join(lines)
        self.assertIn("[main session]", text)
        self.assertIn("[Explore·a1a1]", text)
        self.assertIn("─ spawn  ┄ message  ● activity", lines[-1])
        self.assertTrue(all(len(line) <= 80 for line in lines))

    def test_tab_strip_names_all_three_views(self):
        self.assertTrue(plain([shell_tabs.tab_strip("graph", 100)])[0].startswith(" Shell  Agents  Agent graph "))

    def test_a_new_session_in_the_feed_starts_over(self):
        agents = self.agents()
        agents.poll()
        with open(self.feed, "w") as f:
            json.dump({"session": "a-newer-session-id"}, f)
        os.utime(self.feed, (time.time() + 5, time.time() + 5))
        agents.poll()
        self.assertIsNone(agents.session())


class Wrapper(Files):
    """shell_tabs.py around /bin/sh in a real pty, driven by keys."""

    def read_until(self, fd, pattern, timeout=5.0):
        seen, end = b"", time.time() + timeout
        while time.time() < end:
            ready, _, _ = select.select([fd], [], [], 0.1)
            if ready:
                try:
                    chunk = os.read(fd, 65536)
                except OSError:
                    break
                if not chunk:
                    break
                seen += chunk
                if re.search(pattern, seen):
                    return seen
        self.fail(f"never saw {pattern!r}; got {seen[-400:]!r}")

    def test_shift_tab_cycles_shell_agents_graph_and_back(self):
        env = {**os.environ, "SHELL": "/bin/sh", "CLAUDE_MODS_EVENT_LOG": self.log, "PS1": "$ "}
        env.pop("HERDR_PANE_ID", None)
        pid, fd = pty.fork()
        if pid == 0:
            os.execvpe(sys.executable, [sys.executable, os.path.join(HERE, "shell_tabs.py"), self.feed], env)
        try:
            self.read_until(fd, rb"\$ ")  # the shell drops what is typed before its first prompt
            # quotes split the word, so the echoed command line cannot match before the output does
            os.write(fd, b"echo be''fore\r")
            self.read_until(fd, rb"before")
            os.write(fd, shell_tabs.SHIFT_TAB)
            self.read_until(fd, rb"\x1b\[\?1049h(.|\n)*Agent graph(.|\n)*Explore")
            os.write(fd, b"echo du''ring\r")  # typed into the view: never reaches the shell
            os.write(fd, b"\t")
            self.read_until(fd, rb"\[main session\]")
            os.write(fd, b"\t")
            out = self.read_until(fd, rb"\x1b\[\?1049l")
            self.assertNotIn(b"during", out)
            os.write(fd, b"echo af''ter\r")
            self.read_until(fd, rb"after")
            os.write(fd, b"exit 3\r")
            _, status = os.waitpid(pid, 0)
            self.assertEqual(os.waitstatus_to_exitcode(status), 3)
        finally:
            try:
                os.kill(pid, 9)
            except OSError:
                pass
            os.close(fd)


if __name__ == "__main__":
    unittest.main()
