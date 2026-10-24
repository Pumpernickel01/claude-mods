# REPORT — mcp/scanner

## Files created
- `mcp/scanner/server.py` (executable) — FastMCP server `scanner`, tools `get_status`, `read_config`, `scan`; mock by default, real mode gated on env + config file.
- `mcp/scanner/transport.py` — `SerialTransport` plumbing (8N1, 1 s timeouts, per-call open/close, hex tx/rx logging to stderr) and the STUB frame layer that raises `NotImplementedError("protocol frames must be filled in from the device manual; see README")`.
- `mcp/scanner/test_server.py` — 8 stdlib unittest cases incl. a `FakeSerial` and a stdio JSON-RPC subprocess round-trip (10 s timeout).
- `mcp/scanner/README.md`, `mcp/scanner/REPORT.md`.

## hooks.json / .mcp.json / settings.json snippets
`.mcp.json` (plugin root, orchestrator merges):
```json
{"mcpServers":{"scanner":{"command":"uv","args":["run","--quiet","--with","mcp>=1.2,<2","--with","pyserial>=3.5,<4","python","${CLAUDE_PLUGIN_ROOT}/mcp/scanner/server.py"]}}}
```
Real mode additionally needs `"env": {"SCANNER_MCP_REAL": "1"}` on that entry (or in the launching shell) AND `~/.config/claude-mods/scanner.json` = `{"device": "/dev/cu.usbserial-XXXX", "baud": 115200}`. No hooks.json or settings.json entries.

## Tests run
From `mcp/scanner/`: `uv run --with 'mcp>=1.2,<2' --with 'pyserial>=3.5,<4' python -m unittest -v`
(resolved mcp 1.30.0, pyserial 3.5; uv-managed Python 3.13; first run downloads packages)
```
test_mock_by_default (test_server.MockMode.test_mock_by_default) ... ok
test_real_env_without_config_stays_mock (test_server.MockMode.test_real_env_without_config_stays_mock) ... ok
test_scan_caps_and_shape (test_server.MockMode.test_scan_caps_and_shape) ... ok
test_tool_names (test_server.MockMode.test_tool_names) ... ok
test_send_logs_hex_and_times_out (test_server.RealModePlumbing.test_send_logs_hex_and_times_out) ... ok
test_status_reports_stub_error_and_closes_port (test_server.RealModePlumbing.test_status_reports_stub_error_and_closes_port) ... ok
test_stub_surfaces_as_tool_error (test_server.RealModePlumbing.test_stub_surfaces_as_tool_error) ... ok
test_initialize_and_tools_list (test_server.Stdio.test_initialize_and_tools_list) ... ok

Ran 8 tests in 0.201s
OK
```
Hand-written JSON-RPC `initialize` + `notifications/initialized` + `tools/list` over stdio (python subprocess, 10 s timeout, `SCANNER_MCP_REAL` unset):
```
initialize -> {"name": "scanner", "version": "1.30.0"}
tools/list -> [
 {"name": "get_status",  "description": "Reader status. mode is \"mock\" unless real mode is fully enabled; then `reason` says what is missing. In real mode a failed device query is reported in last_error instead of raising."},
 {"name": "read_config", "description": "Current reader settings (read-only; there is no set_config)."},
 {"name": "scan",        "description": "Inventory tags for duration_ms (capped at 10000) returning at most max_tags.", "inputSchema.properties": ["duration_ms", "max_tags"]}
]
```
Env overrides: none needed (no terminal output). Real hardware was never touched; real-mode paths were exercised only against `FakeSerial`.

## Needs from user
- To leave mock mode: the device manual's frame format, filled into `transport.build_frame` / `parse_frame` (and the three ops' return dicts), plus the config file and `SCANNER_MCP_REAL=1` above.
- Nothing to install: `uv` fetches `mcp` and `pyserial` into its cache on first start.

## Terminal.app vs Ghostty differences
Not applicable: stdio JSON-RPC server, no terminal output.

## Known limitations
- Frame layer is a stub; until filled in, real mode's `get_status` returns `connected: false` + `last_error`, and `read_config`/`scan` return a tool error. The "log bytes before sending" path lives in `SerialTransport.send()` and is reached only once frames exist (unit-tested directly today).
- `send()` reads up to 256 bytes or 1 s (marked `shortcut:` in code); replace with the manual's length-prefixed read.
- `CLAUDE_MODS_DISABLE` convention deliberately NOT applied: a stdio server that exits at startup shows as "failed to connect" in `/mcp`; the task spec names "remove from .mcp.json or `/mcp` disable" instead. Orchestrator may rule otherwise.
- No `lib/events` emission and no `set_config` (neither asked for). Mock `scan` returns instantly (does not sleep for `duration_ms`).
- Mock `read_config` and `scan` carry a `mode` field beyond the spec'd keys so every tool "says so" per SECURITY.md.

## Security notes
Least privilege per SECURITY.md §1: two gates (env + config file) before any port is opened, device path explicit, read-only tool set, no network, no secrets read.
