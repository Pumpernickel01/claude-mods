"""Offline tests for the scanner MCP server. Run from this folder:
uv run --with 'mcp>=1.2,<2' --with 'pyserial>=3.5,<4' python -m unittest
"""
import asyncio
import contextlib
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from mcp.server.fastmcp.exceptions import ToolError

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import server  # noqa: E402
import transport  # noqa: E402

STUB = "protocol frames must be filled in"


class FakeSerial:
    """Stands in for serial.Serial: records the open args and writes, replays one reply."""

    instances = []

    def __init__(self, port, baudrate, **kw):
        self.port, self.baudrate, self.kw = port, baudrate, kw
        self.written = b""
        self.reply = b"\xaa\x55\x01"
        self.closed = False
        FakeSerial.instances.append(self)

    def write(self, data):
        self.written += data
        return len(data)

    def read(self, n):
        reply, self.reply = self.reply[:n], b""
        return reply

    def close(self):
        self.closed = True


def no_real_env():
    env = {k: v for k, v in os.environ.items() if k != "SCANNER_MCP_REAL"}
    return mock.patch.dict(os.environ, env, clear=True)


class MockMode(unittest.TestCase):
    def test_mock_by_default(self):
        with no_real_env():
            status = server.get_status()
            config = server.read_config()
            result = server.scan()
        self.assertEqual(status["mode"], "mock")
        self.assertIsNone(status["device"])
        self.assertFalse(status["connected"])
        self.assertIn("SCANNER_MCP_REAL", status["reason"])
        self.assertEqual(config["mode"], "mock")
        self.assertEqual(set(config) - {"mode"},
                         {"power_dbm", "region", "session", "antenna_ports", "trigger_mode", "output_format"})
        self.assertEqual(result["mode"], "mock")

    def test_real_env_without_config_stays_mock(self):
        missing = Path(tempfile.mkdtemp()) / "scanner.json"
        with mock.patch.dict(os.environ, {"SCANNER_MCP_REAL": "1"}), mock.patch.object(server, "CONFIG", missing):
            status = server.get_status()
            self.assertEqual(server.scan()["mode"], "mock")
        self.assertEqual(status["mode"], "mock")
        self.assertIn(str(missing), status["reason"])

    def test_scan_caps_and_shape(self):
        with no_real_env():
            capped = server.scan(duration_ms=99_999, max_tags=3)
            zero = server.scan(duration_ms=-5, max_tags=0)
            a, b = server.scan(), server.scan()
        self.assertEqual(capped["duration_ms"], 10_000)
        self.assertLessEqual(len(capped["tags"]), 3)
        self.assertEqual((zero["duration_ms"], zero["tags"]), (0, []))
        for tag in a["tags"]:
            self.assertEqual(set(tag), {"epc", "rssi", "antenna", "count", "first_seen_ms"})
            self.assertEqual(len(tag["epc"]), 24)
            int(tag["epc"], 16)
            self.assertLessEqual(tag["first_seen_ms"], a["duration_ms"])
        self.assertNotEqual(a["tags"], b["tags"], "time-seeded scans should differ")

    def test_tool_names(self):
        self.assertEqual(server.mcp.name, "scanner")
        names = {t.name for t in asyncio.run(server.mcp.list_tools())}
        self.assertEqual(names, {"get_status", "read_config", "scan"})


class RealModePlumbing(unittest.TestCase):
    def setUp(self):
        FakeSerial.instances.clear()
        cfg = Path(tempfile.mkdtemp()) / "scanner.json"
        cfg.write_text(json.dumps({"device": "/dev/cu.usbserial-FAKE", "baud": 115200}))
        for p in (mock.patch.dict(os.environ, {"SCANNER_MCP_REAL": "1"}),
                  mock.patch.object(server, "CONFIG", cfg),
                  mock.patch.object(transport.serial, "Serial", FakeSerial)):
            p.start()
            self.addCleanup(p.stop)

    def test_status_reports_stub_error_and_closes_port(self):
        status = server.get_status()
        self.assertEqual(status["mode"], "real")
        self.assertEqual(status["device"], "/dev/cu.usbserial-FAKE")
        self.assertFalse(status["connected"])
        self.assertIn(STUB, status["last_error"])
        (port,) = FakeSerial.instances
        self.assertEqual((port.port, port.baudrate), ("/dev/cu.usbserial-FAKE", 115200))
        self.assertEqual((port.kw["bytesize"], port.kw["parity"], port.kw["stopbits"], port.kw["timeout"]),
                         (8, "N", 1, 1))
        self.assertTrue(port.closed, "port must be closed even when the frame stub raises")

    def test_stub_surfaces_as_tool_error(self):
        for name, args in (("read_config", {}), ("scan", {"max_tags": 300})):
            with self.assertRaises(ToolError) as cm:
                asyncio.run(server.mcp.call_tool(name, args))
            self.assertIn(STUB, str(cm.exception))
        self.assertTrue(all(p.closed for p in FakeSerial.instances))

    def test_send_logs_hex_and_times_out(self):
        err = io.StringIO()
        with contextlib.redirect_stderr(err), transport.SerialTransport("/dev/cu.usbserial-FAKE", 115200) as t:
            self.assertEqual(t.send(b"\x01\x02\xff"), b"\xaa\x55\x01")
            with self.assertRaises(TimeoutError):
                t.send(b"\x03")  # FakeSerial replies only once
        log = err.getvalue()
        self.assertIn("tx /dev/cu.usbserial-FAKE: 01 02 ff", log)
        self.assertIn("rx /dev/cu.usbserial-FAKE: aa 55 01", log)
        (port,) = FakeSerial.instances
        self.assertEqual(port.written, b"\x01\x02\xff\x03")
        self.assertTrue(port.closed)


class Stdio(unittest.TestCase):
    def test_initialize_and_tools_list(self):
        msgs = [
            {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
                "protocolVersion": "2025-06-18", "capabilities": {},
                "clientInfo": {"name": "test", "version": "0"}}},
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
        ]
        env = {k: v for k, v in os.environ.items() if k != "SCANNER_MCP_REAL"}
        proc = subprocess.run([sys.executable, str(HERE / "server.py")], env=env, capture_output=True,
                              text=True, timeout=10, input="".join(json.dumps(m) + "\n" for m in msgs))
        replies = {r.get("id"): r for r in map(json.loads, proc.stdout.splitlines())}
        self.assertEqual(replies[1]["result"]["serverInfo"]["name"], "scanner")
        tools = replies[2]["result"]["tools"]
        print("\nstdio tools/list ->", json.dumps([{"name": t["name"], "description": t["description"]}
                                                     for t in tools], indent=1))
        self.assertEqual({t["name"] for t in tools}, {"get_status", "read_config", "scan"})


if __name__ == "__main__":
    unittest.main()
