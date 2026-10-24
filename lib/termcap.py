"""Shared terminal detection (Python twin of termcap.sh). Owned by Agent 21.

    from termcap import detect
    tc = detect()   # tc.terminal, tc.truecolor, tc.images, tc.notify, tc.nerdfont, tc.unicode

Conservative on unknown terminals: truecolor False, images "none", nerdfont False.
"""
import os
import platform
from dataclasses import dataclass


@dataclass
class TermCap:
    terminal: str = "unknown"   # apple_terminal | ghostty | iterm2 | vscode | tmux | herdr | unknown
    truecolor: bool = False
    images: str = "none"        # kitty | iterm2 | none
    notify: str = "none"        # osascript | osc9 | none
    nerdfont: bool = False
    unicode: bool = False


_PROGRAMS = {
    "Apple_Terminal": ("apple_terminal", False, "none"),
    "ghostty": ("ghostty", True, "kitty"),
    "iTerm.app": ("iterm2", True, "iterm2"),
    "vscode": ("vscode", True, "none"),
    "tmux": ("tmux", False, "none"),
    "herdr": ("herdr", False, "none"),
}


def detect(env=None) -> TermCap:
    e = os.environ if env is None else env
    tc = TermCap()
    prog = e.get("TERM_PROGRAM", "")
    if prog in _PROGRAMS:
        tc.terminal, tc.truecolor, tc.images = _PROGRAMS[prog]
    if e.get("TMUX"):
        tc.terminal = "tmux"
    if e.get("TERM") == "xterm-ghostty":
        tc.terminal, tc.truecolor, tc.images = "ghostty", True, "kitty"
    if e.get("COLORTERM") in ("truecolor", "24bit"):
        tc.truecolor = True
    if platform.system() == "Darwin":
        tc.notify = "osascript"
    loc = e.get("LC_ALL") or e.get("LC_CTYPE") or e.get("LANG") or ""
    tc.unicode = "utf-8" in loc.lower() or "utf8" in loc.lower()
    tc.nerdfont = e.get("NERD_FONT") == "1"
    return tc


if __name__ == "__main__":
    print(detect())
