#!/usr/bin/env -S uv run --quiet --with mcp>=1.10,<2 python
"""local-docs: MCP server over a folder of datasheets (PDF, Markdown, text, HTML).

stdio only, no network. Every path is confined to DOCS_DIR via realpath.
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime
from html.parser import HTMLParser

if "local-docs" in os.environ.get("CLAUDE_MODS_DISABLE", "").split(","):
    sys.exit(0)

from mcp.server.fastmcp import FastMCP

DOCS_DIR = os.path.expanduser(os.environ.get("DOCS_DIR", "~/Documents/datasheets"))
os.makedirs(DOCS_DIR, mode=0o755, exist_ok=True)
ROOT = os.path.realpath(DOCS_DIR)
CACHE_DIR = os.path.expanduser("~/.cache/claude-mods/local-docs")
EXTS = (".pdf", ".md", ".markdown", ".txt", ".rst", ".html")
OUT_CAP = 50_000          # bytes per tool result
SCAN_CAP = 50_000_000     # bytes of extracted text per search
SCAN_SECS = 10

mcp = FastMCP("local-docs", instructions=f"Local documents under {DOCS_DIR}")


def _resolve(rel: str, allow_root: bool = False) -> str:
    """Return the realpath of rel inside ROOT or raise. Symlinks out of ROOT are refused."""
    if os.path.isabs(rel) or ".." in rel.replace("\\", "/").split("/"):
        raise ValueError("path outside DOCS_DIR")
    real = os.path.realpath(os.path.join(ROOT, rel))
    if real.startswith(ROOT + os.sep) or (allow_root and real == ROOT):
        return real
    raise ValueError("path outside DOCS_DIR")


def _files(start: str):
    """Yield (relpath, realpath) of supported files under start, skipping anything escaping ROOT."""
    for dirpath, dirnames, filenames in os.walk(start, followlinks=False):
        dirnames.sort()
        for name in sorted(filenames):
            if not name.lower().endswith(EXTS):
                continue
            real = os.path.realpath(os.path.join(dirpath, name))
            if real.startswith(ROOT + os.sep) and os.path.isfile(real):
                yield os.path.relpath(real, ROOT), real


class _Strip(HTMLParser):
    def __init__(self):
        super().__init__()
        self.out, self.skip = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.skip += 1
        elif tag in ("p", "br", "div", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "pre"):
            self.out.append("\n")

    def handle_endtag(self, tag):
        if tag in ("script", "style") and self.skip:
            self.skip -= 1

    def handle_data(self, data):
        if not self.skip:
            self.out.append(data)


def _extract(real: str) -> str:
    if real.lower().endswith(".pdf"):
        if not shutil.which("pdftotext"):
            raise ValueError("pdftotext not found; run: brew install poppler")
        r = subprocess.run(["pdftotext", "-layout", real, "-"], capture_output=True, timeout=60)
        if r.returncode:
            raise ValueError(f"pdftotext failed: {r.stderr.decode(errors='replace').strip()}")
        return r.stdout.decode("utf-8", errors="replace").removesuffix("\f")  # pdftotext ends with one stray \f
    with open(real, "rb") as f:
        text = f.read().decode("utf-8", errors="replace")
    if real.lower().endswith(".html"):
        p = _Strip()
        p.feed(text)
        text = re.sub(r"\n{3,}", "\n\n", "".join(p.out))
    return text


def _text(real: str) -> str:
    key = hashlib.sha1(real.encode()).hexdigest()
    cache = os.path.join(CACHE_DIR, f"{key}-{int(os.stat(real).st_mtime)}.txt")
    if os.path.exists(cache):
        with open(cache, encoding="utf-8") as f:
            return f.read()
    text = _extract(real)
    os.makedirs(CACHE_DIR, exist_ok=True)
    with open(cache, "w", encoding="utf-8") as f:
        f.write(text)
    return text


def _pages(real: str) -> list:
    return _text(real).split("\f") if real.lower().endswith(".pdf") else [_text(real)]


def _cap(s: str) -> str:
    b = s.encode("utf-8")
    if len(b) <= OUT_CAP:
        return s
    return b[:OUT_CAP].decode("utf-8", errors="ignore") + "\n[truncated at 50 KB]"


def _pdf_pages(real: str):
    if not shutil.which("pdfinfo"):
        return None
    r = subprocess.run(["pdfinfo", real], capture_output=True, timeout=30)
    m = re.search(rb"^Pages:\s+(\d+)", r.stdout, re.M)
    return int(m.group(1)) if m else None


@mcp.tool(structured_output=False)
def list_docs(subdir: str = "") -> str:
    """List supported documents (.pdf .md .markdown .txt .rst .html) under DOCS_DIR or a subdir.
    Returns JSON: [{path, size, modified, pages (PDF only)}]."""
    start = _resolve(subdir, allow_root=True)
    out = []
    for rel, real in _files(start):
        st = os.stat(real)
        d = {"path": rel, "size": st.st_size,
             "modified": datetime.fromtimestamp(st.st_mtime).isoformat(timespec="seconds")}
        if real.lower().endswith(".pdf"):
            d["pages"] = _pdf_pages(real)
        out.append(d)
    return _cap(json.dumps({"docs_dir": DOCS_DIR, "docs": out}, indent=1))


@mcp.tool(structured_output=False)
def search(query: str, limit: int = 20, case_sensitive: bool = False, regex: bool = False) -> str:
    """Search all documents for a substring (or regex if regex=true).
    Returns JSON hits: {path, page (PDF, 1-based, else null), line (1-based, within the page for PDFs), snippet}.
    Scanning stops after 10 s or 50 MB of text; 'partial' is true when it did."""
    flags = 0 if case_sensitive else re.IGNORECASE
    pat = re.compile(query if regex else re.escape(query), flags)
    hits, errors, scanned, partial = [], [], 0, False
    t0 = time.monotonic()
    for rel, real in _files(ROOT):
        if time.monotonic() - t0 > SCAN_SECS or scanned > SCAN_CAP:
            partial = True
            break
        try:
            pages = _pages(real)
        except Exception as e:  # one unreadable file must not kill the search
            errors.append({"path": rel, "error": str(e)})
            continue
        is_pdf = real.lower().endswith(".pdf")
        for pno, page in enumerate(pages, 1):
            scanned += len(page)
            for lno, line in enumerate(page.splitlines(), 1):
                m = pat.search(line)
                if not m:
                    continue
                start = max(0, min(m.start() - 100, len(line) - 200))
                hits.append({"path": rel, "page": pno if is_pdf else None, "line": lno,
                             "snippet": line[start:start + 200].strip()})
                if len(hits) >= limit:
                    return _cap(json.dumps({"hits": hits, "partial": True, "errors": errors}, indent=1))
    return _cap(json.dumps({"hits": hits, "partial": partial, "errors": errors}, indent=1))


@mcp.tool(structured_output=False)
def read_doc(path: str, page: int | None = None, start_line: int = 1, max_lines: int = 200) -> str:
    """Read a slice of a document (path relative to DOCS_DIR). PDFs: give page (1-based) to read one page;
    start_line/max_lines slice the lines of that page (or of the whole file)."""
    real = _resolve(path)
    if not real.lower().endswith(EXTS):
        raise ValueError("unsupported file type")
    if not os.path.isfile(real):
        raise ValueError(f"no such document: {path}")
    pages = _pages(real)
    if page is not None:
        if not 1 <= page <= len(pages):
            raise ValueError(f"page out of range: 1..{len(pages)}")
        text, where = pages[page - 1], f" page {page}/{len(pages)}"
    else:
        text, where = "\f".join(pages), (f" ({len(pages)} pages; pass page=N)" if len(pages) > 1 else "")
    lines = text.splitlines()
    a = max(1, start_line)
    b = min(len(lines), a - 1 + max(1, max_lines))
    head = f"# {path}{where} lines {a}-{b} of {len(lines)}\n"
    return _cap(head + "\n".join(lines[a - 1:b]))


if __name__ == "__main__":
    mcp.run(transport="stdio")
