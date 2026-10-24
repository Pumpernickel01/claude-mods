# db-inspector — read-only database MCP server

Lets Claude look at a project's SQLite or PostgreSQL database (tables, columns,
keys, indexes, sample rows, ad-hoc `SELECT`s) without being able to change it.

## Tools

| Tool | What it returns |
| :- | :- |
| `get_connection_info()` | engine, redacted target, how it was found, and the read-only settings read back from the live connection (`PRAGMA query_only` / `SHOW default_transaction_read_only`, `transaction_read_only`, `statement_timeout`) |
| `list_tables(schema=None)` | tables and views (`schema` is PostgreSQL-only; default: every non-system schema) |
| `describe_table(name)` | columns (type, nullable, default, pk), foreign keys, indexes, row count (exact for SQLite, `pg_class.reltuples` estimate for PostgreSQL, `-1` = never analyzed). PostgreSQL accepts `schema.table`; bare names mean `public` |
| `query(sql, max_rows=200)` | `{columns, rows, truncated, elapsed_ms}` for ONE read-only statement; `max_rows` is capped at 2000 |
| `sample_rows(table, n=20)` | first `n` rows, same shape as `query` |

Tool names inside Claude Code: `mcp__plugin_mods_db-inspector__<tool>`.

## Where the database comes from

1. `DB_INSPECTOR_URL` env var: `sqlite:///relative/or//absolute/path.db` or `postgresql://user:pass@host:5432/db`.
2. `~/.config/claude-mods/db-inspector.json`: `{"url": "postgresql://..."}`.
3. Otherwise auto-detect in the project dir (`CLAUDE_PROJECT_DIR`, else cwd):
   `*.db`, `*.sqlite`, `*.sqlite3` up to three levels deep (skipping
   `node_modules`, `.git`, `venv`, `.venv`). The shallowest file is used; all
   candidates are listed in `get_connection_info`. Files such as
   `docker-compose*.yml`, `alembic.ini`, `prisma/schema.prisma`, `knexfile.*`
   and `settings.py` are scanned for an engine keyword only, producing a hint like
   `postgresql found in docker-compose.yml; set DB_INSPECTOR_URL`.

Those two places are the ONLY sources of a connection string. By design the
server never opens `.env*` or any credentials file and never extracts a URL or
password from a config file: a credential should reach the server only because
you put it in the env var or the config file yourself.

PostgreSQL therefore always needs `DB_INSPECTOR_URL` (or the config file).
Example, in `.claude/settings.json`:

```json
{ "env": { "DB_INSPECTOR_URL": "postgresql://readonly_user:pw@localhost:5432/scanner" } }
```

Use a dedicated low-privilege PostgreSQL role for this URL: `SELECT` grants only,
no `EXECUTE` on server-side functions such as `pg_read_file`, `pg_ls_dir`,
`lo_*`, `dblink` or `pg_execute_server_program`. The layers below block such
calls by text matching, which protects against accidents and casual misuse; the
server cannot enforce privileges it does not have, so the role is the real fix.

## Read-only enforcement (two layers)

Connection layer:
- SQLite: `sqlite3.connect("file:<realpath>?mode=ro", uri=True)` plus
  `PRAGMA query_only = 1`. `mode=ro` never creates a file; a missing file is an error.
- PostgreSQL (psycopg 3): `options="-c default_transaction_read_only=on -c statement_timeout=10000"`,
  `autocommit=False`, `connection.read_only = True` (psycopg issues `BEGIN READ ONLY`),
  then `SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY`. Every query runs in
  a transaction that is always rolled back. The password is redacted from
  `get_connection_info`; a failed connection raises a fixed message with the
  redacted target and the driver exception's class name only, never the
  driver's text (which can echo the DSN).

Statement filter (applied to `query`; `sample_rows` goes through `query`):
- Comments are stripped; more than one statement (`;` outside quotes) is rejected.
- First keyword must be `SELECT`, `WITH`, `EXPLAIN`, `SHOW`, `PRAGMA` (SQLite only,
  from a short allowlist of read-only pragmas, never the `name = value` form),
  `VALUES` or `TABLE`.
- Rejected anywhere in the text (word-boundary, case-insensitive, CTEs included):
  `INSERT UPDATE DELETE DROP ALTER CREATE TRUNCATE GRANT REVOKE ATTACH DETACH VACUUM
  REINDEX COPY CALL DO MERGE REPLACE UPSERT LOCK INTO pg_sleep lo_import lo_export
  pg_read_file pg_ls_dir dblink set_config pg_terminate_backend pg_cancel_backend
  pg_reload_conf load_extension`, plus whole function families by prefix:
  `pg_read_*`, `pg_stat_file`, `pg_ls_*`, `pg_logdir_ls`, `pg_current_logfile`,
  `pg_file_*`, `lo_get/import/export/put/unlink`, `dblink*`,
  `pg_execute_server_program`, `current_setting('...password/passfile...')`.
  This is deliberately blunt: `SELECT REPLACE(name, 'a', 'b')`
  or a string literal containing `update` is rejected too. Rephrase the query.
- `LIMIT max_rows + 1` is appended when the statement has no `LIMIT`; at most
  `max_rows` rows are ever returned (default 200, hard cap 2000) and `truncated`
  says whether more existed.
- Statement timeout 10 s: `statement_timeout` for PostgreSQL, a progress-handler
  deadline (`interrupt`) for SQLite.

## Install

Plugin `.mcp.json` entry (the orchestrator merges this; see REPORT.md):

```json
{"mcpServers":{"db-inspector":{"command":"uv","args":["run","--quiet","--with","mcp>=1.2,<2","--with","psycopg[binary]>=3.1,<4","python","${CLAUDE_PLUGIN_ROOT}/mcp/db-inspector/server.py"]}}}
```

Needs `uv` on PATH (present on this machine); `mcp` and `psycopg[binary]` are
fetched into uv's cache on first start, nothing is installed system-wide.

## Disable

Remove the `db-inspector` entry from `.mcp.json`, or add `db-inspector` to
`CLAUDE_MODS_DISABLE` in settings.json `env` (the server then exits at start,
which `/mcp` shows as a failed server; removing the entry is cleaner).

## Terminal.app vs Ghostty

None: this is a stdio MCP server with no terminal output.

## Tests

```
cd mcp/db-inspector && uv run --with 'mcp>=1.2,<2' --with 'psycopg[binary]>=3.1,<4' python -m unittest -v
```

Offline, about 1 s. Covers the filter, SQLite tools, auto-detect (with an
unreadable `.env` decoy and a `node_modules` decoy), the connection-level
read-only proof (raw `INSERT`/`DROP` on the connection fails), LIMIT and cap,
the PostgreSQL kwargs builder and redaction, and a real stdio
`initialize` + `tools/list` round trip. The live PostgreSQL test runs only when
`DB_INSPECTOR_TEST_PG_URL` is set.
