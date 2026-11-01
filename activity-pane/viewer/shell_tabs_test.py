"""Tests for shell_tabs.py: the agents read from the log, what each view draws, and
the wrapper itself in a real pty. Run as `python3 viewer/shell_tabs_test.py` from
the mod folder."""
import itertools
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
        self.assertRegex(text, r"a1a1a1\s+Explore\s+done\s+\[░{10}\]\s+–\s.*Explore the repo.*Read\s+20\.0k/0\.5k")
        self.assertRegex(text, r"olu_a2\s+Plan\s+✗ failed .*Plan it")
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
        self.assertIn("● main", text)
        self.assertIn("● a1a1a1", text)
        self.assertIn("─ spawn  ┄ message  • talking  grey: finished  █ progress", lines[-1])
        self.assertTrue(all(len(line) <= 80 for line in lines))

    def test_tab_strip_names_all_five_views(self):
        self.assertTrue(plain([shell_tabs.tab_strip("graph", 100)])[0].startswith(" Shell  Agents  Agent graph  Roster  Keepsake "))

    def test_a_new_session_in_the_feed_starts_over(self):
        agents = self.agents()
        agents.poll()
        with open(self.feed, "w") as f:
            json.dump({"session": "a-newer-session-id"}, f)
        os.utime(self.feed, (time.time() + 5, time.time() + 5))
        agents.poll()
        self.assertIsNone(agents.session())


AGENT = "---\nname: {name}\ndescription: {desc}\ntools: Read\n---\n\nYou do the thing.\n"


class Memos(unittest.TestCase):
    """The Roster and Keepsake views: files read, rows within the width, scroll clamped."""

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.user, self.proj = [os.path.join(self.dir.name, d, "agents") for d in ("user", "proj")]
        os.makedirs(os.path.join(self.user, "sub"))
        os.makedirs(self.proj)
        files = {
            (self.user, "web.md"): AGENT.format(name="web-researcher", desc='"Researches a topic: a sourced brief."'),
            (self.user, "sub/fact.md"): AGENT.format(name="fact-checker", desc="Verifies one claim.\x1b[2J"),
            (self.user, "notes.txt"): AGENT.format(name="not-md", desc="skipped"),
            (self.user, "plain.md"): "# no frontmatter\nname: nope\n",
            (self.proj, "fact.md"): AGENT.format(name="fact-checker", desc="The project's own checker."),
        }
        for (d, name), text in files.items():
            with open(os.path.join(d, name), "w") as f:
                f.write(text)

    def tearDown(self):
        self.dir.cleanup()

    def test_agents_read_from_frontmatter_sorted_the_project_one_winning(self):
        self.assertEqual(shell_tabs.read_agents([self.user, self.proj]), [
            ("fact-checker", "The project's own checker."),
            ("web-researcher", "Researches a topic: a sourced brief."),
        ])
        self.assertEqual(shell_tabs.read_agents([os.path.join(self.dir.name, "none")]), [])

    def test_markdown_rows_wrap_within_the_width_and_hang_under_the_lead(self):
        md = "# How to ask\n\n1. Say the **outcome**, not the task, in one `sentence` that goes on for a while.\n- short\n> a quote\n---\nplain text"
        rows = plain(shell_tabs.md_rows(md, 30))
        self.assertEqual(rows[0], "How to ask")
        self.assertEqual(rows[1], "")
        self.assertTrue(rows[2].startswith("1. Say the outcome, not"), rows[2])
        self.assertTrue(rows[3].startswith("   ") and not rows[3].startswith("    "), rows[3])
        self.assertIn("• short", rows)
        self.assertIn("a quote", rows)
        self.assertEqual(rows[-2], "─" * 30)
        self.assertTrue(all(len(r) <= 30 for r in rows), rows)

    def test_roster_lists_each_agent_and_scrolls_within_its_rows(self):
        scroll = {"roster": 99}
        lines = plain(shell_tabs.draw_roster(4, 40, scroll, [self.user, self.proj]))
        self.assertEqual(len(lines), 4)
        self.assertTrue(lines[-1].startswith("2 agents · "), lines[-1])
        self.assertIn("rows", lines[-1])
        self.assertTrue(scroll["roster"] < 99)
        top = plain(shell_tabs.draw_roster(4, 40, {"roster": 0}, [self.user, self.proj]))
        self.assertEqual(top[0], "@agent-fact-checker")
        self.assertEqual(top[1], "The project's own checker.")
        self.assertTrue(all(len(line) <= 40 for line in top))

    def test_keepsake_shows_the_file_or_says_where_to_write_it(self):
        path = os.path.join(self.dir.name, "keepsake.md")
        self.assertIn("No keepsake yet: write it to ~/.claude/keepsake.md", plain(shell_tabs.draw_keepsake(5, 80, {}, path))[0])
        with open(path, "w") as f:
            f.write("## Remember\n- ask for the **outcome**\n")
        lines = plain(shell_tabs.draw_keepsake(5, 80, {}, path))
        self.assertEqual(lines[:2], ["Remember", "• ask for the outcome"])
        self.assertEqual(lines[-1].strip(), "~/.claude/keepsake.md")


T0 = 1792850000  # the fixtures' first timestamp, as rec() writes it


def spawn(i, tid, kind, desc="", parent=None, name=None):
    return rec(i, "agent_start", agent_type=kind, description=desc, tool_use_id=tid, parent_agent_id=parent, name=name)


def start(i, aid, kind):
    return rec(i, "agent_start", agent_id=aid, agent_type=kind)


class Live(Files):
    """The views as agents come, talk and go."""

    def agents_of(self, *lines):
        with open(self.log, "w") as f:
            f.write("\n".join(lines) + "\n")
        agents = shell_tabs.Agents(self.feed, self.log)
        self.addCleanup(lambda: agents.tail.f and agents.tail.f.close())
        agents.poll()
        return agents

    def test_a_spawn_shows_at_once_as_starting(self):
        a = self.agents_of(rec(0, "session_start"), spawn(1, "toolu_x1", "Explore", "Find callers"))
        table = "\n".join(plain(shell_tabs.draw_agents(a.session(), 12, 140, T0 + 2)))
        self.assertRegex(table, r"olu_x1\s+Explore\s+. starting .*Find callers")
        self.assertIn("● olu_x1", "\n".join(plain(shell_tabs.draw_graph(a.model, a.session(), 12, 100, T0 + 2))))

    def test_an_agent_keeps_its_place_in_the_graph_once_it_reports_in(self):
        before = self.agents_of(rec(0, "session_start"), spawn(1, "toolu_x1", "Explore", "Find callers"))
        after = self.agents_of(rec(0, "session_start"), spawn(1, "toolu_x1", "Explore", "Find callers"),
                               start(5, "agent_ox1", "Explore"))
        def where(a):
            lines = plain(shell_tabs.draw_graph(a.model, a.session(), 14, 100, T0 + 6))
            return next((y, m.start()) for y, line in enumerate(lines) for m in [re.search(r"● (?!main)", line)] if m)
        self.assertEqual(where(before), where(after))

    def test_an_agent_of_another_type_takes_no_spawn(self):
        a = self.agents_of(rec(0, "session_start"), spawn(1, "toolu_x1", "Explore", "Find callers"),
                           start(2, "eng_3333", "statusline"), start(3, "exp_4444", "Explore"))
        nodes = a.session().nodes
        self.assertEqual((nodes["exp_4444"].task, nodes["eng_3333"].task), ("Find callers", ""))
        self.assertNotIn("toolu_x1", nodes)

    def test_finished_agents_are_grey_and_a_session_end_retires_live_ones(self):
        a = self.agents_of(rec(0, "session_start"), spawn(1, "t1", "Explore"), start(2, "run_1111", "Explore"),
                           spawn(3, "t2", "Plan"), start(4, "fin_2222", "Plan"),
                           rec(5, "agent_stop", agent_id="fin_2222", status="done"), rec(9, "session_end"))
        S = a.session()
        self.assertEqual((S.nodes["run_1111"].status, S.nodes["fin_2222"].status), ("gone", "done"))
        rows = shell_tabs.draw_agents(S, 14, 140, T0 + 10)
        grey = f"38;2;{shell_tabs.rgb('overlay0')}m"
        for name in ("n_1111", "n_2222"):
            self.assertIn(grey, next(row for row in rows if name in plain([row])[0]))
        self.assertIn("agents 0 running / 1 done / 0 failed / 1 gone", plain(rows)[-1])

    def test_the_graph_flows_only_where_agents_talk_now(self):
        a = self.agents_of(rec(0, "session_start"), spawn(1, "t1", "Explore"), start(2, "run_1111", "Explore"))
        def edges_at(agents, now):  # the graph without its legend row, which has a dot of its own
            return "\n".join(plain(shell_tabs.draw_graph(agents.model, agents.session(), 12, 100, now))[:-1])

        frames = [edges_at(a, T0 + 20 + dt) for dt in (0, 0.1)]
        self.assertGreater(frames[0].count("•"), 0)
        self.assertNotEqual(frames[0], frames[1])  # the dots moved on
        done = self.agents_of(rec(0, "session_start"), spawn(1, "t1", "Explore"), start(2, "fin_2222", "Explore"),
                              rec(3, "agent_stop", agent_id="fin_2222", status="done"))
        self.assertNotIn("•", edges_at(done, T0 + 20))

    def test_a_message_to_a_name_finds_its_agent_and_is_listed(self):
        a = self.agents_of(rec(0, "session_start"), spawn(1, "t1", "general-purpose", name="researcher"),
                           start(2, "res_5555", "general-purpose"), spawn(3, "t2", "Explore"), start(4, "exp_4444", "Explore"),
                           rec(5, "tool_end", agent_id="exp_4444", tool="SendMessage", to="researcher", status="done"))
        S = a.session()
        table = "\n".join(plain(shell_tabs.draw_agents(S, 16, 140, T0 + 6)))
        self.assertIn("p_4444 ┄▶ s_5555  message", table)
        self.assertRegex(table, r"s_5555\s+researcher\s")  # the given name stays beside the id
        graph = "".join(shell_tabs.draw_graph(a.model, S, 14, 110, T0 + 6))
        self.assertIn(f"38;2;{shell_tabs.rgb('peach')}m", graph)  # the message edge is flowing
        self.assertIn("● s_5555", "".join(plain([graph])))

    def test_an_agent_never_seen_starting_is_not_shown(self):
        a = self.agents_of(rec(0, "session_start"), rec(1, "tool_end", agent_id="fork_8888", tool="Read", status="done"),
                           rec(2, "agent_stop", agent_id="fork_8888", agent_type="", status="done"))
        self.assertEqual(list(a.session().nodes), ["main"])

    def test_sub_agents_sit_under_the_agent_that_spawned_them(self):
        a = self.agents_of(rec(0, "session_start"), spawn(1, "t1", "Explore"), start(2, "par_6666", "Explore"),
                           spawn(3, "t2", "Plan", parent="par_6666"), start(4, "chi_7777", "Plan"))
        names = [row.split("  ")[0].strip() for row in plain(shell_tabs.draw_agents(a.session(), 12, 140, T0 + 5))[1:4]]
        self.assertEqual(names, ["main", "r_6666", "└ i_7777"])

    def crowd(self, parents, kids):
        """Running parents, each with `kids` spawns that failed: the 10 x 5 run that hit the agent limit."""
        lines, i = [rec(0, "session_start")], 1
        for p in range(1, parents + 1):
            aid = f"agent-p{p:03d}"
            lines += [spawn(i, f"tp{p}", "general"), start(i + 1, aid, "general")]
            i += 2
            for j in range(1, kids + 1):
                lines += [spawn(i, f"tc{p}-{j}", "general", parent=aid),
                          rec(i + 1, "tool_end", agent_id=aid, tool="Agent", status="failed", tool_use_id=f"tc{p}-{j}")]
                i += 2
        return self.agents_of(*lines)

    def test_a_long_agents_table_scrolls_and_says_where(self):
        S = self.crowd(4, 9).session()  # 41 rows with the main session
        scroll = {"agents": 0}
        self.assertIn("rows 1–6 of 41", "\n".join(plain(shell_tabs.draw_agents(S, 15, 140, T0 + 200, scroll))))
        scroll["agents"] = 30
        rows = plain(shell_tabs.draw_agents(S, 15, 140, T0 + 200, scroll))
        self.assertEqual(rows[1].split("  ")[0].strip(), "└ " + shell_tabs.tree(S)[30][0].tag)
        self.assertIn("rows 31–36 of 41", "\n".join(rows))
        scroll["agents"] = 999
        shell_tabs.draw_agents(S, 15, 140, T0 + 200, scroll)
        self.assertEqual(scroll["agents"], 35)  # clamped, so the first key back up moves at once

    def test_a_crowded_graph_scatters_around_a_centred_main_and_folds_finished_leaves(self):
        a = self.crowd(10, 5)
        lines = plain(shell_tabs.draw_graph(a.model, a.session(), 24, 100, T0 + 200))
        self.assertEqual(len(lines), 24)
        text = "\n".join(lines)
        self.assertEqual(text.count("◌ ✗ 5 failed"), 10)
        for p in range(1, 11):
            self.assertEqual(text.count(f"● t-p{p:03d}"), 1)
        self.assertEqual(lines[11].find("● main"), 47)  # the middle of a 23-row, 100-column view
        for line in lines[:-1]:  # nodes never overlap: a node's text is still whole
            self.assertNotRegex(line, r"[●✗] [\w-]*[●◌✗]")
        ys = {y for y, line in enumerate(lines) if re.search(r"[●◌✗] (?!main)", line)}
        self.assertGreater(len(ys), 4)  # spread around main (a 23-row view has 7 node rows), not stacked in a column
        self.assertEqual(lines, plain(shell_tabs.draw_graph(a.model, a.session(), 24, 100, T0 + 200)))  # same places every frame

    def test_graph_labels_never_touch_and_edges_are_smooth_elbows(self):
        lines, i = [rec(0, "session_start")], 1
        for p in range(1, 11):  # 10 running agents with 3 running sub-agents each: 41 labels, none folded
            aid = f"agent-p{p:03d}"
            lines += [spawn(i, f"tp{p}", "general"), start(i + 1, aid, "general")]
            i += 2
            for j in range(3):
                lines += [spawn(i, f"tc{p}-{j}", "Explore", parent=aid), start(i + 1, f"kid-{p}-{j}", "Explore")]
                i += 2
        a = self.agents_of(*lines)
        rows = plain(shell_tabs.draw_graph(a.model, a.session(), 60, 120, T0 + 300))
        self.assertNotIn("rows 1–", rows[-1])  # a pane this tall holds the whole graph
        rows, text = rows[:-1], "\n".join(rows[:-1])
        self.assertNotRegex(text, r"[╱╲]")  # no stair-stepping diagonals
        self.assertTrue(set("╭╮╰╯") & set(text))
        labels = [(y, m.start(), m.end() - 1) for y, row in enumerate(rows) for m in re.finditer(r"● [\w-]+", row)]
        self.assertEqual(len(labels), 41)  # main too
        for (ay, ax0, ax1), (by, bx0, bx1) in itertools.combinations(labels, 2):
            if abs(ay - by) < 3:  # a node is two rows: on the same rows or the next, a cell of air between them at least
                self.assertTrue(ax1 + 1 < bx0 or bx1 + 1 < ax0, f"labels touch at rows {ay}/{by}")

    def test_the_progress_bar_is_the_agents_task_list_read_from_its_transcript(self):
        tp = os.path.join(self.dir.name, "sess.jsonl")
        sub = os.path.join(self.dir.name, "sess", "subagents")
        os.makedirs(sub)

        def todo_line(*statuses):
            todos = [{"content": f"step {i}", "status": st, "activeForm": f"doing {i}"} for i, st in enumerate(statuses)]
            return json.dumps({"message": {"role": "assistant", "content": [
                {"type": "tool_use", "id": "toolu_1", "name": "TodoWrite", "input": {"todos": todos}}]}},
                separators=(",", ":")) + "\n"
        path = os.path.join(sub, "agent-a1a1a1a1b2b2b2b2c.jsonl")
        with open(path, "w") as f:
            f.write('{"message":{"usage":{"input_tokens":2,"cache_read_input_tokens":82339,"output_tokens":109}}}\n'
                    + todo_line("completed", "in_progress", "pending", "pending", "pending")
                    + todo_line("completed", "completed", "in_progress", "pending", "pending")[:-1])  # the last list counts
        a = self.agents_of(rec(0, "session_start", transcript_path=tp), spawn(1, "t1", "Explore"),
                           start(2, "a1a1a1a1b2b2b2b2c", "Explore"), spawn(3, "toolu_x2", "Plan"))
        S = a.session()
        table = "\n".join(plain(shell_tabs.draw_agents(S, 12, 140, T0 + 3)))
        self.assertIn("[████░░░░░░]  40%", table)  # 2 of 5 done
        self.assertIn("[░░░░░░░░░░]   –", table)  # the spawn has no task list yet
        graph = plain(shell_tabs.draw_graph(a.model, S, 12, 100, T0 + 3))
        y, x = next((y, line.index("● a1a1a1")) for y, line in enumerate(graph) if "● a1a1a1" in line)
        self.assertEqual(graph[y + 1][x:x + 8], "███░░░░░")
        with open(path, "a") as f:  # a usage line after the list: the list still counts, and the bar is full once done
            f.write('\n{"message":{"usage":{"input_tokens":2,"cache_read_input_tokens":99999,"output_tokens":9}}}\n')
        os.utime(path, (T0 + 9, T0 + 9))
        self.assertEqual(shell_tabs.progress_pct(S, S.nodes["a1a1a1a1b2b2b2b2c"], T0 + 9), 40.0)
        a.model.ingest(json.loads(rec(10, "agent_stop", agent_id="a1a1a1a1b2b2b2b2c")))
        self.assertIn("[██████████] 100%", "\n".join(plain(shell_tabs.draw_agents(a.session(), 12, 140, T0 + 11))))
        self.assertEqual((shell_tabs.bar(85, 10), shell_tabs.bar(None, 4)), ("█████████░", "░░░░"))

    def test_a_graph_still_too_tall_scrolls(self):
        a = self.crowd(10, 5)  # 21 labels once folded, far more than a 7-row view holds: the canvas grows
        scroll = {"graph": 99}
        lines = plain(shell_tabs.draw_graph(a.model, a.session(), 8, 80, T0 + 200, scroll))
        h = int(re.search(r"of (\d+)", lines[-1]).group(1))
        self.assertGreater(h, 7)
        self.assertEqual((len(lines), scroll["graph"]), (8, h - 7))  # clamped to the last screen
        self.assertIn(f"rows {h - 6}–{h} of {h}", lines[-1])
        self.assertRegex("\n".join(lines[:-1]), r"[●◌✗] ")  # the scrolled-to rows hold agents

    def test_clear_drops_finished_agents_and_keeps_live_ones(self):
        a = self.agents_of(rec(0, "session_start"), spawn(1, "t1", "Explore"), start(2, "par_6666", "Explore"),
                           spawn(3, "t2", "Plan", parent="par_6666"), start(4, "chi_7777", "Plan"),
                           spawn(5, "t3", "Plan"), rec(6, "tool_end", tool="Agent", status="failed", tool_use_id="t3"),
                           rec(7, "agent_stop", agent_id="par_6666", status="done"))
        S = a.session()
        S.clear()
        self.assertEqual(list(S.nodes), ["main", "chi_7777"])
        self.assertEqual(S.nodes["chi_7777"].parent, "main")
        self.assertTrue(all(src.id != "par_6666" and getattr(dst, "id", "") != "par_6666" for _, _, src, dst in S.comms))


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

    def test_tab_cycles_shell_agents_graph_roster_keepsake_and_c_clears_finished(self):
        env = {**os.environ, "SHELL": "/bin/sh", "CLAUDE_MODS_EVENT_LOG": self.log, "PS1": "$ ", "HOME": self.dir.name}
        env.pop("HERDR_PANE_ID", None)
        os.makedirs(os.path.join(self.dir.name, ".claude", "agents"))
        with open(os.path.join(self.dir.name, ".claude", "agents", "t.md"), "w") as f:
            f.write(AGENT.format(name="tester", desc="Tests things."))
        with open(os.path.join(self.dir.name, ".claude", "keepsake.md"), "w") as f:
            f.write("# Remember this\n")
        pid, fd = pty.fork()
        if pid == 0:
            os.execvpe(sys.executable, [sys.executable, os.path.join(HERE, "shell_tabs.py"), self.feed], env)
        try:
            self.read_until(fd, rb"\$ ")  # the shell drops what is typed before its first prompt
            # quotes split the word, so the echoed command line cannot match before the output does
            os.write(fd, b"echo be''fore\r")
            self.read_until(fd, rb"before")
            os.write(fd, b"\t")
            self.read_until(fd, rb"\x1b\[\?1049h(.|\n)*Agent graph(.|\n)*Explore")
            os.write(fd, b"printf du''ring\r")  # typed into the view: never reaches the shell
            os.write(fd, b"c")  # both of the fixture's agents are finished
            self.read_until(fd, rb"agents 0 running / 0 done / 0 failed")
            os.write(fd, b"\t")
            self.read_until(fd, rb"\xe2\x97\x8f main")
            os.write(fd, b"\t")
            self.read_until(fd, rb"@agent-tester(.|\n)*Tests things")
            os.write(fd, b"\t")
            self.read_until(fd, rb"Remember this")
            os.write(fd, b"\t")
            out = self.read_until(fd, rb"\x1b\[\?1049l")
            os.write(fd, b"echo af''ter\r")
            out += self.read_until(fd, rb"after")
            self.assertNotIn(b"during", out)
            os.write(fd, shell_tabs.SHIFT_TAB)  # back one from the shell: Keepsake
            self.read_until(fd, rb"\x1b\[\?1049h(.|\n)*Remember this")
            os.write(fd, b"\x1b")
            self.read_until(fd, rb"\x1b\[\?1049l")
            os.write(fd, b"cat\r")  # a program the shell runs keeps its Tab
            self.read_until(fd, rb"cat\r\n")
            time.sleep(0.3)
            os.write(fd, b"\t")
            time.sleep(0.2)
            os.write(fd, b"kept\r")
            out = self.read_until(fd, rb"kept\r\n(.|\n)*kept")  # the tty's echo, then cat's copy
            self.assertNotIn(b"\x1b[?1049h", out)
            os.write(fd, b"\x04")
            self.read_until(fd, rb"\$ ")
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
