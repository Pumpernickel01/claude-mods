# scanner — MCP server for a UHF RFID handheld reader

Read-only access to "the scanner" (a UHF RFID / QR handheld) from Claude Code.
Tools appear as `mcp__plugin_mods_scanner__<tool>`:

| Tool | Returns |
| :- | :- |
| `get_status()` | `{mode, device, connected, firmware, battery_pct, last_error}` (+ `reason` in mock mode) |
| `read_config()` | `{mode, power_dbm, region, session, antenna_ports, trigger_mode, output_format}` |
| `scan(duration_ms=1000, max_tags=50)` | `{tags: [{epc, rssi, antenna, count, first_seen_ms}], duration_ms, mode}`; `duration_ms` is capped at 10 000 |

There is **no `set_config`**: writing settings to the hardware is out of scope,
and nothing in this server can change the device.

## Mock by default (guarantee)

Every tool returns mock data and labels it `"mode": "mock"` unless **both** of
these hold at call time:

1. `SCANNER_MCP_REAL=1` is in the server's environment, and
2. `~/.config/claude-mods/scanner.json` exists with an explicit device path:
   ```json
   {"device": "/dev/cu.usbserial-XXXX", "baud": 115200}
   ```

If either is missing, `get_status()` says so in `reason`. Ports are never
auto-detected; the path in the config file is the only one ever opened. Mock
`scan` results are pseudo-random EPCs seeded from the clock, so repeated calls
differ plausibly. Mock mode has no dependency on `pyserial`.

## Enabling real mode

1. Write the config file above (`baud` defaults to 115200 if omitted).
2. Add `"env": {"SCANNER_MCP_REAL": "1"}` to the server entry in `.mcp.json`
   (or export it in the shell that starts Claude Code).
3. Fill in the protocol stub (next section). Until then every real-mode call
   fails cleanly: `get_status` reports `connected: false` with the error in
   `last_error`; `read_config` and `scan` return a tool error.

## The stub boundary

`transport.py` has two layers:

- **Plumbing (complete, tested with a fake port):** `SerialTransport(device, baud)`
  opens the port 8N1 with a 1 s read/write timeout for one `with` block and
  closes it even on error. `send(bytes) -> bytes` logs the exact tx bytes to
  stderr as hex *before* writing, logs the rx bytes after, and raises
  `TimeoutError` on an empty reply.
- **Frames (STUB):** `build_frame()` / `parse_frame()` raise
  `NotImplementedError("protocol frames must be filled in from the device
  manual; see README")`. The device protocol is not available in this repo.
  `get_status`, `read_config` and `scan` in `transport.py` compose the two and
  document the dict each must return once the frames exist.

Because the stub raises before anything is sent, the hex log is only exercised
by the `send()` unit test today; once frames are filled in, every real-mode
call logs tx/rx hex on the server's stderr.

## Running / tests

Claude Code starts it from the plugin's `.mcp.json` via
`uv run --with 'mcp>=1.2,<2' --with 'pyserial>=3.5,<4' python server.py`
(first run downloads the packages). Tests, from this folder:

```
uv run --with 'mcp>=1.2,<2' --with 'pyserial>=3.5,<4' python -m unittest
```

## Disabling

Remove the `scanner` entry from the plugin's `.mcp.json`, or disable it in the
`/mcp` menu. (`CLAUDE_MODS_DISABLE` is not honoured here: a stdio server that
exits at start shows as "failed to connect" rather than quietly off.)

## Terminal.app vs Ghostty

Not applicable: the server talks JSON-RPC over stdio and prints nothing to a
terminal. Packages (`mcp`, `pyserial`) are fetched by `uv`; nothing is
installed system-wide.
