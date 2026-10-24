#!/usr/bin/env python3
"""Headless TUI check, run by test.sh:
    uv run --quiet --no-project --with 'textual>=0.80,<2' python test_tui.py <events.jsonl>
Loads the synthetic events file, asserts the Agents table and the Graph, prints the graph."""
import asyncio
import os
import sys

os.environ["CLAUDE_MODS_EVENT_LOG"] = os.path.abspath(sys.argv[1])
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import monitor  # noqa: E402  (sets TEXTUAL_COLOR_SYSTEM before importing textual)
from textual.widgets import DataTable, TabbedContent  # noqa: E402


async def run():
    app = monitor.MonitorApp()
    async with app.run_test(size=(100, 30)) as pilot:
        await pilot.pause()
        table = app.query_one(DataTable)
        assert table.row_count == 4, table.row_count
        rows = {str(table.get_row(k)[0]): str(table.get_row(k)[2]) for k in table.rows}
        assert rows["main session"] == "running", rows
        assert sorted(rows.values()) == ["done", "failed", "running", "running"], rows
        done = [k for k in table.rows if str(table.get_row(k)[2]) == "done"][0]
        assert str(table.get_row(done)[7]) == "20.0k/0.5k", table.get_row(done)
        assert "tool calls 6" in str(app.query_one("#totals").renderable), app.query_one("#totals").renderable
        app.query_one(TabbedContent).active = "graph"
        await pilot.pause()
        g = app.query_one(monitor.Graph)
        assert g.size.width >= 60 and g.size.height >= 20, g.size
        text = g.render().plain
        assert "─" in text and "┄" in text, text  # solid spawn edge + dashed message edge
        assert "[main session]" in text and "[Explore" in text, text
        assert sum(1 for e in app.model.edges if e[2] == "msg") == 2, app.model.edges
        await pilot.press("a")
        await pilot.pause()
        assert table.row_count == 4, table.row_count
    print("ok tui TERM_PROGRAM=%s truecolor=%s TEXTUAL_COLOR_SYSTEM=%s" % (
        os.environ.get("TERM_PROGRAM"), monitor.TC.truecolor, os.environ.get("TEXTUAL_COLOR_SYSTEM")))
    print(text)


asyncio.run(run())
