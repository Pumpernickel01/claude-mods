#!/bin/bash
# Shared terminal detection. Source it; it sets TC_* variables and prints nothing.
# Same logic as termcap.py (change both; lib/test_termcap.sh diffs them). Safe under
# `set -eu`. Budget < 30 ms: no python, at most one plist probe (cached).
#
#   TC_TERMINAL   apple_terminal|ghostty|iterm2|vscode|tmux|kitty|wezterm|alacritty|hyper|herdr|unknown
#   TC_TRUECOLOR  1/0   24-bit colour safe to emit
#   TC_IMAGES     kitty|iterm2|none
#   TC_NOTIFY     osascript|osc9|none   (osascript whenever Darwin)
#   TC_NERDFONT   1/0   only on positive evidence (NERD_FONT=1 or the configured font name)
#   TC_UNICODE    1/0   UTF-8 locale

TC_TERMINAL=unknown TC_TRUECOLOR=0 TC_IMAGES=none TC_NOTIFY=none TC_NERDFONT=0 TC_UNICODE=0

case "${TERM_PROGRAM:-}" in
  Apple_Terminal) TC_TERMINAL=apple_terminal ;;
  ghostty)        TC_TERMINAL=ghostty ;;
  iTerm.app)      TC_TERMINAL=iterm2 ;;
  vscode)         TC_TERMINAL=vscode ;;
  tmux)           TC_TERMINAL=tmux ;;
  WezTerm)        TC_TERMINAL=wezterm ;;
  Hyper)          TC_TERMINAL=hyper ;;
  Alacritty)      TC_TERMINAL=alacritty ;;
  herdr)          TC_TERMINAL=herdr ;;
esac
if [ "$TC_TERMINAL" = unknown ]; then   # kitty and Alacritty do not set TERM_PROGRAM
  case "${TERM:-}" in
    xterm-ghostty) TC_TERMINAL=ghostty ;;
    xterm-kitty)   TC_TERMINAL=kitty ;;
    alacritty)     TC_TERMINAL=alacritty ;;
  esac
  if [ -n "${KITTY_WINDOW_ID:-}" ]; then TC_TERMINAL=kitty; fi
fi
if [ -n "${TMUX:-}" ]; then TC_TERMINAL=tmux; fi

# Terminal.app gained 24-bit colour in macOS 26 Tahoe. Its first release ships Terminal 2.15
# build 464 (TERM_PROGRAM_VERSION is Terminal's CFBundleVersion: 455.x = Sequoia, 464 = Tahoe
# 26.0, 470.2 = Tahoe 26.6). Sources: https://github.com/termstandard/colors/issues/69
# (gradient test on Tahoe), https://en.wikipedia.org/wiki/Terminal_(macOS) ("2.15 (464)",
# 2025-09-15), https://www.macrumors.com/2025/06/16/apples-terminal-app-macos-tahoe/ (WWDC25).
_tc_apple_ok=0
if [ "$TC_TERMINAL" = apple_terminal ]; then
  _tc_v="${TERM_PROGRAM_VERSION:-0}"; _tc_v="${_tc_v%%.*}"
  case "$_tc_v" in ''|*[!0-9]*) _tc_v=0 ;; esac
  if [ "$_tc_v" -ge 464 ]; then _tc_apple_ok=1; fi
fi
case "$TC_TERMINAL" in
  ghostty|iterm2|kitty|wezterm|vscode|alacritty) TC_TRUECOLOR=1 ;;
  apple_terminal) TC_TRUECOLOR=$_tc_apple_ok ;;
esac
# COLORTERM is trusted except inside a pre-Tahoe Terminal.app, which never set it itself:
# there it can only be a leak from a parent process.
case "${COLORTERM:-}" in
  truecolor|24bit)
    if [ "$TC_TERMINAL" != apple_terminal ] || [ "$_tc_apple_ok" = 1 ]; then TC_TRUECOLOR=1; fi ;;
esac

case "$TC_TERMINAL" in
  ghostty|kitty|wezterm) TC_IMAGES=kitty ;;
  iterm2)                TC_IMAGES=iterm2 ;;
esac

case "$OSTYPE" in
  darwin*) TC_NOTIFY=osascript ;;
  *) case "$TC_TERMINAL" in ghostty|kitty|wezterm) TC_NOTIFY=osc9 ;; esac ;;
esac

case "${LC_ALL:-${LC_CTYPE:-${LANG:-}}}" in *UTF-8*|*utf-8*|*UTF8*|*utf8*) TC_UNICODE=1 ;; esac

# Nerd font: a font whose name contains "Nerd" or "NF" (JetBrainsMonoNFM, "Hack Nerd Font"...).
_tc_font=""
if [ "${NERD_FONT:-}" = 1 ]; then
  TC_NERDFONT=1
elif [ "$TC_TERMINAL" = apple_terminal ]; then
  # Font of the default profile, read from the plist file (not `defaults`, so HOME isolates tests;
  # shortcut: the on-disk file can lag cfprefsd by a moment). The Font value is an NSKeyedArchiver
  # blob whose $objects[2] is the PostScript name on every stock profile. Cached by plist mtime.
  _tc_plist="${HOME:-}/Library/Preferences/com.apple.Terminal.plist"
  _tc_cache="${HOME:-}/.cache/claude-mods/termcap/apple_font"
  if [ -r "$_tc_plist" ]; then
    _tc_mtime=$(stat -f %m "$_tc_plist" 2>/dev/null || echo 0)
    _tc_cm=""
    if [ -r "$_tc_cache" ]; then read -r _tc_cm _tc_font < "$_tc_cache" || true; fi
    if [ "$_tc_cm" != "$_tc_mtime" ]; then
      _tc_prof=$(plutil -extract 'Default Window Settings' raw -o - "$_tc_plist" 2>/dev/null || true)
      _tc_font=$(plutil -extract "Window Settings.${_tc_prof:-Basic}.Font" raw -o - "$_tc_plist" 2>/dev/null \
        | base64 -d 2>/dev/null | plutil -extract '$objects.2' raw -o - - 2>/dev/null || true)
      (umask 077 && mkdir -p "${_tc_cache%/*}" && printf '%s %s\n' "$_tc_mtime" "$_tc_font" > "$_tc_cache") 2>/dev/null || true
    fi
  fi
elif [ "$TC_TERMINAL" = ghostty ]; then
  # Every font-family line (Ghostty allows several; later ones are fallbacks). Includes are not followed.
  for _tc_f in "${XDG_CONFIG_HOME:-${HOME:-}/.config}/ghostty/config.ghostty" \
               "${XDG_CONFIG_HOME:-${HOME:-}/.config}/ghostty/config" \
               "${HOME:-}/Library/Application Support/com.mitchellh.ghostty/config.ghostty" \
               "${HOME:-}/Library/Application Support/com.mitchellh.ghostty/config"; do
    if [ -r "$_tc_f" ]; then
      _tc_font="$_tc_font $(grep -E '^[[:space:]]*font-family[[:space:]]*=' "$_tc_f" 2>/dev/null || true)"
    fi
  done
fi
case "$_tc_font" in *Nerd*|*NF*) TC_NERDFONT=1 ;; esac
unset _tc_apple_ok _tc_v _tc_font _tc_plist _tc_cache _tc_mtime _tc_cm _tc_prof _tc_f

export TC_TERMINAL TC_TRUECOLOR TC_IMAGES TC_NOTIFY TC_NERDFONT TC_UNICODE
