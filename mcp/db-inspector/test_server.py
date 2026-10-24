#!/usr/bin/env python3
"""Offline tests for db-inspector. Run from this folder:
uv run --with 'mcp>=1.2,<2' --with 'psycopg[binary]>=3.1,<4' python -m unittest
Live PostgreSQL checks run only when DB_INSPECTOR_TEST_PG_URL is set."""
import json
import os
import pathlib
import sqlite3
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import server  # noqa: E402

REJECTED = [
    "INSERT INTO t VALUES (1)",
    "DELETE FROM t",
    "SELECT 1; DROP TABLE t",
    "WITH x AS (DELETE FROM t RETURNING *) SELECT * FROM x",
    "PRAGMA writable_schema=1",
    "ATTACH DATABASE '/tmp/x.db' AS x",
    "UPDATE t SET a=1",
    "SELECT * FROM t FOR UPDATE",
    "SELECT pg_sleep(5)",
    "SELECT * INTO newt FROM t",
    "SELECT set_config('x','y',false)",
    "/* comment */ DROP TABLE t",
    "SELECT 1 -- ; \n; DELETE FROM t",
    "PRAGMA journal_mode(wal)",
    "PRAGMA shrink_memory",
    "",
    "SET search_path = x",
]


class Filter(unittest.TestCase):
    def test_rejects(self):
        for sql in REJECTED:
            with self.subTest(sql=sql), self.assertRaises(ValueError):
                server.check_sql(sql, "sqlite")

    def test_allows(self):
        for sql in ["SELECT 1", "select * from t where x = ';'", "WITH x AS (SELECT 1) SELECT * FROM x",
                    "EXPLAIN SELECT 1", "PRAGMA table_info(t)", "PRAGMA integrity_check", "VALUES (1)",
                    "SELECT 1; -- trailing", "SELECT 'it''s; fine'"]:
            with self.subTest(sql=sql):
                server.check_sql(sql, "sqlite")

    def test_pragma_rejected_on_pg(self):
        with self.assertRaises(ValueError):
            server.check_sql("PRAGMA table_info(t)", "postgresql")

    def test_limit_appended_only_when_missing_and_limitable(self):
        self.assertEqual(server.prepare("SELECT 1;", "sqlite", 50), "SELECT 1 LIMIT 51")
        self.assertEqual(server.prepare("SELECT 1 LIMIT 5", "sqlite", 50), "SELECT 1 LIMIT 5")
        self.assertEqual(server.prepare("PRAGMA table_info(t)", "sqlite", 50), "PRAGMA table_info(t)")
        self.assertEqual(server.prepare("SHOW x", "postgresql", 50), "SHOW x")


class Postgres(unittest.TestCase):
    URL = "postgresql://alice:s3cret@db.example.invalid:5432/app?password=s3cret"

    def test_kwargs_builder(self):
        kw = server.pg_connect_kwargs(self.URL)
        self.assertIs(kw["autocommit"], False)
        self.assertIn("default_transaction_read_only=on", kw["options"])
        self.assertIn("statement_timeout=10000", kw["options"])

    def test_redact(self):
        self.assertNotIn("s3cret", server.redact(self.URL))
        self.assertIn("alice:***@db.example.invalid", server.redact(self.URL))

    @unittest.skipUnless(os.environ.get("DB_INSPECTOR_TEST_PG_URL"), "DB_INSPECTOR_TEST_PG_URL not set")
    def test_live(self):
        os.environ["DB_INSPECTOR_URL"] = os.environ["DB_INSPECTOR_TEST_PG_URL"]
        info = server.get_connection_info()
        self.assertEqual(info["read_only"]["default_transaction_read_only"], "on")
        self.assertEqual(info["read_only"]["transaction_read_only"], "on")
        self.assertTrue(server.query("SELECT 1 AS x")["rows"] == [[1]])
        _, conn = server.connect()
        with self.assertRaisesRegex(Exception, "read-only"):
            conn.execute("CREATE TEMP TABLE zz (a int)"); conn.execute("INSERT INTO zz VALUES (1)")
        conn.close()


class Sqlite(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.proj = self.tmp.name
        self.db = os.path.join(self.proj, "data", "app.db")
        os.makedirs(os.path.dirname(self.db))
        c = sqlite3.connect(self.db)
        c.executescript("""
            CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE);
            CREATE TABLE scans (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), note TEXT);
            CREATE INDEX scans_user ON scans(user_id);
            INSERT INTO users VALUES (1, 'a@x'), (2, 'b@x');
        """)
        c.executemany("INSERT INTO scans VALUES (?, 1, 'n')", [(i,) for i in range(1, 301)])
        c.commit(); c.close()
        # decoys: an unreadable .env (any open() would raise) and skipped dirs
        env = pathlib.Path(self.proj, ".env"); env.write_text("DB=postgresql://u:p@h/x\n"); env.chmod(0)
        os.makedirs(os.path.join(self.proj, "node_modules", "x")); pathlib.Path(self.proj, "node_modules", "x", "junk.db").touch()
        pathlib.Path(self.proj, "docker-compose.yml").write_text("services:\n  db:\n    image: postgres:16\n    environment:\n      POSTGRES_PASSWORD: hunter2\n")
        self.env = dict(os.environ)
        os.environ.pop("DB_INSPECTOR_URL", None)
        os.environ["HOME"] = self.proj  # so a real ~/.config/claude-mods/db-inspector.json is not picked up
        os.environ["CLAUDE_PROJECT_DIR"] = self.proj

    def tearDown(self):
        os.chmod(os.path.join(self.proj, ".env"), 0o600)
        os.environ.clear(); os.environ.update(self.env)
        self.tmp.cleanup()

    def test_autodetect_finds_db_skips_env_and_node_modules(self):
        info = server.get_connection_info()
        self.assertEqual(info["engine"], "sqlite")
        self.assertEqual(info["source"], "auto-detect")
        self.assertEqual(info["candidates"], [os.path.join("data", "app.db")])
        self.assertEqual(info["target"], os.path.realpath(self.db))
        self.assertEqual(info["read_only"], {"uri_mode": "ro", "query_only": 1})
        self.assertEqual(info["hints"], ["postgresql found in docker-compose.yml; set DB_INSPECTOR_URL"])
        self.assertNotIn("hunter2", json.dumps(info))

    def test_no_db_found_message(self):
        os.remove(self.db)
        info = server.get_connection_info()
        self.assertIsNone(info["engine"]); self.assertIn("set DB_INSPECTOR_URL", info["message"])
        with self.assertRaisesRegex(RuntimeError, "no database found"):
            server.list_tables()

    def test_explicit_url_and_missing_file(self):
        os.environ["DB_INSPECTOR_URL"] = "sqlite:///" + self.db
        self.assertEqual(server.get_connection_info()["source"], "env DB_INSPECTOR_URL")
        os.environ["DB_INSPECTOR_URL"] = "sqlite:///" + self.db + ".nope"
        with self.assertRaises(FileNotFoundError):
            server.list_tables()
        self.assertFalse(os.path.exists(self.db + ".nope"), "mode=ro must never create a file")
        os.environ["DB_INSPECTOR_URL"] = "mysql://x"
        with self.assertRaisesRegex(ValueError, "unsupported URL scheme"):
            server.list_tables()

    def test_list_describe_sample_query(self):
        self.assertEqual([t["name"] for t in server.list_tables()], ["scans", "users"])
        d = server.describe_table("scans")
        self.assertEqual([c["name"] for c in d["columns"]], ["id", "user_id", "note"])
        self.assertTrue(d["columns"][0]["pk"])
        self.assertEqual(d["foreign_keys"], [{"column": "user_id", "ref_table": "users", "ref_column": "id"}])
        self.assertEqual(d["indexes"][0], {"name": "scans_user", "unique": False, "columns": ["user_id"]})
        self.assertEqual(d["row_count"], 300)
        s = server.sample_rows("users", 1)
        self.assertEqual((s["columns"], s["rows"], s["truncated"]), (["id", "email"], [[1, "a@x"]], True))
        q = server.query("SELECT email FROM users WHERE id = 2")
        self.assertEqual(q["rows"], [["b@x"]]); self.assertFalse(q["truncated"]); self.assertIn("elapsed_ms", q)
        with self.assertRaises(ValueError):
            server.describe_table('users"; DROP TABLE users; --')

    def test_limit_and_cap(self):
        q = server.query("SELECT id FROM scans")
        self.assertEqual((len(q["rows"]), q["truncated"]), (200, True))
        q = server.query("SELECT id FROM scans LIMIT 250", max_rows=10)  # explicit LIMIT: fetch cap still holds
        self.assertEqual((len(q["rows"]), q["truncated"]), (10, True))
        q = server.query("SELECT id FROM scans", max_rows=5000)
        self.assertEqual(len(q["rows"]), 300)  # cap 2000 > 300 rows, nothing truncated
        self.assertFalse(q["truncated"])
        self.assertEqual(server.prepare("SELECT 1", "sqlite", 2000), "SELECT 1 LIMIT 2001")

    def test_filter_rejects_writes(self):
        for sql in REJECTED:
            with self.subTest(sql=sql), self.assertRaises(ValueError):
                server.query(sql)
        self.assertEqual(server.query("SELECT COUNT(*) FROM scans")["rows"], [[300]], "nothing was deleted")

    def test_connection_is_read_only_even_without_filter(self):
        _, conn = server.connect()
        for sql in ["INSERT INTO users VALUES (9, 'z')", "DELETE FROM scans", "DROP TABLE users",
                    "CREATE TABLE evil (a)", "PRAGMA writable_schema=1; UPDATE sqlite_master SET sql='x'"]:
            with self.subTest(sql=sql), self.assertRaisesRegex(sqlite3.OperationalError, "readonly|read-only"):
                conn.executescript(sql) if ";" in sql else conn.execute(sql)
        conn.close()
        self.assertEqual(sqlite3.connect(self.db).execute("SELECT COUNT(*) FROM users").fetchone()[0], 2)

    def test_stdio_initialize_and_tools_list(self):
        msgs = [
            {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "test", "version": "0"}}},
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
        ]
        p = subprocess.run([sys.executable, os.path.join(HERE, "server.py")], input="".join(json.dumps(m) + "\n" for m in msgs),
                           capture_output=True, text=True, timeout=25)
        tools = [json.loads(l) for l in p.stdout.splitlines() if l.strip()][-1]["result"]["tools"]
        self.assertEqual(sorted(t["name"] for t in tools), ["describe_table", "get_connection_info", "list_tables", "query", "sample_rows"])


if __name__ == "__main__":
    unittest.main()
