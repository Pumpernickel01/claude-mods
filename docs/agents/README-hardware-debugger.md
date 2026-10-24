# hardware-debugger (agent)

A read-only field guide, packaged as a Claude Code subagent, for debugging serial and USB devices on
macOS: barcode scanners, RFID readers, microcontrollers (Arduino, ESP32, Pico) and USB-serial adapters
(FTDI, CP210x, CH34x, PL2303, CDC-ACM). It enumerates ports and USB devices, reads the unified log for
enumeration/reset/power problems, reasons about baud, framing, flow control, DTR resets and timing, and
returns a device table, log excerpts, ranked hypotheses and a next experiment.

## How to use

Ask Claude to debug a device ("my scanner stopped showing up", "garbage on /dev/cu.usbserial-1420",
"why does the reader miss every third tag") and it delegates to `mods:hardware-debugger`. Direct
invocation: `@agent-mods:hardware-debugger <question>`, or from another agent via the `Agent` tool with
`subagent_type: "mods:hardware-debugger"`.

Tools: `Read, Glob, Grep, Bash`. Everything it runs is read-only (`ls`, `ioreg`, `system_profiler`,
`stty -f`, `/usr/bin/log show`, a bounded pyserial read loop). Before it sends a single byte to a device
it prints the exact bytes and asks you to confirm. It never uses `sudo`, never touches `/dev/disk*`,
never loads or unloads drivers, and only flashes firmware when you ask and name the file.

Interactive terminals (`screen`, `miniterm`, `cu`) hang inside Claude's non-interactive Bash tool, so the
agent tells you the exact command to run in your own terminal and how to quit it, and does its own
captures with a time-bounded Python snippet.

## Requirements

- macOS (tested on macOS 26.6 / Claude Code 2.1.310). Linux hints are included but not the focus.
- `python3` with `pyserial` for the sniffer and `list_ports` (`python3 -c 'import serial'` to check).
  Without it the agent falls back to `uv run --with 'pyserial>=3.5,<4'`; nothing is installed system-wide.
- Optional: `ts` from moreutils (`brew install moreutils`) for timestamped `cat` output; the agent uses
  Python timestamps when it is missing.
- No macOS permissions needed: serial nodes are world-readable and `ioreg`/`system_profiler`/`log show`
  run as the user. Third-party DriverKit drivers need approval in System Settings > Privacy & Security;
  the agent tells you when that is the blocker but never changes it.

## Disable

Agents are static Markdown with no script, so the `CLAUDE_MODS_DISABLE` env convention cannot apply.
Remove or rename `agents/hardware-debugger.md` and run `/reload-plugins`, or disable the whole plugin
with `claude plugin disable mods`.

## Terminal.app vs Ghostty

No difference: the agent produces plain text and runs no terminal-specific escape codes. The interactive
tools it hands you (`screen`, `miniterm`, `cu`) behave the same in both terminals.
