#!/usr/bin/env python3
"""Scanner MCP server: read-only access to a UHF RFID handheld reader.

Mock by default. Real mode needs BOTH SCANNER_MCP_REAL=1 in the environment
AND ~/.config/claude-mods/scanner.json with an explicit device path; otherwise
every tool returns mock data and says so. Run via uv (see README.md).
"""
import json
import os
import random
import time
from pathlib import Path

from mcp.server.fastmcp import FastMCP

CONFIG = Path("~/.config/claude-mods/scanner.json").expanduser()
MAX_DURATION_MS = 10_000
MOCK_FIRMWARE = "mock-1.0.0"

mcp = FastMCP("scanner")


def real_config():
    """(config, None) when real mode is fully enabled, else (None, reason)."""
    if os.environ.get("SCANNER_MCP_REAL") != "1":
        return None, "SCANNER_MCP_REAL=1 is not set in the environment"
    if not CONFIG.is_file():
        return None, f"{CONFIG} does not exist"
    try:
        cfg = json.loads(CONFIG.read_text())
    except ValueError as e:
        return None, f"{CONFIG} is not valid JSON: {e}"
    if not isinstance(cfg, dict) or not isinstance(cfg.get("device"), str) or not cfg["device"]:
        return None, f'"device" (serial port path) is missing in {CONFIG}'
    return {"device": cfg["device"], "baud": cfg.get("baud", 115200)}, None


def _open(cfg):
    import transport  # imported here so mock mode never depends on pyserial

    return transport, transport.SerialTransport(cfg["device"], cfg["baud"])


@mcp.tool()
def get_status() -> dict:
    """Reader status. mode is "mock" unless real mode is fully enabled; then
    `reason` says what is missing. In real mode a failed device query is
    reported in last_error instead of raising."""
    cfg, reason = real_config()
    if cfg is None:
        return {"mode": "mock", "device": None, "connected": False, "firmware": MOCK_FIRMWARE,
                "battery_pct": 87, "last_error": None, "reason": reason}
    try:
        transport, link = _open(cfg)
        with link as t:
            info = transport.get_status(t)
        return {"mode": "real", "device": cfg["device"], "connected": True,
                "firmware": info["firmware"], "battery_pct": info["battery_pct"], "last_error": None}
    except Exception as e:  # status must report, not raise: open failures and the frame stub land here
        return {"mode": "real", "device": cfg["device"], "connected": False, "firmware": "unknown",
                "battery_pct": None, "last_error": f"{type(e).__name__}: {e}"}


@mcp.tool()
def read_config() -> dict:
    """Current reader settings (read-only; there is no set_config)."""
    cfg, _ = real_config()
    if cfg is None:
        return {"mode": "mock", "power_dbm": 26, "region": "ETSI", "session": "S1",
                "antenna_ports": [1], "trigger_mode": "manual", "output_format": "epc_hex"}
    transport, link = _open(cfg)
    with link as t:
        return {"mode": "real", **transport.read_config(t)}


@mcp.tool()
def scan(duration_ms: int = 1000, max_tags: int = 50) -> dict:
    """Inventory tags for duration_ms (capped at 10000) returning at most max_tags."""
    duration_ms = max(0, min(duration_ms, MAX_DURATION_MS))
    max_tags = max(0, max_tags)
    cfg, _ = real_config()
    if cfg is not None:
        transport, link = _open(cfg)
        with link as t:
            return {"mode": "real", "duration_ms": duration_ms, **transport.scan(t, duration_ms, max_tags)}
    rng = random.Random(time.time_ns())  # deterministic per call, differs between calls
    n = min(max_tags, rng.randint(1, 8))
    tags = [{
        "epc": "30" + rng.randbytes(11).hex().upper(),  # 96-bit SGTIN-style EPC
        "rssi": rng.randint(-75, -40),
        "antenna": 1,
        "count": rng.randint(1, 20),
        "first_seen_ms": rng.randint(0, duration_ms),
    } for _ in range(n)]
    tags.sort(key=lambda tag: tag["first_seen_ms"])
    return {"tags": tags, "duration_ms": duration_ms, "mode": "mock"}


if __name__ == "__main__":
    mcp.run("stdio")
