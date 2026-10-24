# Newlines in the Claude Code prompt: Shift+Enter and Option+Enter

Source: Claude Code docs, "Configure your terminal for Claude Code"
(https://code.claude.com/docs/en/terminal-config), fetched 2026-10-24. Nothing here was tested in a
live Terminal.app or Ghostty window (this build session ran in neither); the docs are the authority.

## Universal, no setup

> Pressing Enter submits your message. To add a line break without submitting, press Ctrl+J, or type
> `\` and then press Enter. Both work in every terminal with no setup.

## Shift+Enter

The docs' table lists **Ghostty, Kitty, iTerm2, WezTerm, Warp, Apple Terminal, Windows Terminal** as
"Works without setup". `/terminal-setup` installs a Shift+Enter binding only for VS Code, Cursor,
Devin Desktop, Alacritty before 0.16 and Zed. Inside tmux, Shift+Enter additionally needs in
`~/.tmux.conf`: `set -s extended-keys on` and `set -as terminal-features 'xterm*:extkeys'`.

- **Terminal.app**: nothing to change. The old "Terminal.app cannot send Shift+Enter" claim is not
  what the current docs say; how Claude Code receives it there is not documented and not verified here.
  If Shift+Enter ever submits, use Ctrl+J or `\`+Enter.
- **Ghostty**: nothing to change. Ghostty implements the kitty keyboard protocol (Ghostty release notes
  mention "programs using Kitty Keyboard protocol"; it is listed among supporting terminals in
  third-party docs), which is how Claude Code distinguishes Shift+Enter from Enter. Do **not** add
  `keybind = shift+enter=text:\n`: it is not needed, and the `text:` action would bypass the protocol.
  Unrelated defaults that look similar: `super+enter` = `toggle_fullscreen`,
  `super+shift+enter` = `toggle_split_zoom`.

## Option+Enter (and Option+P, other Option shortcuts)

> On macOS, most terminals do not send Option as a modifier by default, so these shortcuts do nothing
> until you enable it.

- **Terminal.app**: Settings > Profiles > Keyboard > "Use Option as Meta Key". The "Clear Dark" profile
  already has it **on**. The docs on `/terminal-setup` for Apple Terminal:
  > That prompt runs `/terminal-setup` for you, which enables Option as Meta and turns off the audible
  > bell in your Apple Terminal profile.
  Both are already in the profile (`useOptionAsMetaKey = 1`, `Bell = 0`), so running `/terminal-setup`
  again changes nothing. It does **not** install a Shift+Enter binding for Apple Terminal.
- **Ghostty**: `macos-option-as-alt = true` in `config.ghostty`. The default is `true` only for the
  "U.S. Standard" and "U.S. International" layouts, so set it explicitly if you use another layout.
  Ghostty note: this breaks Option-key Unicode input (e.g. Option+E accents) inside Ghostty only.

## Remapping inside Claude Code

To bind newline/submit to other keys, map `chat:newline` and `chat:submit` in `~/.claude/keybindings.json`
(docs: https://code.claude.com/docs/en/keybindings). Not needed for either terminal here.

## Summary: what to change

| Terminal | Shift+Enter | Option+Enter | Action required |
|---|---|---|---|
| Terminal.app ("Clear Dark") | works per docs | works (Option as Meta already ON) | none |
| Ghostty 1.3.1 | works (kitty keyboard protocol) | works on U.S. layouts | optional: `macos-option-as-alt = true` |
