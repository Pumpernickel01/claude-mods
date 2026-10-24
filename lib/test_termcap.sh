#!/bin/bash
# Tests for lib/termcap.sh and lib/termcap.py: a table of env -> expected values, run through
# both implementations and diffed against each other. Offline, < 5 s. Non-zero exit on failure.
# "Tested in both terminals" = these env overrides; this session runs under TERM_PROGRAM=herdr.
set -u
LIB="$(cd "$(dirname "$0")" && pwd)"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
# Two fake HOMEs: "nerd" has a Terminal.app plist whose default profile uses a Nerd Font and a
# Ghostty config naming one; "plain" has Menlo and no Ghostty config.
python3 - "$T" <<'PY'
import os, plistlib, sys
t = sys.argv[1]
def blob(name):  # shape of Terminal.app's archived NSFont: $objects[2] is the PostScript name
    return plistlib.dumps({"$archiver": "NSKeyedArchiver", "$version": 100000, "$top": {"root": plistlib.UID(1)},
                           "$objects": ["$null", {"NSName": plistlib.UID(2), "NSSize": 12.0}, name, {}]},
                          fmt=plistlib.FMT_BINARY)
for home, font, gcfg in (("nerd", "JetBrainsMonoNFM-Regular", "font-family = JetBrainsMono Nerd Font Mono\n"),
                         ("plain", "Menlo-Regular", None)):
    h = os.path.join(t, home); os.makedirs(os.path.join(h, "Library/Preferences"))
    with open(os.path.join(h, "Library/Preferences/com.apple.Terminal.plist"), "wb") as f:
        plistlib.dump({"Default Window Settings": "Clear Dark",
                       "Window Settings": {"Clear Dark": {"Font": blob(font)}, "Basic": {"Font": blob("Menlo-Regular")}}},
                      f, fmt=plistlib.FMT_BINARY)
    if gcfg:
        os.makedirs(os.path.join(h, ".config/ghostty"))
        with open(os.path.join(h, ".config/ghostty/config.ghostty"), "w") as f:
            f.write("# test\nfont-size = 13\n" + gcfg)
PY

N=none; case "$OSTYPE" in darwin*) N=osascript ;; esac
fail=0
check() {  # check <name> <fake-home> "<terminal truecolor images notify nerdfont unicode>" VAR=val...
  name=$1 home=$2 exp=$3; shift 3
  sh=$(env -i HOME="$T/$home" PATH="$PATH" "$@" /bin/bash -c '. "$1/termcap.sh"; printf "%s %s %s %s %s %s\n" "$TC_TERMINAL" "$TC_TRUECOLOR" "$TC_IMAGES" "$TC_NOTIFY" "$TC_NERDFONT" "$TC_UNICODE"' bash "$LIB")
  py=$(env -i HOME="$T/$home" PATH="$PATH" "$@" python3 "$LIB/termcap.py" | sed 's/TC_[A-Z]*=//g')
  if [ "$sh" = "$exp" ] && [ "$py" = "$exp" ]; then printf 'ok   %-22s %s\n' "$name" "$sh"
  else printf 'FAIL %-22s expected [%s] sh [%s] py [%s]\n' "$name" "$exp" "$sh" "$py"; fail=1; fi
}
U=LANG=en_US.UTF-8
check apple_old        nerd  "apple_terminal 0 none $N 1 1" TERM_PROGRAM=Apple_Terminal TERM_PROGRAM_VERSION=455.1 TERM=xterm-256color $U
check apple_old_leak   nerd  "apple_terminal 0 none $N 1 1" TERM_PROGRAM=Apple_Terminal TERM_PROGRAM_VERSION=455.1 TERM=xterm-256color COLORTERM=truecolor $U
check apple_tahoe      nerd  "apple_terminal 1 none $N 1 1" TERM_PROGRAM=Apple_Terminal TERM_PROGRAM_VERSION=470.2 TERM=xterm-256color $U
check apple_tahoe_leak nerd  "apple_terminal 1 none $N 1 1" TERM_PROGRAM=Apple_Terminal TERM_PROGRAM_VERSION=464 TERM=xterm-256color COLORTERM=truecolor $U
check apple_badversion nerd  "apple_terminal 0 none $N 1 1" TERM_PROGRAM=Apple_Terminal TERM_PROGRAM_VERSION=beta TERM=xterm-256color COLORTERM=24bit $U
check apple_plainfont  plain "apple_terminal 1 none $N 0 0" TERM_PROGRAM=Apple_Terminal TERM_PROGRAM_VERSION=470.2 TERM=xterm-256color LANG=C
check ghostty          nerd  "ghostty 1 kitty $N 1 1"       TERM_PROGRAM=ghostty TERM_PROGRAM_VERSION=1.3.1 TERM=xterm-ghostty COLORTERM=truecolor $U
check ghostty_nofont   plain "ghostty 1 kitty $N 0 1"       TERM_PROGRAM=ghostty TERM=xterm-ghostty $U
check ghostty_ssh_env  plain "ghostty 1 kitty $N 0 1"       TERM_PROGRAM=ghostty TERM=xterm-256color COLORTERM=truecolor $U
check ghostty_by_term  plain "ghostty 1 kitty $N 0 1"       TERM=xterm-ghostty $U
check tmux             plain "tmux 0 none $N 0 0"           TERM_PROGRAM=tmux TMUX=/tmp/tmux-1/default,1,0 TERM=screen-256color LANG=C
check tmux_in_ghostty  plain "tmux 1 none $N 0 1"           TERM_PROGRAM=ghostty TMUX=/tmp/tmux-1/default,1,0 TERM=tmux-256color COLORTERM=truecolor $U
check herdr_leak       plain "herdr 1 none $N 0 1"          TERM_PROGRAM=herdr TERM=xterm-256color COLORTERM=truecolor LANG=C.UTF-8
check herdr_clean      plain "herdr 0 none $N 0 1"          TERM_PROGRAM=herdr TERM=xterm-256color LANG=C.UTF-8
check herdr_nerd_env   plain "herdr 0 none $N 1 1"          TERM_PROGRAM=herdr TERM=xterm-256color NERD_FONT=1 LC_ALL=en_US.UTF-8
check iterm            plain "iterm2 1 iterm2 $N 0 1"       TERM_PROGRAM=iTerm.app TERM=xterm-256color $U
check vscode           plain "vscode 1 none $N 0 1"         TERM_PROGRAM=vscode TERM=xterm-256color $U
check kitty            plain "kitty 1 kitty $N 0 1"         TERM=xterm-kitty KITTY_WINDOW_ID=1 $U
check wezterm          plain "wezterm 1 kitty $N 0 1"       TERM_PROGRAM=WezTerm TERM=wezterm $U
check alacritty        plain "alacritty 1 none $N 0 1"      TERM=alacritty $U
check unknown          plain "unknown 0 none $N 0 0"        TERM=xterm LANG=C
check unknown_colorterm plain "unknown 1 none $N 0 1"       TERM=foot COLORTERM=truecolor $U
check empty_env        plain "unknown 0 none $N 0 0"

# cache: written under HOME, keyed by plist mtime, mode 0700 dir
c="$T/nerd/.cache/claude-mods/termcap/apple_font"
if [ -f "$c" ] && grep -q 'JetBrainsMonoNFM-Regular' "$c"; then echo "ok   cache file $(cat "$c")"; else echo "FAIL cache file missing"; fail=1; fi

# timing: warm (cache hit) and cold (cache miss) for both implementations; regression guard 100 ms
python3 - "$LIB" "$T/nerd" <<'PY' || fail=1
import os, subprocess, sys, time
lib, home = sys.argv[1:]
env = {"HOME": home, "PATH": os.environ["PATH"], "TERM_PROGRAM": "Apple_Terminal", "TERM_PROGRAM_VERSION": "470.2", "LANG": "en_US.UTF-8"}
cache = f"{home}/.cache/claude-mods/termcap/apple_font"
for label, cmd in (("termcap.sh", ["/bin/bash", "-c", f'. "{lib}/termcap.sh"']), ("termcap.py", ["python3", f"{lib}/termcap.py"])):
    os.remove(cache); s = time.perf_counter(); subprocess.run(cmd, env=env, capture_output=True); cold = (time.perf_counter() - s) * 1000
    warm = []
    for _ in range(5):
        s = time.perf_counter(); subprocess.run(cmd, env=env, capture_output=True); warm.append((time.perf_counter() - s) * 1000)
    print(f"time {label}: cold(cache miss) {cold:.1f} ms, warm min {min(warm):.1f} ms, warm avg {sum(warm)/5:.1f} ms")
    if min(warm) > 100:
        sys.exit(f"FAIL {label} slower than 100 ms")
PY
[ "$fail" = 0 ] && echo "ALL PASS" || { echo "FAILURES"; exit 1; }
