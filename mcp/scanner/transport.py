"""Serial transport for the scanner (real mode only).

Plumbing (open/close, timeouts, hex logging) is complete. The frame layer
below the STUB line is not: the device protocol is not available here, so
build_frame/parse_frame raise NotImplementedError until filled in from the
device manual (see README.md).
"""
import sys

import serial

STUB_MESSAGE = "protocol frames must be filled in from the device manual; see README"
READ_TIMEOUT_S = 1


class SerialTransport:
    """8N1 serial link, opened for the duration of one `with` block."""

    def __init__(self, device: str, baud: int):
        self.device = device
        self.baud = baud
        self._port = None

    def __enter__(self):
        self._port = serial.Serial(
            self.device,
            self.baud,
            bytesize=serial.EIGHTBITS,
            parity=serial.PARITY_NONE,
            stopbits=serial.STOPBITS_ONE,
            timeout=READ_TIMEOUT_S,
            write_timeout=READ_TIMEOUT_S,
        )
        return self

    def __exit__(self, *exc):
        self._port.close()
        self._port = None

    def send(self, data: bytes) -> bytes:
        """Write one frame and return the reply. Logs tx before writing, rx after."""
        print(f"scanner tx {self.device}: {data.hex(' ')}", file=sys.stderr, flush=True)
        self._port.write(data)
        # shortcut: reads up to 256 bytes or READ_TIMEOUT_S, replace with the
        # manual's length-prefixed read once the frame format is known
        reply = self._port.read(256)
        print(f"scanner rx {self.device}: {reply.hex(' ')}", file=sys.stderr, flush=True)
        if not reply:
            raise TimeoutError(f"no reply from {self.device} within {READ_TIMEOUT_S} s")
        return reply


# ---------------------------------------------------------------------------
# STUB: frame layer. Fill in from the device manual. Nothing below is real.
# ---------------------------------------------------------------------------
def build_frame(command: str, **params) -> bytes:
    raise NotImplementedError(STUB_MESSAGE)


def parse_frame(raw: bytes) -> dict:
    raise NotImplementedError(STUB_MESSAGE)


def get_status(t: SerialTransport) -> dict:
    """Must return {"firmware": str, "battery_pct": int | None}."""
    return parse_frame(t.send(build_frame("status")))


def read_config(t: SerialTransport) -> dict:
    """Must return {power_dbm, region, session, antenna_ports, trigger_mode, output_format}."""
    return parse_frame(t.send(build_frame("read_config")))


def scan(t: SerialTransport, duration_ms: int, max_tags: int) -> dict:
    """Must return {"tags": [{epc, rssi, antenna, count, first_seen_ms}, ...]}."""
    return parse_frame(t.send(build_frame("inventory", duration_ms=duration_ms, max_tags=max_tags)))
