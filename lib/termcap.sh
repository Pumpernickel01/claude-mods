#!/bin/bash
# Shared terminal detection. Source it; it sets TC_* variables and prints nothing.
# Owned by Agent 21 (terminal support). Stub contract — keep the variable names.
# Conservative on unknown terminals: no truecolor, no images, no nerd font.

TC_TERMINAL=unknown TC_TRUECOLOR=0 TC_IMAGES=none TC_NOTIFY=none TC_NERDFONT=0 TC_UNICODE=0

case "${TERM_PROGRAM:-}" in
  Apple_Terminal) TC_TERMINAL=apple_terminal ;;
  ghostty)        TC_TERMINAL=ghostty; TC_TRUECOLOR=1; TC_IMAGES=kitty ;;
  iTerm.app)      TC_TERMINAL=iterm2;  TC_TRUECOLOR=1; TC_IMAGES=iterm2 ;;
  vscode)         TC_TERMINAL=vscode;  TC_TRUECOLOR=1 ;;
  tmux)           TC_TERMINAL=tmux ;;
  herdr)          TC_TERMINAL=herdr ;;
esac
[ -n "${TMUX:-}" ] && TC_TERMINAL=tmux
case "${TERM:-}" in xterm-ghostty) TC_TERMINAL=ghostty; TC_TRUECOLOR=1; TC_IMAGES=kitty ;; esac
case "${COLORTERM:-}" in truecolor|24bit) TC_TRUECOLOR=1 ;; esac
[ "$(uname)" = Darwin ] && TC_NOTIFY=osascript
case "${LC_ALL:-${LC_CTYPE:-${LANG:-}}}" in *UTF-8*|*utf8*|*UTF8*) TC_UNICODE=1 ;; esac
[ "${NERD_FONT:-0}" = 1 ] && TC_NERDFONT=1
export TC_TERMINAL TC_TRUECOLOR TC_IMAGES TC_NOTIFY TC_NERDFONT TC_UNICODE
