# SSH from Ghostty: the `xterm-ghostty` terminfo problem

Ghostty sets `TERM=xterm-ghostty`. The terminfo entry for it ships inside the app
(`/Applications/Ghostty.app/Contents/Resources/terminfo/78/xterm-ghostty`) and Ghostty points its own
shells at it; it is **not** in the macOS system database (`infocmp -x xterm-ghostty` fails in a shell
that was not started by Ghostty, verified here). Remote hosts do not have it either. Symptoms over SSH:

- `'xterm-ghostty': unknown terminal type.` / `missing or unsuitable terminal: xterm-ghostty`
  from `clear`, `less`, `top`, `tput`, ncurses programs
- no colours or broken colours, cursor/keys misbehaving in editors

Terminal.app sets `TERM=xterm-256color`, which every host knows, so it has no such problem.

## Fix 1 (one-time per host): copy the terminfo entry

Run **inside a Ghostty window** (the local `infocmp` only finds the entry there):

```
infocmp -x xterm-ghostty | ssh HOST -- tic -x -
```

Needs `tic` (ncurses) on the remote. Afterwards `xterm-ghostty` works on that host for that user
(`~/.terminfo/`). Repeat per host and per remote user.

## Fix 2 (recommended): let Ghostty handle it

Ghostty 1.2.0+ has two shell-integration features for exactly this. Option names verified against the
Ghostty 1.3.1 built-in reference (`ghostty +show-config --default --docs`); the 1.3.1 default is
`shell-integration-features = cursor,no-sudo,title,no-ssh-env,no-ssh-terminfo,path`, i.e. both are
**off** until you enable them:

```
# ~/.config/ghostty/config.ghostty
shell-integration-features = cursor,no-sudo,title,ssh-env,ssh-terminfo,path
```

- `ssh-env`: the `ssh` shell function sends `TERM=xterm-256color` instead of `xterm-ghostty`, adds
  `-o SetEnv COLORTERM=truecolor` and `-o SendEnv TERM_PROGRAM TERM_PROGRAM_VERSION` (whether the remote
  accepts them depends on its `sshd_config` `AcceptEnv`). Works on every host, no remote changes.
- `ssh-terminfo`: on first connection installs Ghostty's terminfo with `infocmp` + `tic` over the same
  connection, then uses `TERM=xterm-ghostty` on that host and remembers it (`ghostty +ssh-cache` lists /
  clears the cache). Needs `tic` remotely; otherwise it falls back to `xterm-256color`.

Enable both: full `xterm-ghostty` where possible, `xterm-256color` + `COLORTERM` elsewhere. Reload with
Cmd+Shift+, and open a new window (the shell integration loads at shell start). Requires
`shell-integration` active (default `detect`; set `shell-integration = zsh` if detection fails).

## Fix 3 (terminal-independent): force TERM in `~/.ssh/config`

```
Host *
    SetEnv TERM=xterm-256color
```

Standard OpenSSH, works from any terminal, but you lose Ghostty-specific terminfo capabilities
everywhere. *Unverified on this machine* (nothing was SSH'd during the build); use Fix 2 instead.

## Recommendation

Fix 2 with both features. Fix 1 only for hosts where the automatic install fails (no `tic`), and Fix 3
if you SSH from many different terminals and just want colours to work.
