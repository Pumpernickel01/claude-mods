# REPORT — mcp/db-inspector

## Files created
- `mcp/db-inspector/server.py` (executable) — FastMCP stdio server, SQLite + PostgreSQL, read-only at the connection and by statement filter.
- `mcp/db-inspector/test_server.py` (executable) — unittest suite, offline, ~1 s (16 tests, live-PG one skipped).
- `mcp/db-inspector/README.md`
- `mcp/db-inspector/REPORT.md`

## hooks.json / .mcp.json / settings.json snippets
`.mcp.json` (plugin root; server name `db-inspector` — hyphens are fine, FORMATS.md §6's own plugin example is `database-tools`):
```json
{"mcpServers":{"db-inspector":{"command":"uv","args":["run","--quiet","--with","mcp>=1.2,<2","--with","psycopg[binary]>=3.1,<4","python","${CLAUDE_PLUGIN_ROOT}/mcp/db-inspector/server.py"]}}}
```
Tools appear as `mcp__plugin_mods_db-inspector__{get_connection_info,list_tables,describe_table,query,sample_rows}`.
No hooks.json entry. Optional settings.json `env` for PostgreSQL users: `"DB_INSPECTOR_URL": "postgresql://user:pw@host:5432/db"`.

## Tests run
Command (from `mcp/db-inspector`):
```
uv run --quiet --with 'mcp>=1.2,<2' --with 'psycopg[binary]>=3.1,<4' python -m unittest -v
```
Output:
```
test_allows (test_server.Filter.test_allows) ... ok
test_limit_appended_only_when_missing_and_limitable (test_server.Filter.test_limit_appended_only_when_missing_and_limitable) ... ok
test_pragma_rejected_on_pg (test_server.Filter.test_pragma_rejected_on_pg) ... ok
test_rejects (test_server.Filter.test_rejects) ... ok
test_connection_error_never_echoes_dsn (test_server.Postgres.test_connection_error_never_echoes_dsn) ... ok
test_kwargs_builder (test_server.Postgres.test_kwargs_builder) ... ok
test_live (test_server.Postgres.test_live) ... skipped 'DB_INSPECTOR_TEST_PG_URL not set'
test_redact (test_server.Postgres.test_redact) ... ok
test_autodetect_finds_db_skips_env_and_node_modules (test_server.Sqlite.test_autodetect_finds_db_skips_env_and_node_modules) ... ok
test_connection_is_read_only_even_without_filter (test_server.Sqlite.test_connection_is_read_only_even_without_filter) ... ok
test_explicit_url_and_missing_file (test_server.Sqlite.test_explicit_url_and_missing_file) ... ok
test_filter_rejects_writes (test_server.Sqlite.test_filter_rejects_writes) ... ok
test_limit_and_cap (test_server.Sqlite.test_limit_and_cap) ... ok
test_list_describe_sample_query (test_server.Sqlite.test_list_describe_sample_query) ... ok
test_no_db_found_message (test_server.Sqlite.test_no_db_found_message) ... ok
test_stdio_initialize_and_tools_list (test_server.Sqlite.test_stdio_initialize_and_tools_list) ... ok

----------------------------------------------------------------------
Ran 16 tests in 0.292s

OK (skipped=1)
```
No terminal env overrides apply (stdio server, no terminal output).

Stdio smoke run (three JSON-RPC lines piped into `uv run ... python server.py` from an empty directory, so no database is present — tool listing must not depend on a connection):
```
initialize -> {"name": "db-inspector", "version": "1.30.0"}
tools/list ->
  get_connection_info()  Engine, redacted target, how it was found, and read-only settings read back from the live connection.
  list_tables(schema)  List tables and views. `schema` applies to PostgreSQL only (default: all user schemas).
  describe_table(name)  Columns (type, nullable, default, pk), foreign keys, indexes and approximate row count. PostgreSQL: `schema.table` or bare name (public).
  query(sql, max_rows)  Run ONE read-only SELECT/WITH/EXPLAIN/SHOW/PRAGMA/VALUES statement. LIMIT is added when missing; max_rows caps at 2000.
  sample_rows(table, n)  First n rows of a table (same result shape as `query`).
```

## Needs from user
- `DB_INSPECTOR_URL` (or `~/.config/claude-mods/db-inspector.json` `{"url": "..."}`) for PostgreSQL; the server never reads `.env*` or parses credentials out of docker-compose/alembic/settings files, by design. It only reports e.g. "postgresql found in docker-compose.yml; set DB_INSPECTOR_URL".
- Nothing to install: `uv` is present; `mcp` and `psycopg[binary]` are fetched into uv's cache on first start.
- Optional: set `DB_INSPECTOR_TEST_PG_URL` to a scratch PostgreSQL to run the live test (not run here; no PostgreSQL server on this Mac).

## Terminal.app vs Ghostty differences
None (no terminal output).

## Known limitations
- Live PostgreSQL path (connect kwargs, `SET SESSION CHARACTERISTICS`, `SHOW` read-backs, `describe_table` catalog queries) is unit-tested for the kwargs builder and redaction only; it has not run against a real server here. Verified offline that psycopg3 passes a parameter-less query (so `LIKE '%x%'` is not parsed as a placeholder) and that `connect_timeout=5` is in the kwargs.
- Blocklist is text-based and blunt: `REPLACE(...)` the string function, `DO` or `INTO` inside a string literal etc. are rejected (false positives, never false negatives). Keywords inside string literals are also matched. A table literally named `do`, `lock`, `copy` or `call` cannot be sampled via `sample_rows` for the same reason.
- A `;` inside PostgreSQL dollar-quoting (`$$...$$`) is counted as a statement separator and rejected (conservative).
- `LIMIT max_rows + 1` is appended (not exactly `LIMIT max_rows`) so `truncated` can be true when more rows exist; the returned row count is still capped at `max_rows`.
- PostgreSQL `row_count_approx` is `pg_class.reltuples`: `-1` on PG 14+ for a table that was never analyzed.
- SQLite auto-detect picks the shallowest `*.db|*.sqlite|*.sqlite3` when several exist; the others are listed as `candidates`. Non-SQLite files with those extensions fail on first query ("file is not a database").
- One connection per tool call (simple and thread-safe; a PostgreSQL round trip costs a connect per call).
- `CLAUDE_MODS_DISABLE` makes the server exit at start, which `/mcp` shows as a failed server; removing the `.mcp.json` entry is the cleaner way to disable.

## Security notes
- Connection strings only from `DB_INSPECTOR_URL` or the config file. `.env*` never opened (test: `.env` decoy with mode 000 — any open() would raise — plus assertion that its content never appears in output).
- Password redacted in `get_connection_info`. A failed PostgreSQL connection raises a fixed message `connection to <redacted url> failed: <ExceptionClass>` with no chained cause, so the driver's text (which can echo the DSN) is never surfaced (test: refused connection to `localhost:1`, message contains neither password nor raw DSN).
- Besides the keyword list, whole function FAMILIES are rejected by prefix (`pg_read_*`, `pg_stat_file`, `pg_ls_*`, `pg_logdir_ls`, `pg_current_logfile`, `pg_file_*`, `lo_get/import/export/put/unlink`, `dblink*`, `pg_execute_server_program`, `pg_reload_conf`, `set_config`, `current_setting('..password|passfile..')`), also inside CTEs/subqueries (tests: `pg_read_binary_file` in a CTE, `pg_ls_waldir()` in a subquery, `lo_get`, `pg_stat_file`, `pg_execute_server_program`). Text matching cannot replace privileges: README tells the user to use a dedicated low-privilege role (SELECT grants only, no EXECUTE on those functions).
- Table names used in `describe_table`/`sample_rows` are checked against the catalog before being quoted into SQL.
- Both read-only layers are tested: the filter (rejects `INSERT`, `DELETE`, `SELECT 1; DROP TABLE t`, `WITH x AS (DELETE ...)`, `PRAGMA writable_schema=1`, `ATTACH DATABASE`, `PRAGMA journal_mode(wal)`, `SELECT ... INTO`, `set_config`, ...) and the connection (raw `INSERT`/`DELETE`/`DROP`/`CREATE`/`writable_schema`+`UPDATE sqlite_master` on the connection all fail with "attempt to write a readonly database").
