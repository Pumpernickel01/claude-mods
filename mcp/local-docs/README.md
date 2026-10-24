# local-docs — MCP server over your local datasheets

Lets Claude list, search and read the documents in one folder on your Mac
(default `~/Documents/datasheets`) without pasting them into the chat.
Supported: `.pdf`, `.md`, `.markdown`, `.txt`, `.rst`, `.html`. PDF text comes
from `pdftotext -layout` (poppler); HTML is tag-stripped with the stdlib
parser. Extracted text is cached in `~/.cache/claude-mods/local-docs/` keyed by
file path and mtime, so a document is converted once.

stdio only, no network. Python via `uv run --with 'mcp>=1.10,<2'` (uv fetches
the `mcp` package into its cache on first start; nothing is installed).

## Tools

Tool names in Claude Code: `mcp__plugin_mods_local-docs__<tool>`.

| Tool | Arguments | Returns |
| :- | :- | :- |
| `list_docs` | `subdir=""` | JSON: `path`, `size`, `modified`, `pages` (PDF, via `pdfinfo`) |
| `search` | `query`, `limit=20`, `case_sensitive=false`, `regex=false` | JSON hits: `path`, `page` (PDF, 1-based, else null), `line` (within the page for PDFs), `snippet` (≤ 200 chars, match centred); `partial` is true when the 10 s / 50 MB scan budget or `limit` cut it short |
| `read_doc` | `path`, `page=null`, `start_line=1`, `max_lines=200` | text slice with a header line; PDFs by page |

A `search` hit round-trips into `read_doc(path, page=hit.page, start_line=hit.line)`.
Every result is capped at 50 KB.

Example prompts: "search my datasheets for quiescent current",
"read page 12 of the STM32 reference manual", "which docs mention I2C?".

## Configure DOCS_DIR

The plugin's `.mcp.json` passes `DOCS_DIR` as `${DOCS_DIR:-~/Documents/datasheets}`,
so either:

- export it in the shell that launches Claude Code, e.g. `export DOCS_DIR=~/hardware/docs`
  in `~/.zshrc`; or
- override the server entry in a project `.mcp.json` (project scope beats plugin
  scope) with your own `env.DOCS_DIR`.

`~` is expanded by the server. The folder is created on start if it is missing
(mode 0755; it holds non-secret documents).

## Disable

Remove (or comment out) the `local-docs` entry from the plugin's `.mcp.json`,
or disable the plugin. Adding `local-docs` to `CLAUDE_MODS_DISABLE` in
settings.json `env` also works, but the server then exits at start and `/mcp`
shows it as failed; removing the entry is the clean way.

## Requirements

- `uv` (present).
- poppler (`pdftotext`, `pdfinfo`) for PDFs: `brew install poppler`. It is
  already installed on this machine. Without it, Markdown/text/HTML work and
  PDF calls return an error telling you to install it.

## Security

- Every `path`/`subdir` is resolved with `os.path.realpath` and must stay under
  the realpath of `DOCS_DIR`; `..` components, absolute paths and symlinks that
  point outside the folder are refused with `path outside DOCS_DIR`.
- `os.walk` does not follow symlinked directories.
- Output 50 KB per call; search time-boxed to 10 s and 50 MB of text; `pdftotext`
  / `pdfinfo` run with a subprocess timeout.
- No network, no secrets read, no telemetry.

## Terminal.app vs Ghostty

n/a — the server has no terminal output.

## Tests

From this folder: `uv run --with 'mcp>=1.10,<2' python -B -m unittest`
(offline, < 5 s; builds a temp DOCS_DIR with a Markdown, text, HTML, RST file,
a hand-written two-page PDF and a symlink to `/etc/hosts`).
