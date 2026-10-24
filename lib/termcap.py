"""Shared terminal detection (Python twin of termcap.sh; same logic, change both).

    from termcap import detect
    tc = detect()   # tc.terminal, tc.truecolor, tc.images, tc.notify, tc.nerdfont, tc.unicode

CLI: `python3 termcap.py` prints one shell-evaluable line (TC_TERMINAL=... TC_TRUECOLOR=... ...).
Conservative on unknown terminals: truecolor False, images "none", nerdfont False.
"""
import os
import sys
from dataclasses import dataclass

# First macOS 26 Tahoe Terminal.app build (2.15 (464)); Tahoe added 24-bit colour. Sources in termcap.sh.
APPLE_TRUECOLOR_MIN = 464

_PROGRAMS = {"Apple_Terminal": "apple_terminal", "ghostty": "ghostty", "iTerm.app": "iterm2", "vscode": "vscode",
             "tmux": "tmux", "WezTerm": "wezterm", "Hyper": "hyper", "Alacritty": "alacritty", "herdr": "herdr"}
_TERMS = {"xterm-ghostty": "ghostty", "xterm-kitty": "kitty", "alacritty": "alacritty"}
_TRUECOLOR = {"ghostty", "iterm2", "kitty", "wezterm", "vscode", "alacritty"}
_KITTY_IMAGES = {"ghostty", "kitty", "wezterm"}


@dataclass
class TermCap:
    terminal: str = "unknown"   # apple_terminal|ghostty|iterm2|vscode|tmux|kitty|wezterm|alacritty|hyper|herdr|unknown
    truecolor: bool = False
    images: str = "none"        # kitty | iterm2 | none
    notify: str = "none"        # osascript | osc9 | none
    nerdfont: bool = False
    unicode: bool = False


def _apple_font(home):
    """PostScript name of the default Terminal.app profile font, cached by plist mtime."""
    plist = os.path.join(home, "Library/Preferences/com.apple.Terminal.plist")
    try:
        mtime = str(int(os.stat(plist).st_mtime))
    except OSError:
        return ""
    cache = os.path.join(home, ".cache/claude-mods/termcap/apple_font")
    try:
        with open(cache) as f:
            m, _, name = f.read().strip().partition(" ")
        if m == mtime:
            return name
    except OSError:
        pass
    import plistlib  # lazy: only on cache miss
    name = ""
    try:
        with open(plist, "rb") as f:
            d = plistlib.load(f)
        font = d["Window Settings"][d.get("Default Window Settings", "Basic")]["Font"]
        name = str(plistlib.loads(font)["$objects"][2])  # NSKeyedArchiver blob; [2] = NSName on stock profiles
    except Exception:
        pass
    try:
        os.makedirs(os.path.dirname(cache), mode=0o700, exist_ok=True)
        with open(cache, "w") as f:
            f.write(f"{mtime} {name}\n")
    except OSError:
        pass
    return name


def _ghostty_font(home, xdg):
    lines = []
    for p in (f"{xdg}/ghostty/config.ghostty", f"{xdg}/ghostty/config",
              f"{home}/Library/Application Support/com.mitchellh.ghostty/config.ghostty",
              f"{home}/Library/Application Support/com.mitchellh.ghostty/config"):
        try:
            with open(p, encoding="utf-8", errors="replace") as f:
                lines += [ln for ln in f if ln.lstrip().startswith("font-family") and "=" in ln]
        except OSError:
            pass
    return " ".join(lines)


def detect(env=None) -> TermCap:
    e = os.environ if env is None else env
    tc = TermCap()
    tc.terminal = _PROGRAMS.get(e.get("TERM_PROGRAM", ""), "unknown")
    if tc.terminal == "unknown":  # kitty and Alacritty do not set TERM_PROGRAM
        tc.terminal = _TERMS.get(e.get("TERM", ""), "unknown")
        if e.get("KITTY_WINDOW_ID"):
            tc.terminal = "kitty"
    if e.get("TMUX"):
        tc.terminal = "tmux"

    apple_ok = False
    if tc.terminal == "apple_terminal":
        v = e.get("TERM_PROGRAM_VERSION", "0").split(".")[0]
        apple_ok = v.isdigit() and int(v) >= APPLE_TRUECOLOR_MIN
    tc.truecolor = tc.terminal in _TRUECOLOR or apple_ok
    # COLORTERM is trusted except inside a pre-Tahoe Terminal.app (it never set it; a leak from a parent)
    if e.get("COLORTERM") in ("truecolor", "24bit") and (tc.terminal != "apple_terminal" or apple_ok):
        tc.truecolor = True

    tc.images = "kitty" if tc.terminal in _KITTY_IMAGES else "iterm2" if tc.terminal == "iterm2" else "none"
    if os.uname().sysname == "Darwin":
        tc.notify = "osascript"
    elif tc.terminal in _KITTY_IMAGES:
        tc.notify = "osc9"
    # under a C/POSIX locale Python itself sets LC_CTYPE=C.UTF-8 (PEP 538) and turns on UTF-8 mode;
    # ignore that coerced value so the verdict matches termcap.sh
    lc_ctype = "" if sys.flags.utf8_mode and e is os.environ else e.get("LC_CTYPE")
    loc = (e.get("LC_ALL") or lc_ctype or e.get("LANG") or "").lower()
    tc.unicode = "utf-8" in loc or "utf8" in loc

    home = e.get("HOME") or os.path.expanduser("~")
    font = ""
    if e.get("NERD_FONT") == "1":
        tc.nerdfont = True
    elif tc.terminal == "apple_terminal":
        font = _apple_font(home)
    elif tc.terminal == "ghostty":
        font = _ghostty_font(home, e.get("XDG_CONFIG_HOME") or f"{home}/.config")
    if "Nerd" in font or "NF" in font:
        tc.nerdfont = True
    return tc


if __name__ == "__main__":
    tc = detect()
    print(f"TC_TERMINAL={tc.terminal} TC_TRUECOLOR={int(tc.truecolor)} TC_IMAGES={tc.images} "
          f"TC_NOTIFY={tc.notify} TC_NERDFONT={int(tc.nerdfont)} TC_UNICODE={int(tc.unicode)}")
