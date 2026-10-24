#!/bin/bash
# Tests for bin/show-image. Offline, < 10 s, non-zero exit on failure. Terminals are simulated with
# env overrides (this session runs under TERM_PROGRAM=herdr) and chafa/osascript/qlmanage with fakes
# on PATH, so no window ever opens.
set -u
BIN="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(dirname "$BIN")"
# realpath: show-image prints os.path.realpath, and /var is a symlink to /private/var on macOS
T=$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$(mktemp -d)"); trap 'rm -rf "$T"' EXIT
fail=0
ok()   { echo "ok   $*"; }
bad()  { echo "FAIL $*"; fail=1; }

# a real 200x120 RGB PNG with random pixels (compresses badly, so the kitty payload needs many chunks)
python3 - "$T/img.png" <<'PY'
import os, struct, sys, zlib
w, h = 200, 120
raw = b"".join(b"\x00" + os.urandom(w * 3) for _ in range(h))
def chunk(t, d): return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")
open(sys.argv[1], "wb").write(png)
PY
IMG="$T/img.png"

# fakes
mkdir -p "$T/fakebin"
for f in chafa osascript qlmanage; do
  printf '#!/bin/bash\nprintf "%%s\\n" "$@" > "$FAKE_LOG"\n' > "$T/fakebin/$f"; chmod +x "$T/fakebin/$f"
done
run() { env -i HOME="$T" PATH="$T/fakebin:$PATH" FAKE_LOG="$T/log" "$@"; }

# 1. Ghostty inline: kitty graphics sequence, chunks <= 4096, m=1...m=0, path+dims last
run TERM_PROGRAM=ghostty TERM=xterm-ghostty "$BIN/show-image" --inline "$IMG" > "$T/out" 2> "$T/err"
python3 - "$T/out" "$IMG" <<'PY' && ok "ghostty --inline emits kitty graphics + path line" || bad "ghostty --inline"
import re, sys
out = open(sys.argv[1], "rb").read(); path = sys.argv[2].encode()
seqs = re.findall(rb"\x1b_G([^;]*);([^\x1b]*)\x1b\\", out)
assert seqs, "no ESC _ G sequence"
assert seqs[0][0].startswith(b"f=100,a=T"), seqs[0][0]
assert all(len(p) <= 4096 for _, p in seqs), "chunk > 4096"
assert len(seqs) > 1 and all(b"m=1" in c for c, _ in seqs[:-1]) and b"m=0" in seqs[-1][0], "bad m= chaining"
last = out.rstrip(b"\n").rsplit(b"\n", 1)[-1]
assert last == path + b" 200x120", last
PY

# 1b. non-PNG input is converted with sips (macOS only)
if command -v sips >/dev/null; then
  sips -s format jpeg "$IMG" --out "$T/img.jpg" >/dev/null 2>&1
  run TERM_PROGRAM=ghostty TERM=xterm-ghostty "$BIN/show-image" --inline "$T/img.jpg" > "$T/out" 2>/dev/null
  if grep -q $'\x1b_Gf=100' "$T/out" && tail -1 "$T/out" | grep -q "^$T/img.jpg 200x120$"; then ok "jpeg converted to PNG for kitty"; else bad "jpeg conversion"; fi
fi

# 2. Terminal.app inline: chafa with --size, path line last
: > "$T/log"
run TERM_PROGRAM=Apple_Terminal TERM_PROGRAM_VERSION=470.2 TERM=xterm-256color "$BIN/show-image" --inline "$IMG" > "$T/out" 2>/dev/null
if grep -q -- '--size' "$T/log" && grep -qx -- "$IMG" "$T/log" && tail -1 "$T/out" | grep -q "^$IMG 200x120$"; then ok "Apple_Terminal --inline calls chafa --size ... <path>"; else bad "Apple_Terminal --inline chafa: $(cat "$T/log")"; fi

# 3. --window: osascript gets the script file, the show-image path and the image path as separate argv
for term in ghostty apple_terminal; do
  : > "$T/log"
  case $term in ghostty) tp=ghostty ;; *) tp=Apple_Terminal ;; esac
  run TERM_PROGRAM=$tp TERM=xterm-256color "$BIN/show-image" --window "$IMG" > "$T/out" 2>/dev/null
  script=$(sed -n 1p "$T/log"); self=$(sed -n 2p "$T/log"); arg=$(sed -n 3p "$T/log")
  if [ "$script" = "$ROOT/lib/show-image-$([ $term = ghostty ] && echo ghostty || echo terminal).applescript" ] \
     && [ "$self" = "$BIN/show-image" ] && [ "$arg" = "$IMG" ] && ! grep -q "$T" "$script" \
     && grep -q 'on run argv' "$script" && tail -1 "$T/out" | grep -q "^$IMG 200x120$"; then
    ok "$term --window: osascript <script> <show-image> <path>; path not in script text"
  else bad "$term --window: $(cat "$T/log")"; fi
done

# 4. default with stdout not a TTY = --window
: > "$T/log"
run TERM_PROGRAM=ghostty TERM=xterm-ghostty "$BIN/show-image" "$IMG" > "$T/out" 2>/dev/null
if grep -q 'show-image-ghostty.applescript' "$T/log"; then ok "no flag + non-TTY stdout defaults to --window"; else bad "default mode"; fi

# 5. unknown terminal (herdr) --window falls back to Quick Look
: > "$T/log"
run TERM_PROGRAM=herdr TERM=xterm-256color "$BIN/show-image" --window "$IMG" > "$T/out" 2>/dev/null
sleep 1  # qlmanage is launched detached
if [ "$(sed -n 1p "$T/log")" = "-p" ] && [ "$(sed -n 2p "$T/log")" = "$IMG" ] && grep -q 'Quick Look' "$T/out"; then ok "herdr --window uses qlmanage -p <path>"; else bad "qlmanage fallback: $(cat "$T/log")"; fi

# 6. errors
if ! run "$BIN/show-image" "$T/nope.png" >/dev/null 2>&1; then ok "missing file exits non-zero"; else bad "missing file accepted"; fi
if ! run "$BIN/show-image" >/dev/null 2>&1; then ok "no argument exits non-zero"; else bad "no argument accepted"; fi

[ "$fail" = 0 ] && echo "ALL PASS" || { echo "FAILURES"; exit 1; }
