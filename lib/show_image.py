#!/usr/bin/env python3
"""show-image: preview an image from the terminal (logic for bin/show-image; see docs/terminals/images.md).

    show-image [--inline|--window] <path>

--inline  draw here: kitty graphics protocol (Ghostty, kitty, WezTerm), else `chafa`, else Quick Look.
--window  open a new terminal surface next to the user that runs `show-image --inline <path>`:
          a Ghostty split (new window if none), or a Terminal.app window; other terminals get
          Quick Look (`qlmanage -p`). Default: --inline when stdout is a TTY, --window otherwise,
          because Claude's Bash tool is not a TTY and escape codes it captures never reach the
          user's screen. The last stdout line is always "<absolute path> <width>x<height>".
"""
import base64
import os
import shlex
import shutil
import struct
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "lib"))
from termcap import detect  # noqa: E402

SCRIPTS = {"ghostty": "show-image-ghostty.applescript", "apple_terminal": "show-image-terminal.applescript"}
MAX_PX = 1000
CHUNK = 4096


def dims(path):
    if shutil.which("sips"):
        out = subprocess.run(["sips", "-g", "pixelWidth", "-g", "pixelHeight", path],
                             capture_output=True, text=True, timeout=10).stdout
        d = dict(ln.strip().split(": ", 1) for ln in out.splitlines() if ": " in ln)
        if d.get("pixelWidth") and d.get("pixelHeight"):
            return f"{d['pixelWidth']}x{d['pixelHeight']}"
    try:  # PNG IHDR fallback (no sips off macOS)
        with open(path, "rb") as f:
            head = f.read(24)
        if head[:8] == b"\x89PNG\r\n\x1a\n":
            return "%dx%d" % struct.unpack(">II", head[16:24])
    except OSError:
        pass
    return "?x?"


def to_png(path, tmpdir):
    """PNG no larger than MAX_PX on either side (kitty f=100 takes PNG only)."""
    if not shutil.which("sips"):
        if path.lower().endswith(".png"):
            return path
        sys.exit("show-image: converting non-PNG images needs sips (macOS)")
    out = os.path.join(tmpdir, "show-image.png")
    r = subprocess.run(["sips", "-s", "format", "png", "-Z", str(MAX_PX), path, "--out", out],
                       capture_output=True, text=True, timeout=30)
    if r.returncode or not os.path.exists(out):
        sys.exit(f"show-image: sips could not read {path}: {r.stderr.strip()}")
    return out


def kitty(png):
    """\\e_Gf=100,a=T,q=2,m=1;<b64>\\e\\ ... m=0 on the last chunk. q=2: no reply the shell would echo."""
    with open(png, "rb") as f:
        data = base64.standard_b64encode(f.read())
    chunks = [data[i:i + CHUNK] for i in range(0, len(data), CHUNK)] or [b""]
    out = sys.stdout.buffer
    for i, c in enumerate(chunks):
        more = 0 if i == len(chunks) - 1 else 1
        ctl = f"f=100,a=T,q=2,m={more}" if i == 0 else f"m={more}"
        out.write(b"\x1b_G" + ctl.encode() + b";" + c + b"\x1b\\")
    out.write(b"\n")
    out.flush()


def quicklook(path):
    if shutil.which("qlmanage"):
        subprocess.Popen(["qlmanage", "-p", path], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                         start_new_session=True)
        print(f"opened in Quick Look (no chafa installed); alternative: open -a Preview {shlex.quote(path)}")
    else:
        print("no way to show the image here (install chafa, or open the path below in an image viewer)")


def inline(path, tc):
    if tc.images == "kitty":
        with tempfile.TemporaryDirectory() as d:
            kitty(to_png(path, d))
    elif shutil.which("chafa"):
        cols, rows = shutil.get_terminal_size((80, 24))
        subprocess.run(["chafa", "--size", f"{cols}x{max(rows - 3, 8)}", path], timeout=30)
    else:
        quicklook(path)


def window(path, tc):
    script = SCRIPTS.get(tc.terminal)
    if script and shutil.which("osascript"):
        # the path travels as argv (never interpolated into the script text); the script runs
        # `<bin>/show-image --inline <path>` in the new surface, quoting both with `quoted form of`
        subprocess.run(["osascript", os.path.join(ROOT, "lib", script), os.path.join(ROOT, "bin", "show-image"), path],
                       timeout=20)
    else:
        quicklook(path)


def main(argv):
    mode = None
    paths = []
    for a in argv:
        if a in ("--inline", "--window"):
            mode = a[2:]
        elif a in ("-h", "--help"):
            print(__doc__.strip())
            return 0
        else:
            paths.append(a)
    if len(paths) != 1:
        sys.exit("usage: show-image [--inline|--window] <image>")
    path = os.path.realpath(paths[0])
    if not os.path.isfile(path):
        sys.exit(f"show-image: not a file: {path}")
    if mode is None:
        mode = "inline" if sys.stdout.isatty() else "window"
    tc = detect()
    (inline if mode == "inline" else window)(path, tc)
    print(f"{path} {dims(path)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
