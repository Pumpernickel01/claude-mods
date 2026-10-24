# Verifying colours, Unicode and box drawing: `termcheck`

`termcheck` (in `bin/`, on the Bash tool's PATH inside Claude Code; from a shell run
`bash <plugin>/bin/termcheck`) prints, in order: a 64-step truecolor gradient, a 256-colour row, box
drawing (`┌─┐│└┘├┤┬┴┼ ╭╮╰╯ ═║`), block elements (`▁▂▃▄▅▆▇█ ░▒▓`), symbols (`✓ ✗ ⚠ ● ○ ⎇ → ⇒ …`), a Nerd
Font line (U+E0A0 U+F09B U+E0B0), emoji, text styles, then the `lib/termcap.sh` verdict and the raw
`TERM*`/`COLORTERM` environment. It is pure bash 3.2 + `printf`.

What to look for:

| Row | Good | Bad means |
|---|---|---|
| truecolor | one smooth magenta-to-green ramp | visible bands: the terminal maps 24-bit to 256 colours. Expected on Terminal.app before Tahoe (`TERM_PROGRAM_VERSION` < 464) |
| 256-colour | 36 distinct cells | fewer: 8/16-colour terminal or `TERM` without `-256color` |
| box drawing / blocks | continuous lines, aligned corners | gaps or double-width cells: see Terminal.app quirks |
| symbols | all nine glyphs | missing glyphs: font lacks them; mods fall back further on `TC_UNICODE=0` |
| nerd font | three icons (branch, GitHub mark, powerline arrow) | boxes or blanks: no Nerd Font. Expected and harmless; `TC_NERDFONT=0` keeps mods on Unicode |
| emoji | colour emoji | boxes: no emoji fallback font |
| termcap | `TC_TRUECOLOR=1` where the gradient is smooth, `TC_NERDFONT=1` where icons show | a mismatch is a termcap bug: open an issue with the `env` line |

## In Terminal.app (macOS 26 Tahoe)

Expected: smooth gradient (Tahoe added 24-bit colour), all Unicode rows, Nerd icons (the "Clear Dark"
profile font is JetBrainsMono Nerd Font Mono), verdict
`TC_TERMINAL=apple_terminal TC_TRUECOLOR=1 TC_IMAGES=none TC_NOTIFY=osascript TC_NERDFONT=1 TC_UNICODE=1`.

Known quirks:

- **Ambiguous width**: Settings > Profiles > Advanced > "Unicode East Asian Ambiguous characters are
  wide" must stay off or `│─●○→` become double width and every box/status line misaligns.
- **No inline images**: no kitty or iTerm2 image protocol. `show-image` uses `chafa` block art or Quick
  Look here (`images.md`).
- **Bell**: the profile has the audible bell off (`Bell = 0`); Claude Code's `preferredNotifChannel:
  "terminal_bell"` would therefore be silent. The `notify` mod uses `osascript` instead.
- **Version gate**: `TERM_PROGRAM_VERSION` is Terminal's build number (470.2 here). Below 464 (Sequoia
  and older) termcap reports `TC_TRUECOLOR=0` and ignores a leaked `COLORTERM=truecolor`.
- **COLORTERM**: the Tahoe Terminal binary contains the strings `COLORTERM` and `truecolor`, which
  suggests it now exports `COLORTERM=truecolor` itself. *Unverified* in a live window; termcap does not
  depend on it.
- **OSC 8 hyperlinks**: *unverified*; assume plain URLs only.

## In Ghostty 1.3.1

Expected: smooth gradient, all Unicode rows, verdict
`TC_TERMINAL=ghostty TC_TRUECOLOR=1 TC_IMAGES=kitty TC_NOTIFY=osascript TC_NERDFONT=<0|1> TC_UNICODE=1`.
`TC_NERDFONT` is 1 only if a `font-family` line in `config.ghostty` names a Nerd Font
(e.g. `font-family = JetBrainsMono Nerd Font Mono`). Whether Ghostty renders the Nerd line through its
own bundled symbol fallback without that line is *unverified*; termcap stays conservative.

Known quirks:

- **`xterm-ghostty` over SSH**: remote hosts lack the terminfo; see `ssh.md`.
- **Option key**: `macos-option-as-alt` defaults to `true` only on U.S. layouts (`keybindings.md`).
- **tmux**: inside tmux termcap reports `tmux` with `TC_IMAGES=none` and no truecolor unless
  `COLORTERM` is set; images and notifications need tmux passthrough (Claude Code docs: `set -g
  allow-passthrough on`).
- **`TERM_PROGRAM_VERSION`** is the Ghostty version (`1.3.1`); termcap does not gate on it.

## In this build environment

The build session ran under a wrapper (`TERM_PROGRAM` unset, `COLORTERM=truecolor` leaked):
termcap reports `unknown` with `TC_TRUECOLOR=1` (COLORTERM is honoured for every terminal except a
pre-Tahoe Terminal.app) and `TC_IMAGES=none`. The Terminal.app and Ghostty verdicts above come from
`lib/test_termcap.sh` env overrides, not from live windows.
