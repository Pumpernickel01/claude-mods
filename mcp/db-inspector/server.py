#!/usr/bin/env python3
"""db-inspector: read-only MCP server for SQLite and PostgreSQL.

Read-only is enforced twice: at the connection (SQLite ?mode=ro + query_only,
PostgreSQL default_transaction_read_only + read-only session, every query rolled
back) and by a statement filter that only lets SELECT-shaped statements through.
Connection strings come ONLY from DB_INSPECTOR_URL or
~/.config/claude-mods/db-inspector.json; .env files are never read.
"""
import json
import os
import re
import sqlite3
import sys
import time
import urllib.parse

from mcp.server.fastmcp import FastMCP

if "db-inspector" in os.environ.get("CLAUDE_MODS_DISABLE", "").split(","):
    sys.exit(0)

mcp = FastMCP("db-inspector")

TIMEOUT_S = 10
MAX_ROWS_CAP = 2000
CONFIG_FILE = "~/.config/claude-mods/db-inspector.json"
SKIP_DIRS = {"node_modules", ".git", "venv", ".venv"}
SQLITE_EXT = (".db", ".sqlite", ".sqlite3")
HINT_FILES = re.compile(r"^(docker-compose.*\.ya?ml|compose\.ya?ml|alembic\.ini|schema\.prisma|knexfile\..*|settings\.py)$")

ALLOWED_FIRST = {"SELECT", "WITH", "EXPLAIN", "SHOW", "PRAGMA", "VALUES", "TABLE"}
LIMITABLE = {"SELECT", "WITH", "VALUES", "TABLE"}
BLOCKED = re.compile(
    r"\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|ATTACH|DETACH"
    r"|VACUUM|REINDEX|COPY|CALL|DO|MERGE|REPLACE|UPSERT|LOCK|INTO"
    r"|pg_sleep|lo_import|lo_export|pg_read_file|pg_ls_dir|dblink"
    r"|set_config|pg_terminate_backend|pg_cancel_backend|pg_reload_conf|load_extension)\b",
    re.I,
)
# Identifier FAMILIES (prefix match), so a renamed/sibling function cannot slip past the keyword list.
BLOCKED_FAMILIES = re.compile(
    r"\b(pg_read_|pg_stat_file|pg_ls_|pg_logdir_ls|pg_current_logfile|pg_file_|lo_(get|import|export|put|unlink)"
    r"|dblink|pg_execute_server_program|pg_reload_conf|set_config|current_setting\s*\(\s*'[^']*(password|passfile))",
    re.I,
)
# Read-only pragmas; the setter form (PRAGMA x = v) is rejected regardless of name.
PRAGMA_OK = {
    "table_info", "table_xinfo", "table_list", "index_list", "index_info", "index_xinfo",
    "foreign_key_list", "foreign_key_check", "integrity_check", "quick_check",
    "database_list", "collation_list", "compile_options", "function_list", "module_list",
    "pragma_list", "page_size", "page_count", "freelist_count", "journal_mode",
    "schema_version", "user_version", "application_id", "encoding", "auto_vacuum",
    "query_only", "foreign_keys",
}


# ---------------------------------------------------------------- statement filter
def strip_comments(sql):
    """Return (sql without comments, number of ';' outside quotes)."""
    out, i, n, semis = [], 0, len(sql), 0
    while i < n:
        c = sql[i]
        if c in "'\"":
            j = sql.find(c, i + 1)
            while j != -1 and sql[j + 1:j + 2] == c:  # doubled quote escapes
                j = sql.find(c, j + 2)
            j = n if j == -1 else j + 1
            out.append(sql[i:j])
            i = j
        elif sql.startswith("--", i):
            j = sql.find("\n", i)
            i = n if j == -1 else j
        elif sql.startswith("/*", i):
            j = sql.find("*/", i + 2)
            i = n if j == -1 else j + 2
            out.append(" ")
        else:
            if c == ";":
                semis += 1
            out.append(c)
            i += 1
    return "".join(out), semis


def check_sql(sql, engine):
    """Return the cleaned statement (no trailing ';') or raise ValueError."""
    clean, semis = strip_comments(sql)
    clean = clean.strip()
    if clean.endswith(";"):
        clean, semis = clean[:-1].rstrip(), semis - 1
    if not clean:
        raise ValueError("empty statement")
    if semis:
        raise ValueError("only one statement per call (';' found)")
    first = re.match(r"[A-Za-z]+", clean)
    first = first.group(0).upper() if first else ""
    if first not in ALLOWED_FIRST:
        raise ValueError(f"statement must start with one of {sorted(ALLOWED_FIRST)}, got {first or clean[:20]!r}")
    m = BLOCKED.search(clean) or BLOCKED_FAMILIES.search(clean)
    if m:
        raise ValueError(f"read-only: {m.group(0).strip()!r} is not allowed")
    if first == "PRAGMA":
        pm = re.match(r"PRAGMA\s+(?:\w+\.)?(\w+)\s*(\(|=|$)", clean, re.I | re.S)
        name = pm.group(1).lower() if pm else ""
        # the (arg) form is read-only only for the *_info/_list/_check family; journal_mode(wal) is a setter
        if engine != "sqlite" or not pm or pm.group(2) == "=" or name not in PRAGMA_OK \
                or (pm.group(2) == "(" and not name.endswith(("_info", "_xinfo", "_list", "_check"))):
            raise ValueError("only read-only SQLite pragmas are allowed: " + ", ".join(sorted(PRAGMA_OK)))
    return clean, first


def prepare(sql, engine, max_rows):
    """Filter the statement and append LIMIT when the shape allows it."""
    clean, first = check_sql(sql, engine)
    if first in LIMITABLE and not re.search(r"\bLIMIT\b", clean, re.I):
        clean += f" LIMIT {max_rows + 1}"  # one extra row so `truncated` can be reported honestly
    return clean


# ---------------------------------------------------------------- config / detection
def redact(url):
    p = urllib.parse.urlsplit(url)
    netloc = re.sub(r":[^@]*@", ":***@", p.netloc)
    q = [(k, "***" if k.lower() == "password" else v) for k, v in urllib.parse.parse_qsl(p.query)]
    return urllib.parse.urlunsplit((p.scheme, netloc, p.path, urllib.parse.urlencode(q), p.fragment))


def project_dir():
    return os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()


def detect(root):
    """Walk root (depth <= 3) for SQLite files and engine hints. Never opens .env*."""
    dbs, hints = [], []
    root = os.path.realpath(root)
    for cur, dirs, files in os.walk(root):
        depth = cur[len(root):].count(os.sep)
        dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS and depth < 3)
        for f in sorted(files):
            path = os.path.join(cur, f)
            rel = os.path.relpath(path, root)
            if f.lower().endswith(SQLITE_EXT):
                dbs.append(rel)
            elif HINT_FILES.match(f) and (f != "schema.prisma" or os.path.basename(cur) == "prisma"):
                try:
                    with open(path, "r", errors="replace") as fh:
                        text = fh.read(65536).lower()
                except OSError:
                    continue
                engine = "postgresql" if "postgres" in text else "sqlite" if "sqlite" in text else "unknown"
                hints.append(f"{engine} found in {rel}; set DB_INSPECTOR_URL")
    dbs.sort(key=lambda r: (r.count(os.sep), r))
    return dbs, hints


def resolve():
    """Return {engine, url|path, source, candidates, hints}; engine None when nothing found."""
    url, source = os.environ.get("DB_INSPECTOR_URL"), "env DB_INSPECTOR_URL"
    if not url:
        try:
            with open(os.path.expanduser(CONFIG_FILE)) as fh:
                url, source = json.load(fh).get("url"), CONFIG_FILE
        except (OSError, ValueError):
            pass
    info = {"source": source, "candidates": [], "hints": []}
    if not url:
        dbs, hints = detect(project_dir())
        info.update(source="auto-detect", candidates=dbs, hints=hints)
        if not dbs:
            info["engine"] = None
            return info
        url = "sqlite:///" + os.path.join(project_dir(), dbs[0])
    scheme = url.split(":", 1)[0].lower()
    if scheme == "sqlite":
        path = url[len("sqlite://"):]
        if path.startswith("/"):
            path = path[1:]  # sqlite:///rel  vs  sqlite:////abs  (SQLAlchemy form)
        path = os.path.realpath(os.path.join(project_dir(), path))
        info.update(engine="sqlite", path=path, target=path)
    elif scheme in ("postgresql", "postgres"):
        info.update(engine="postgresql", url=url, target=redact(url))
    else:
        raise ValueError(f"unsupported URL scheme {scheme!r}; use sqlite:///path or postgresql://...")
    return info


# ---------------------------------------------------------------- connections
def connect_sqlite(path):
    if not os.path.isfile(path):
        raise FileNotFoundError(f"SQLite file not found: {path}")
    uri = "file:" + urllib.parse.quote(path) + "?mode=ro"
    conn = sqlite3.connect(uri, uri=True, check_same_thread=False)
    conn.execute("PRAGMA query_only = 1")
    deadline = time.monotonic() + TIMEOUT_S
    conn.set_progress_handler(lambda: time.monotonic() > deadline, 1000)
    return conn


def pg_connect_kwargs(url):
    return {
        "conninfo": url,
        "autocommit": False,
        "connect_timeout": 5,  # an unreachable host must not hang the tool call for the OS TCP timeout
        "options": f"-c default_transaction_read_only=on -c statement_timeout={TIMEOUT_S * 1000}",
    }


def connect_pg(url):
    import psycopg  # lazy so the SQLite path works without it

    try:
        conn = psycopg.connect(**pg_connect_kwargs(url))
    except Exception as e:  # driver text can echo the DSN: fixed message, class name only, no chained cause
        raise ConnectionError(f"connection to {redact(url)} failed: {type(e).__name__}") from None
    conn.read_only = True
    conn.execute("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY")
    conn.commit()
    return conn


def connect(info=None):
    info = info or resolve()
    if info["engine"] is None:
        raise RuntimeError("no database found; set DB_INSPECTOR_URL (sqlite:///path or postgresql://...). "
                           + " ".join(info["hints"]))
    if info["engine"] == "sqlite":
        return info, connect_sqlite(info["path"])
    return info, connect_pg(info["url"])


def run(conn, sql, params=(), max_rows=MAX_ROWS_CAP):
    """Execute inside a transaction that is always rolled back; return (columns, rows, truncated)."""
    try:
        cur = conn.execute(sql, params) if params else conn.execute(sql)  # psycopg parses %s only when params are given
        cols = [d[0] for d in cur.description] if cur.description else []
        rows = cur.fetchmany(max_rows + 1) if cur.description else []
    except sqlite3.OperationalError as e:
        raise RuntimeError(f"query interrupted after {TIMEOUT_S}s" if "interrupt" in str(e) else str(e)) from e
    finally:
        conn.rollback()
    return cols, [[v if isinstance(v, (int, float, str, bool, type(None))) else str(v) for v in r]
                  for r in rows[:max_rows]], len(rows) > max_rows


def qident(name):
    return ".".join('"' + part.replace('"', '""') + '"' for part in name.split("."))


def split_name(info, name):
    if info["engine"] == "sqlite" or "." not in name:
        return "public", name
    return name.split(".", 1)


# ---------------------------------------------------------------- tools
@mcp.tool()
def get_connection_info() -> dict:
    """Engine, redacted target, how it was found, and read-only settings read back from the live connection."""
    info = resolve()
    if info["engine"] is None:
        info["message"] = "no database found; set DB_INSPECTOR_URL (sqlite:///path or postgresql://...)"
        return info
    _, conn = connect(info)
    try:
        if info["engine"] == "sqlite":
            proofs = {"uri_mode": "ro", "query_only": conn.execute("PRAGMA query_only").fetchone()[0]}
        else:
            proofs = {g: run(conn, f"SHOW {g}")[1][0][0]
                      for g in ("default_transaction_read_only", "transaction_read_only", "statement_timeout")}
    finally:
        conn.close()
    return {k: v for k, v in info.items() if k not in ("url", "path")} | {"read_only": proofs}


@mcp.tool()
def list_tables(schema: str | None = None) -> list:
    """List tables and views. `schema` applies to PostgreSQL only (default: all user schemas)."""
    info, conn = connect()
    try:
        if info["engine"] == "sqlite":
            _, rows, _ = run(conn, "SELECT name, type FROM sqlite_master WHERE type IN ('table','view') "
                                   "AND name NOT LIKE 'sqlite_%' ORDER BY name")
            return [{"name": n, "type": t} for n, t in rows]
        sql = ("SELECT table_schema, table_name, table_type FROM information_schema.tables "
               "WHERE table_schema NOT IN ('pg_catalog','information_schema')")
        _, rows, _ = run(conn, sql + (" AND table_schema = %s" if schema else "") + " ORDER BY 1, 2",
                         (schema,) if schema else ())
        return [{"schema": s, "name": n, "type": t} for s, n, t in rows]
    finally:
        conn.close()


def _require_table(info, conn, name):
    """Trust boundary: a table name is interpolated into SQL only if the catalog lists it."""
    schema, table = split_name(info, name)
    if info["engine"] == "sqlite":
        _, rows, _ = run(conn, "SELECT 1 FROM sqlite_master WHERE type IN ('table','view') AND name = ?", (table,))
    else:
        _, rows, _ = run(conn, "SELECT 1 FROM information_schema.tables WHERE table_schema = %s AND table_name = %s",
                         (schema, table))
    if not rows:
        raise ValueError(f"unknown table {name!r}")
    return schema, table


@mcp.tool()
def describe_table(name: str) -> dict:
    """Columns (type, nullable, default, pk), foreign keys, indexes and approximate row count. PostgreSQL: `schema.table` or bare name (public)."""
    info, conn = connect()
    try:
        schema, table = _require_table(info, conn, name)
        if info["engine"] == "sqlite":
            q = qident(table)
            _, cols, _ = run(conn, f"PRAGMA table_info({q})")
            _, fks, _ = run(conn, f"PRAGMA foreign_key_list({q})")
            _, idx, _ = run(conn, f"PRAGMA index_list({q})")
            indexes = [{"name": i[1], "unique": bool(i[2]),
                        "columns": [c[2] for c in run(conn, f"PRAGMA index_info({qident(i[1])})")[1]]} for i in idx]
            return {
                "table": table,
                "columns": [{"name": c[1], "type": c[2], "nullable": not c[3], "default": c[4], "pk": bool(c[5])} for c in cols],
                "foreign_keys": [{"column": f[3], "ref_table": f[2], "ref_column": f[4]} for f in fks],
                "indexes": indexes,
                "row_count": run(conn, f"SELECT COUNT(*) FROM {q}")[1][0][0],
            }
        _, cols, _ = run(conn, """
            SELECT c.column_name, c.data_type, c.is_nullable = 'YES', c.column_default,
                   EXISTS (SELECT 1 FROM information_schema.table_constraints tc
                           JOIN information_schema.key_column_usage k USING (constraint_schema, constraint_name)
                           WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = c.table_schema
                             AND tc.table_name = c.table_name AND k.column_name = c.column_name)
            FROM information_schema.columns c WHERE c.table_schema = %s AND c.table_name = %s
            ORDER BY c.ordinal_position""", (schema, table))
        _, fks, _ = run(conn, """
            SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
            WHERE contype = 'f' AND conrelid = format('%%I.%%I', %s::text, %s::text)::regclass""", (schema, table))
        _, idx, _ = run(conn, "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = %s AND tablename = %s",
                        (schema, table))
        _, cnt, _ = run(conn, "SELECT reltuples::bigint FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
                              "WHERE n.nspname = %s AND c.relname = %s", (schema, table))
        return {
            "table": f"{schema}.{table}",
            "columns": [{"name": c[0], "type": c[1], "nullable": c[2], "default": c[3], "pk": c[4]} for c in cols],
            "foreign_keys": [{"name": f[0], "definition": f[1]} for f in fks],
            "indexes": [{"name": i[0], "definition": i[1]} for i in idx],
            "row_count_approx": cnt[0][0] if cnt else None,
        }
    finally:
        conn.close()


@mcp.tool()
def query(sql: str, max_rows: int = 200) -> dict:
    """Run ONE read-only SELECT/WITH/EXPLAIN/SHOW/PRAGMA/VALUES statement. LIMIT is added when missing; max_rows caps at 2000."""
    max_rows = max(1, min(int(max_rows), MAX_ROWS_CAP))
    info, conn = connect()
    try:
        stmt = prepare(sql, info["engine"], max_rows)
        t0 = time.monotonic()
        cols, rows, truncated = run(conn, stmt, (), max_rows)
        return {"columns": cols, "rows": rows, "truncated": truncated,
                "elapsed_ms": round((time.monotonic() - t0) * 1000, 1)}
    finally:
        conn.close()


@mcp.tool()
def sample_rows(table: str, n: int = 20) -> dict:
    """First n rows of a table (same result shape as `query`)."""
    info, conn = connect()
    try:
        schema, tbl = _require_table(info, conn, table)
        target = qident(tbl) if info["engine"] == "sqlite" else f"{qident(schema)}.{qident(tbl)}"
    finally:
        conn.close()
    return query(f"SELECT * FROM {target}", n)


if __name__ == "__main__":
    mcp.run()
