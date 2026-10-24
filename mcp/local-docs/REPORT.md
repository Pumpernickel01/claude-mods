# REPORT — mcp/local-docs

## Files created

- `mcp/local-docs/server.py` (executable) — FastMCP stdio server; Python + `mcp>=1.10,<2`
  via `uv run --with`, otherwise stdlib. Tools: `list_docs`, `search`, `read_doc`.
- `mcp/local-docs/test_server.py` — 15 `unittest` cases, offline, ~0.3 s (+ uv start-up).
- `mcp/local-docs/README.md`
- `mcp/local-docs/REPORT.md` (this file)

`lib/termcap.py` and `lib/events.py` are not used: the server has no terminal
output and nothing asked for monitor events.

## hooks.json / .mcp.json / settings.json snippets

Merge into `.mcp.json` at the plugin root (orchestrator):

```json
{
  "mcpServers": {
    "local-docs": {
      "command": "uv",
      "args": ["run", "--quiet", "--with", "mcp>=1.10,<2", "python", "${CLAUDE_PLUGIN_ROOT}/mcp/local-docs/server.py"],
      "env": {
        "DOCS_DIR": "${DOCS_DIR:-~/Documents/datasheets}"
      }
    }
  }
}
```

Checks against FORMATS.md §6:

- Hyphen in the server name: the docs' own plugin example is `database-tools`,
  and this session already has hyphenated plugin tools
  (`mcp__plugin_ecc_chrome-devtools__click`). So `local-docs` is fine; tools are
  `mcp__plugin_mods_local-docs__list_docs`, `..._search`, `..._read_doc`.
- `${VAR:-default}` expansion is documented for `env`. `~` is not expanded by
  Claude Code; the server calls `os.path.expanduser`.
- One deviation from the spec snippet: lower bound `mcp>=1.10` instead of
  `>=1.2`. The tools use `@mcp.tool(structured_output=False)` (added in mcp
  1.10) because FastMCP otherwise wraps a `str` result in an `outputSchema` and
  sends every result twice (text + `structuredContent`), doubling the 50 KB cap
  on the wire. uv resolves to the newest 1.x (1.30.0 today) either way.

No `hooks.json` or `settings.json` entries. Disable: remove the entry (see
README); `CLAUDE_MODS_DISABLE=local-docs` is also honoured (server exits 0 at
start, which `/mcp` shows as a failed server).

## Tests run

From `mcp/local-docs`: `uv run --with 'mcp>=1.10,<2' python -B -m unittest -v`

```
test_cache_file_created (test_server.LocalDocsTests.test_cache_file_created) ... ok
test_docs_dir_auto_created (test_server.LocalDocsTests.test_docs_dir_auto_created) ... ok
test_list_docs (test_server.LocalDocsTests.test_list_docs) ... ok
test_missing_file (test_server.LocalDocsTests.test_missing_file) ... ok
test_output_cap (test_server.LocalDocsTests.test_output_cap) ... ok
test_pdf_without_pdftotext (test_server.LocalDocsTests.test_pdf_without_pdftotext) ... ok
test_read_doc_html_stripped (test_server.LocalDocsTests.test_read_doc_html_stripped) ... ok
test_read_doc_pdf_pages (test_server.LocalDocsTests.test_read_doc_pdf_pages) ... ok
test_read_doc_text_and_slice (test_server.LocalDocsTests.test_read_doc_text_and_slice) ... ok
test_search_case_sensitive_regex_limit (test_server.LocalDocsTests.test_search_case_sensitive_regex_limit) ... ok
test_search_substring_case_insensitive (test_server.LocalDocsTests.test_search_substring_case_insensitive) ... ok
test_stdio_initialize_and_tools_list (test_server.LocalDocsTests.test_stdio_initialize_and_tools_list) ... ok
test_symlink_outside_refused (test_server.LocalDocsTests.test_symlink_outside_refused) ... ok
test_traversal_refused (test_server.LocalDocsTests.test_traversal_refused) ... ok
test_unsupported_extension_refused (test_server.LocalDocsTests.test_unsupported_extension_refused) ... ok

----------------------------------------------------------------------
Ran 15 tests in 0.232s

OK
exit=0
```

The suite builds a temp `DOCS_DIR` (two levels deep and absent, so the import
proves auto-creation) with a Markdown, text, HTML and RST file, a 100 KB text
file, an unsupported `.env`, a hand-written two-page PDF (xref computed) and a
symlink to `/etc/hosts`; `HOME` is pointed at a temp dir so the cache lands in
a temp `~/.cache`, not the real one. Covered: list (sizes, dates, PDF page
count, symlink excluded, subdir), search (substring, case, regex, limit, PDF
page + line), read (slice, PDF page, out-of-range page, HTML stripped),
traversal `../../etc/passwd` / `../` / absolute / `sub/../../x.md` refused with
`path outside DOCS_DIR`, the symlink refused, `read_doc("secret.env")` refused (`unsupported file type`),
the PDF-without-poppler error (pdftotext mocked away), cache file created,
50 KB cap, and a real stdio `initialize` + `tools/list` round trip.

"Both terminals" = the same suite with env overrides, not real windows (this
build session runs under `TERM_PROGRAM=herdr`); the server has no terminal
output so the result is identical:

- `TERM_PROGRAM=Apple_Terminal TERM=xterm-256color ... python -B -m unittest` → OK
- `TERM_PROGRAM=ghostty TERM=xterm-ghostty COLORTERM=truecolor ... python -B -m unittest` → OK

### Manual stdio run (initialize + tools/list)

`DOCS_DIR=<tmp> uv run --quiet --with 'mcp>=1.10,<2' python server.py`, fed
`initialize`, `notifications/initialized`, `tools/list` over stdin. The missing
`DOCS_DIR` was created. `initialize` → `"serverInfo": {"name": "local-docs", "version": "1.30.0"}`.
`tools/list` →

```json
{
 "tools": [
  {
   "name": "list_docs",
   "description": "List supported documents (.pdf .md .markdown .txt .rst .html) under DOCS_DIR or a subdir.\nReturns JSON: [{path, size, modified, pages (PDF only)}].",
   "inputSchema": {
    "properties": {"subdir": {"default": "", "title": "Subdir", "type": "string"}},
    "title": "list_docsArguments", "type": "object"
   }
  },
  {
   "name": "search",
   "description": "Search all documents for a substring (or regex if regex=true).\nReturns JSON hits: {path, page (PDF, 1-based, else null), line (1-based, within the page for PDFs), snippet}.\nScanning stops after 10 s or 50 MB of text; 'partial' is true when it did.",
   "inputSchema": {
    "properties": {
     "query": {"title": "Query", "type": "string"},
     "limit": {"default": 20, "title": "Limit", "type": "integer"},
     "case_sensitive": {"default": false, "title": "Case Sensitive", "type": "boolean"},
     "regex": {"default": false, "title": "Regex", "type": "boolean"}
    },
    "required": ["query"], "title": "searchArguments", "type": "object"
   }
  },
  {
   "name": "read_doc",
   "description": "Read a slice of a document (path relative to DOCS_DIR). PDFs: give page (1-based) to read one page;\nstart_line/max_lines slice the lines of that page (or of the whole file).",
   "inputSchema": {
    "properties": {
     "path": {"title": "Path", "type": "string"},
     "page": {"anyOf": [{"type": "integer"}, {"type": "null"}], "default": null, "title": "Page"},
     "start_line": {"default": 1, "title": "Start Line", "type": "integer"},
     "max_lines": {"default": 200, "title": "Max Lines", "type": "integer"}
    },
    "required": ["path"], "title": "read_docArguments", "type": "object"
   }
  }
 ]
}
```

Same session, `tools/call` checks: `read_doc demo.md` → one text content block,
`isError: false`, no `structuredContent`; `read_doc ../../etc/passwd` →
`{"content":[{"type":"text","text":"Error executing tool read_doc: path outside DOCS_DIR"}],"isError":true}`;
`search quiescent` and `list_docs` returned the expected JSON; server exit 0.

## Needs from user

none. poppler (`pdftotext`/`pdfinfo` 26.10.0) and `uv` 0.13.5 are already on
this Mac. On a machine without poppler: `brew install poppler` for PDFs
(Markdown/text/HTML work without it; PDF calls return an error saying so).
First start downloads the `mcp` package into uv's cache (network once).

## Terminal.app vs Ghostty differences

n/a — no terminal output.

## Known limitations

- Cache files (`~/.cache/claude-mods/local-docs/<sha1>-<mtime>.txt`) accumulate
  as documents change; nothing prunes them.
- No index: every `search` re-reads the (cached) text of every document; the
  first search over many large PDFs runs `pdftotext` for each and may stop at
  the 10 s budget with `partial: true` — the next search is fast.
- The 10 s / 50 MB budget is checked between files and lines; a user regex that
  is slow on one very long line is not interrupted.
- `list_docs` runs one `pdfinfo` per PDF (fine for hundreds, slow for thousands).
- PDFs without a text layer (scans) extract to empty text; no OCR.
- HTML stripping is basic (tags removed, `script`/`style` dropped, block tags
  become newlines).
- `read_doc` on a PDF without `page` joins all pages; line numbers are then
  document-wide and do not match `search` hits (which are per page).
- Hand-rolled stdio drivers that close stdin immediately after writing lose
  in-flight requests (MCP cancels handlers on EOF); Claude Code keeps stdin open,
  and the unit test reads the answers before closing.

## Security notes

- `_resolve()` rejects absolute paths and any `..` component before resolution,
  then requires `os.path.realpath(path)` to start with `realpath(DOCS_DIR) + os.sep`
  → symlinks pointing outside are refused; `os.walk(followlinks=False)` plus the
  same realpath check on each file keep them out of listings and searches.
- `read_doc` applies the same extension allowlist as listing/search, so `.env`,
  `.pem`, `.key` or binaries inside `DOCS_DIR` are never returned.
- Subprocesses (`pdftotext`, `pdfinfo`) use list arguments and timeouts; no shell.
- 50 KB per result; no network; no secrets read; `DOCS_DIR` created 0755 (non-secret docs).
