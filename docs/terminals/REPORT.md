# REPORT — Terminal support agent (lib/termcap, bin/show-image, bin/termcheck, docs/terminals)

## Files created / finished

| File | Purpose |
|---|---|
| `lib/termcap.sh` | finished: detection of TC_TERMINAL/TRUECOLOR/IMAGES/NOTIFY/NERDFONT/UNICODE (variable names unchanged) |
| `lib/termcap.py` | same logic; `detect()` dataclass unchanged; `python3 termcap.py` prints one `TC_…=…` line |
| `lib/test_termcap.sh` | 23-row env table, both implementations, parity, cache, timing |
| `lib/show_image.py` | all `show-image` logic (kitty protocol encoder, chafa/Quick Look, `--window` dispatch) |
| `lib/show-image-ghostty.applescript`, `lib/show-image-terminal.applescript` | `--window` openers, `on run argv` |
| `bin/show-image` | 3-line bash wrapper (`bin/` is auto-PATH per FORMATS.md §7.1) |
| `bin/termcheck` | rendering self-test, bash 3.2 + printf |
| `bin/test_show_image.sh`, `bin/test_termcheck.sh` | tests with fake `chafa`/`osascript`/`qlmanage` on PATH |
| `docs/terminals/README.md`, `keybindings.md`, `ssh.md`, `rendering.md`, `images.md` | user docs |

`lib/events.*` untouched. No hooks, skills, commands or MCP servers: **no hooks.json / .mcp.json /
settings.json snippets**. `bin/` needs no registration.

## Contract changes other agents should know

- `TC_TERMINAL` gained values `kitty`, `wezterm`, `alacritty`, `hyper` (dict lookups like
  `notify.py`'s `BUNDLE` tolerate them). Existing values unchanged.
- `TC_TRUECOLOR` for Apple_Terminal is now version-gated: `TERM_PROGRAM_VERSION` >= 464 → 1.
  A leaked `COLORTERM=truecolor` is honoured everywhere **except** inside a pre-Tahoe Terminal.app.
  Decision: the task's literal rule ("one exception") wins over CONVENTIONS' "herdr → truecolor 0", so
  this build session (`COLORTERM=truecolor`, `TERM_PROGRAM` unset) reports `unknown` + `TC_TRUECOLOR=1`,
  the same value the stub already gave. Tested both ways (`herdr_leak` → 1, `herdr_clean` → 0).
- `TC_NERDFONT=1` now also comes from the Terminal.app default-profile font name or Ghostty
  `font-family` lines containing `Nerd`/`NF`. On this machine Terminal.app → 1 (JetBrainsMonoNFM),
  Ghostty → 0 (no config).
- `TC_NOTIFY=osc9` only off-Darwin in ghostty/kitty/wezterm (unchanged contract).
- Implementation detail: the Terminal.app font is read with `plutil` from the plist **file** (not
  `defaults read`, which ignores `$HOME` and would defeat test isolation). Cache:
  `~/.cache/claude-mods/termcap/apple_font` = `<plist mtime> <PostScript name>`, dir 0700. The on-disk
  plist can lag cfprefsd by a moment after a Settings change; the mtime key self-heals.
- `termcap.py` ignores `LC_CTYPE` when Python itself coerced a C locale to `C.UTF-8` (PEP 538), so both
  implementations agree on `TC_UNICODE`.

## Research verdicts (sources in `lib/termcap.sh` comment)

- Terminal.app 24-bit colour: yes on macOS 26 Tahoe. First Tahoe build = Terminal 2.15 (464)
  (Wikipedia), gradient-verified by a third party (termstandard/colors #69), announced at WWDC25
  (MacRumors). Installed here: 2.15 (470.2), `TERM_PROGRAM_VERSION` is `CFBundleVersion`.
  Threshold encoded: `>= 464`. Sequoia was 455.x.
- The Tahoe Terminal binary contains the strings `COLORTERM` and `truecolor` (`strings`), so it likely
  exports `COLORTERM=truecolor` now; the rule still protects pre-Tahoe builds. Unverified live.
- Claude Code docs (terminal-config, fetched 2026-10-24): Shift+Enter "works without setup" in both
  Ghostty and Apple Terminal; `/terminal-setup` for Apple Terminal only turns on Option-as-Meta and
  turns off the audible bell (both already set in "Clear Dark"); Ctrl+J and `\`+Enter are universal.
- Ghostty 1.3.1 (`+show-config --default --docs`, ghostty.org/docs/config): config file is
  `config.ghostty` (since 1.2.3; `config` still read) in `~/.config/ghostty/` or
  `~/Library/Application Support/com.mitchellh.ghostty/`; reload Cmd+Shift+,;
  `shell-integration-features` has `ssh-env` and `ssh-terminfo` (since 1.2.0), default off; `command`
  with arguments runs via `/bin/sh -c`; `wait after command` keeps a surface open.

## Tests run

Env overrides used, as CONVENTIONS requires (this session is not Terminal.app or Ghostty):
`TERM_PROGRAM=Apple_Terminal TERM_PROGRAM_VERSION=455.1|464|470.2 TERM=xterm-256color [COLORTERM=truecolor]`,
`TERM_PROGRAM=ghostty TERM=xterm-ghostty COLORTERM=truecolor`, plus tmux/herdr/iTerm/kitty/wezterm/
alacritty/vscode/unknown rows. Fake HOMEs carry a synthetic `com.apple.Terminal.plist` and a Ghostty config.

```
$ bash lib/test_termcap.sh
ok   apple_old              apple_terminal 0 none osascript 1 1
ok   apple_old_leak         apple_terminal 0 none osascript 1 1
ok   apple_tahoe            apple_terminal 1 none osascript 1 1
ok   apple_tahoe_leak       apple_terminal 1 none osascript 1 1
ok   apple_badversion       apple_terminal 0 none osascript 1 1
ok   apple_plainfont        apple_terminal 1 none osascript 0 0
ok   ghostty                ghostty 1 kitty osascript 1 1
ok   ghostty_nofont         ghostty 1 kitty osascript 0 1
ok   ghostty_ssh_env        ghostty 1 kitty osascript 0 1
ok   ghostty_by_term        ghostty 1 kitty osascript 0 1
ok   tmux                   tmux 0 none osascript 0 0
ok   tmux_in_ghostty        tmux 1 none osascript 0 1
ok   herdr_leak             herdr 1 none osascript 0 1
ok   herdr_clean            herdr 0 none osascript 0 1
ok   herdr_nerd_env         herdr 0 none osascript 1 1
ok   iterm                  iterm2 1 iterm2 osascript 0 1
ok   vscode                 vscode 1 none osascript 0 1
ok   kitty                  kitty 1 kitty osascript 0 1
ok   wezterm                wezterm 1 kitty osascript 0 1
ok   alacritty              alacritty 1 none osascript 0 1
ok   unknown                unknown 0 none osascript 0 0
ok   unknown_colorterm      unknown 1 none osascript 0 1
ok   empty_env              unknown 0 none osascript 0 0
ok   cache file 1792847916 JetBrainsMonoNFM-Regular
time termcap.sh: cold(cache miss) 15.3 ms, warm min 4.3 ms, warm avg 4.5 ms
time termcap.py: cold(cache miss) 20.4 ms, warm min 18.6 ms, warm avg 18.9 ms
ALL PASS

$ bash bin/test_show_image.sh
ok   ghostty --inline emits kitty graphics + path line
ok   jpeg converted to PNG for kitty
ok   Apple_Terminal --inline calls chafa --size ... <path>
ok   ghostty --window: osascript <script> <show-image> <path>; path not in script text
ok   apple_terminal --window: osascript <script> <show-image> <path>; path not in script text
ok   no flag + non-TTY stdout defaults to --window
ok   herdr --window uses qlmanage -p <path>
ok   missing file exits non-zero
ok   no argument exits non-zero
ALL PASS

$ bash bin/test_termcheck.sh
ok   termcheck under TERM_PROGRAM=Apple_Terminal TERM_PROGRAM_VERSION=470.2 TERM=xterm-256color
ok   termcheck under TERM_PROGRAM=ghostty TERM=xterm-ghostty COLORTERM=truecolor
ALL PASS
```

Also: `/bin/bash -n` on every shell file (bash 3.2), `py_compile` on both Python files, and
`osacompile` of both AppleScripts against the installed Ghostty/Terminal dictionaries (compiles; neither
app was launched). Test 1 passes `--inline` explicitly because stdout-to-file is not a TTY and would
otherwise select `--window` by design.

**Timings (measured, Apple Silicon):** `termcap.sh` 4.3 ms warm / 15 ms on a plist-cache miss;
`termcap.py` 18.6 ms warm / 20 ms miss (python startup is ~11 ms of that). Both under the 30 ms budget.

## Needs from user

- Nothing required. Optional Homebrew: `chafa` (present, 1.18.3, used by `show-image` in Terminal.app),
  `terminal-notifier` (absent; only the `notify` mod would use it), Nerd Font cask
  `font-jetbrains-mono-nerd-font` (present; already the Terminal.app profile font).
- macOS Automation permission: the first `show-image --window` triggers "… wants access to control
  Ghostty / Terminal". Click Allow (System Settings > Privacy & Security > Automation to change later).
- Optional config: `~/.config/ghostty/config.ghostty` lines in `docs/terminals/README.md`
  (`font-family`, `macos-option-as-alt`, `shell-integration-features = …,ssh-env,ssh-terminfo,…`).

## Terminal.app vs Ghostty differences

See `docs/terminals/README.md` matrix. In one line: Ghostty gets inline images (kitty protocol), a
split for `show-image --window`, OSC 777 notifications and OSC 8 links; Terminal.app (Tahoe) gets 24-bit
colour and Nerd glyphs (current font) but no inline images (chafa / Quick Look / new window instead),
no escape-sequence notifications (osascript only), and uses `xterm-256color` so SSH just works.

## Security notes

- `osascript` receives the show-image path and the image path as argv; the scripts build the shell
  line with `quoted form of`. No interpolation into script text; no `shell=True` anywhere.
- `show-image` validates `os.path.isfile(realpath)`; it does not confine paths to `cwd` because it is
  a user-facing CLI, not a hook consuming JSON (Claude passes a path it already read).
- Cache dir `~/.cache/claude-mods/termcap/` is 0700; content is a font name only.
- Nothing reads `~/.claude/settings.json`, `.env`, SSH keys or the keychain.

## Known limitations / unverified

- Live behaviour of the Ghostty split and Terminal.app window (`--window`) was not exercised: no real
  windows in this session. The AppleScripts compile against both dictionaries; runtime errors
  (e.g. a differing record property name) would surface as an osascript message on stderr.
- Terminal.app on Tahoe: whether it sets `COLORTERM`, whether it supports OSC 8, and the mechanism
  behind Claude Code's "Shift+Enter works" for Apple Terminal are unverified; docs say so.
- Ghostty's bundled Nerd Font symbol fallback: unverified, so `TC_NERDFONT=0` without a `font-family`
  line (conservative, harmless).
- `TC_NOTIFY=osc9` (non-Darwin) path untested here (Darwin only).
- Terminal.app font detection reads `$objects[2]` of the archived NSFont and the profile name via a
  `plutil` key path; a profile name containing `.` or a non-stock archive layout yields `TC_NERDFONT=0`.
  Terminal.app profiles with a per-profile font that differs from the "Default Window Settings" profile
  are not considered.
- `show-image` inside tmux: `TC_IMAGES=none` → chafa/Quick Look, never kitty passthrough.
- Off macOS: no `sips`, so only PNGs render inline and dimensions come from the PNG header.
