# Terminal support: Terminal.app vs Ghostty

Everything in this plugin detects the terminal through `lib/termcap.sh` / `lib/termcap.py`
(`TC_TERMINAL`, `TC_TRUECOLOR`, `TC_IMAGES`, `TC_NOTIFY`, `TC_NERDFONT`, `TC_UNICODE`) and adapts.
Run `termcheck` (on the Bash tool's PATH; or `bash <plugin>/bin/termcheck`) to see what your
terminal renders and what termcap concluded. Facts below were verified on macOS 26.6 with
Terminal.app 2.15 (build 470.2) and Ghostty 1.3.1 unless marked *unverified*.

## Capability matrix

| Capability | Terminal.app (macOS 26 Tahoe) | Ghostty 1.3.1 |
|---|---|---|
| 24-bit colour | Yes since Tahoe: Terminal 2.15, `TERM_PROGRAM_VERSION` >= 464 ([termstandard/colors #69](https://github.com/termstandard/colors/issues/69), [Wikipedia: 2.15 (464), 2025-09-15](https://en.wikipedia.org/wiki/Terminal_(macOS)), [MacRumors, WWDC25](https://www.macrumors.com/2025/06/16/apples-terminal-app-macos-tahoe/)). Sequoia and older (455.x and below): no. | Yes |
| Inline images | None found: the Terminal binary contains no kitty (`ESC _ G`) or iTerm2 (`1337;File`) protocol strings (`strings`), so treated as unsupported. `show-image` uses `chafa` (block art) or Quick Look. | Kitty graphics protocol (`image-storage-limit`, default 320 MB per screen). `show-image` draws inline. |
| Desktop notifications | No escape-sequence notifications (Claude Code's own desktop notification covers only Ghostty, Kitty, iTerm2). Our `notify` mod uses `osascript` on every macOS terminal. | OSC 9 / OSC 777 (`desktop-notifications = true` default) plus `osascript`. |
| Shift+Enter = newline in Claude Code | "Works without setup" (Claude Code docs table). | "Works without setup" (kitty keyboard protocol). See `keybindings.md`. |
| Option+Enter / Option+P | Needs "Use Option as Meta key": already ON in the "Clear Dark" profile. | `macos-option-as-alt`; default is `true` only for U.S. keyboard layouts. |
| Splits | No independent split shells: View > Split Pane divides one session's view (*unverified* on Tahoe). `show-image --window` opens a new window. | Real splits (`new_split:right` on Cmd+D by default; scriptable via AppleScript `split`). `show-image --window` opens a split. |
| OSC 8 hyperlinks | *unverified* (no documentation found; no evidence of support). | Yes (`link-previews = osc8` option, since 1.2.0). |
| Nerd Font glyphs | Only if the profile font is a Nerd Font. "Clear Dark" currently uses JetBrainsMono Nerd Font Mono (`JetBrainsMonoNFM-Regular`), so `TC_NERDFONT=1`. | Only if `font-family` names a Nerd Font in the config; with no config `TC_NERDFONT=0` and mods use plain Unicode. Ghostty's bundled symbol fallback: *unverified*. |
| `TERM` | `xterm-256color` | `xterm-ghostty` (terminfo ships inside Ghostty.app; see `ssh.md`) |

## What the mods do differently

- Colour: with `TC_TRUECOLOR=1` mods emit 24-bit colour, otherwise the 256-colour palette.
  Terminal.app before Tahoe gets 256 colours even if a parent process leaked `COLORTERM=truecolor`.
- Images: `show-image` draws inline in Ghostty (kitty protocol), uses `chafa`/Quick Look in Terminal.app,
  and when Claude runs it (stdout not a TTY) opens a Ghostty split or a Terminal.app window instead.
  See `images.md`.
- Notifications: `osascript` on macOS in both; Ghostty additionally gets OSC 777 so a remote session can notify.
- Glyphs: `TC_NERDFONT=1` enables Nerd Font icons; otherwise mods stay with Unicode (✓ ✗ ● → …).

## Terminal.app: Settings > Profiles > "Clear Dark"

Current state read from the profile (not from a live window):

- Keyboard > "Use Option as Meta key": **already ON** (`useOptionAsMetaKey = 1`). Nothing to do.
- Text > Font: **JetBrainsMono Nerd Font Mono** already (installed by the Homebrew cask
  `font-jetbrains-mono-nerd-font`). Nothing to do. If you ever switch fonts: pick any Nerd Font
  variant to keep glyphs (`brew install --cask font-jetbrains-mono-nerd-font`), or Menlo / SF Mono:
  both are fine, the mods then fall back to Unicode symbols automatically.
- Advanced > "Unicode East Asian Ambiguous characters are wide": leave **OFF** (the profile has no
  override for it, i.e. the default; confirm the box is clear). ON makes `│─●` and friends double
  width and misaligns boxes and status lines.
- Advanced > "Audible bell": already **off** (`Bell = 0`), which is what Claude Code's `/terminal-setup`
  does for Apple Terminal.
- Text > ANSI colours: the 16 slots are set by the theme; mods on Tahoe use 24-bit colour anyway.
  Use `/theme` inside Claude Code to match light/dark.
- Window: 120x30 cells. `termcheck` output is designed for >= 100 columns.

## Ghostty: `~/.config/ghostty/config.ghostty`

Ghostty 1.2.3+ loads `config.ghostty` (older name `config` still works) from `~/.config/ghostty/`
and from `~/Library/Application Support/com.mitchellh.ghostty/`. On this machine `~/.config/ghostty/`
does not exist and the Application Support file exists but is empty, so Ghostty runs on defaults.
Suggested file (every line optional; defaults noted):

```
# ~/.config/ghostty/config.ghostty  (Ghostty docs: comments "are only valid on their own line", so never append one to a value)
# family name exactly as `ghostty +list-fonts` prints it; makes TC_NERDFONT=1
font-family = JetBrainsMono Nerd Font Mono
# default depends on keyboard layout; explicit true = Option+Enter / Option+P always work
macos-option-as-alt = true
# default `detect` works too
shell-integration = zsh
# default has no-ssh-env,no-ssh-terminfo; see ssh.md
shell-integration-features = cursor,no-sudo,title,ssh-env,ssh-terminfo,path
# default
desktop-notifications = true
# default `default`; values: default | never | always
window-save-state = always
# already the default binding; change the key here if you prefer another
keybind = super+d=new_split:right
```

Reload with **Cmd+Shift+,** (default `reload_config` keybind) or `ghostty +edit-config` then reload.
Some options only apply to new windows/surfaces.
