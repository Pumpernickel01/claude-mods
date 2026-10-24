#!/bin/bash
# Shared append-only event log (bash wrapper around events.py). Owned by Agent 22.
#   . "$ROOT/lib/events.sh"
#   emit_event "<event>" "<status>" ['{"extra":"json"}']   # reads hook stdin JSON from $HOOK_INPUT if set
# Never fails the caller.
_EVENTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
emit_event() {
  printf '%s' "${HOOK_INPUT:-}" | python3 "$_EVENTS_DIR/events.py" "$1" "${2:-running}" "${3:-{\}}" 2>/dev/null || true
}
