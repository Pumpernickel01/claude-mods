"""Offline tests for the local-docs MCP server.
Run from this folder:  uv run --with 'mcp>=1.10,<2' python -B -m unittest
"""
import glob
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
TMP = tempfile.mkdtemp(prefix="local-docs-test-")
DOCS = os.path.join(TMP, "docs", "sheets")  # does not exist yet: the import must create it
HOME = os.path.join(TMP, "home")  # keeps the cache out of the real ~/.cache
os.makedirs(HOME)
os.environ["DOCS_DIR"] = DOCS
os.environ["HOME"] = HOME
sys.path.insert(0, HERE)
import server  # noqa: E402


def write_pdf(path, pages):
    """Hand-built valid PDF, one text line per page, correct xref offsets."""
    n = len(pages)
    objs = [b"<< /Type /Catalog /Pages 2 0 R >>",
            ("<< /Type /Pages /Kids [%s] /Count %d >>" % (" ".join("%d 0 R" % (4 + 2 * i) for i in range(n)), n)).encode(),
            b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    for i, text in enumerate(pages):
        stream = ("BT /F1 12 Tf 72 720 Td (%s) Tj ET" % text).encode()
        objs.append(("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
                     "/Resources << /Font << /F1 3 0 R >> >> /Contents %d 0 R >>" % (5 + 2 * i)).encode())
        objs.append(b"<< /Length %d >>\nstream\n%s\nendstream" % (len(stream), stream))
    out, offsets = bytearray(b"%PDF-1.4\n"), []
    for i, body in enumerate(objs, 1):
        offsets.append(len(out))
        out += b"%d 0 obj\n%s\nendobj\n" % (i, body)
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)
    out += b"".join(b"%010d 00000 n \n" % o for o in offsets)
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, xref)
    with open(path, "wb") as f:
        f.write(out)


def setUpModule():
    os.makedirs(os.path.join(DOCS, "sub"))
    with open(os.path.join(DOCS, "notes.md"), "w") as f:
        f.write("# Regulator notes\n\nInput Voltage range is 3 to 5 V.\nOutput current 500 mA.\n")
    with open(os.path.join(DOCS, "readme.txt"), "w") as f:
        f.write("plain text file\nVOLTAGE in caps here\n")
    with open(os.path.join(DOCS, "page.html"), "w") as f:
        f.write("<html><head><style>p{}</style></head><body><h1>Pinout</h1><p>GPIO16 drives the <b>LED</b>.</p></body></html>")
    with open(os.path.join(DOCS, "sub", "deep.rst"), "w") as f:
        f.write("deep file\n")
    with open(os.path.join(DOCS, "big.txt"), "w") as f:
        f.write(("x" * 99 + "\n") * 1000)  # 100 KB
    with open(os.path.join(DOCS, "secret.env"), "w") as f:
        f.write("unsupported extension, must not be listed\n")
    write_pdf(os.path.join(DOCS, "sheet.pdf"), ["First page of the datasheet", "Second page mentions Voltage"])
    os.symlink("/etc/hosts", os.path.join(DOCS, "hosts.txt"))


def tearDownModule():
    shutil.rmtree(TMP, ignore_errors=True)


class LocalDocsTests(unittest.TestCase):
    def test_docs_dir_auto_created(self):
        self.assertTrue(os.path.isdir(DOCS))
        self.assertEqual(server.ROOT, os.path.realpath(DOCS))

    def test_list_docs(self):
        docs = {d["path"]: d for d in json.loads(server.list_docs())["docs"]}
        self.assertEqual(sorted(docs), ["big.txt", "notes.md", "page.html", "readme.txt", "sheet.pdf", "sub/deep.rst"])
        self.assertNotIn("hosts.txt", docs)  # symlink out of DOCS_DIR
        self.assertEqual(docs["sheet.pdf"]["pages"], 2)
        self.assertNotIn("pages", docs["notes.md"])
        self.assertGreater(docs["notes.md"]["size"], 0)
        self.assertRegex(docs["notes.md"]["modified"], r"^\d{4}-\d{2}-\d{2}T")
        sub = json.loads(server.list_docs("sub"))["docs"]
        self.assertEqual([d["path"] for d in sub], ["sub/deep.rst"])

    def test_search_substring_case_insensitive(self):
        hits = json.loads(server.search("voltage"))["hits"]
        by_path = {h["path"]: h for h in hits}
        self.assertEqual(sorted(by_path), ["notes.md", "readme.txt", "sheet.pdf"])
        self.assertEqual((by_path["notes.md"]["page"], by_path["notes.md"]["line"]), (None, 3))
        self.assertIn("Voltage range", by_path["notes.md"]["snippet"])
        self.assertEqual((by_path["sheet.pdf"]["page"], by_path["sheet.pdf"]["line"]), (2, 1))

    def test_search_case_sensitive_regex_limit(self):
        hits = json.loads(server.search("VOLTAGE", case_sensitive=True))["hits"]
        self.assertEqual([h["path"] for h in hits], ["readme.txt"])
        hits = json.loads(server.search(r"\d+ mA", regex=True))["hits"]
        self.assertEqual([(h["path"], h["line"]) for h in hits], [("notes.md", 4)])
        r = json.loads(server.search("x", limit=2))
        self.assertEqual(len(r["hits"]), 2)
        self.assertTrue(r["partial"])

    def test_read_doc_text_and_slice(self):
        out = server.read_doc("notes.md", start_line=3, max_lines=1)
        self.assertEqual(out, "# notes.md lines 3-3 of 4\nInput Voltage range is 3 to 5 V.")
        self.assertIn("deep file", server.read_doc("sub/deep.rst"))

    def test_read_doc_pdf_pages(self):
        self.assertIn("Second page mentions Voltage", server.read_doc("sheet.pdf", page=2))
        self.assertIn("page 2/2", server.read_doc("sheet.pdf", page=2))
        whole = server.read_doc("sheet.pdf")
        self.assertIn("First page", whole)
        self.assertIn("(2 pages; pass page=N)", whole)
        with self.assertRaisesRegex(ValueError, "page out of range"):
            server.read_doc("sheet.pdf", page=3)

    def test_read_doc_html_stripped(self):
        out = server.read_doc("page.html")
        self.assertIn("GPIO16 drives the LED.", out)
        self.assertNotIn("<", out.split("\n", 1)[1])

    def test_traversal_refused(self):
        for bad in ("../../etc/passwd", "../", "/etc/passwd", "sub/../../x.md"):
            with self.assertRaisesRegex(ValueError, "path outside DOCS_DIR", msg=bad):
                server.read_doc(bad)
        with self.assertRaisesRegex(ValueError, "path outside DOCS_DIR"):
            server.list_docs("..")

    def test_symlink_outside_refused(self):
        with self.assertRaisesRegex(ValueError, "path outside DOCS_DIR"):
            server.read_doc("hosts.txt")

    def test_unsupported_extension_refused(self):
        with self.assertRaisesRegex(ValueError, "unsupported file type"):
            server.read_doc("secret.env")

    def test_pdf_without_pdftotext(self):
        from unittest import mock
        with mock.patch("server.shutil.which", return_value=None):
            with self.assertRaisesRegex(ValueError, "brew install poppler"):
                server._extract(os.path.join(DOCS, "sheet.pdf"))

    def test_missing_file(self):
        with self.assertRaisesRegex(ValueError, "no such document"):
            server.read_doc("nope.md")

    def test_cache_file_created(self):
        server.read_doc("notes.md")
        files = glob.glob(os.path.join(HOME, ".cache", "claude-mods", "local-docs", "*-*.txt"))
        self.assertTrue(files, "cache file missing")
        self.assertTrue(server.CACHE_DIR.startswith(HOME))

    def test_output_cap(self):
        out = server.read_doc("big.txt", max_lines=100000)
        self.assertLessEqual(len(out.encode()), server.OUT_CAP + 40)
        self.assertTrue(out.endswith("[truncated at 50 KB]"))

    def test_stdio_initialize_and_tools_list(self):
        msgs = [
            {"jsonrpc": "2.0", "id": 1, "method": "initialize",
             "params": {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "t", "version": "0"}}},
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
        ]
        # read the answers before closing stdin: EOF cancels in-flight handlers
        p = subprocess.Popen([sys.executable, os.path.join(HERE, "server.py")], stdin=subprocess.PIPE,
                             stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, env=dict(os.environ))
        killer = threading.Timer(20, p.kill)
        killer.start()
        by_id = {}
        try:
            p.stdin.write("".join(json.dumps(m) + "\n" for m in msgs))
            p.stdin.flush()
            while 2 not in by_id:
                line = p.stdout.readline()
                self.assertTrue(line, "server exited or timed out before answering")
                m = json.loads(line)
                by_id[m.get("id")] = m
        finally:
            killer.cancel()
            p.stdin.close()
            p.stdout.close()
            p.wait(timeout=10)
        self.assertEqual(by_id[1]["result"]["serverInfo"]["name"], "local-docs")
        self.assertEqual(sorted(t["name"] for t in by_id[2]["result"]["tools"]), ["list_docs", "read_doc", "search"])


if __name__ == "__main__":
    unittest.main()
