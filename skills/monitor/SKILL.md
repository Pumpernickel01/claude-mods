---
name: monitor
description: open/close/toggle the live agent monitor window
disable-model-invocation: true
argument-hint: [open|close|toggle|status]
allowed-tools: Bash(${CLAUDE_PLUGIN_ROOT}/monitor/monitor.sh *)
---

Run `"${CLAUDE_PLUGIN_ROOT}/monitor/monitor.sh" $ARGUMENTS` with the Bash tool (an empty argument means `toggle`).

Report its one-line output verbatim and nothing else. If the output mentions a permission or Automation error, tell the user: on first use macOS asks whether the terminal may control "Terminal" or "Ghostty" (Automation permission); click Allow, then run `/mods:monitor` again. If `uv` is missing, say the monitor needs `uv` (`brew install uv`); its first start downloads Textual once.
