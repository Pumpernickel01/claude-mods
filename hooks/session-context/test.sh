#!/bin/bash
# Offline tests for the session-context hook. Exit non-zero on failure.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HERE/context.py"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
fail=0
ok()  { echo "ok   $1"; }
bad() { echo "FAIL $1"; fail=1; }

# isolate from the user's git config (signing, hooks, templates)
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.com GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.com

# feed <cwd> [extra-json-fields] -> prints decoded additionalContext (or nothing); wall ms and exit code land in $T/meta
feed() {
  local out
  out="$(printf '{"session_id":"s1","transcript_path":"/tmp/t.jsonl","hook_event_name":"SessionStart","source":"startup","cwd":"%s"%s}' "$1" "${2:-}" \
      | python3 -c '
import json, subprocess, sys, time
t = time.monotonic()
r = subprocess.run([sys.argv[1]], input=sys.stdin.read(), capture_output=True, text=True)
ms = int((time.monotonic() - t) * 1000)
sys.stderr.write(f"MS={ms} RC={r.returncode}\n")
if r.stdout.strip():
    print(json.loads(r.stdout)["hookSpecificOutput"]["additionalContext"])
' "$HOOK" 2>"$T/meta")"
  printf '%s' "$out"
}
# feed runs in a subshell, so wall ms / exit code come back through the meta file
ms() { sed -n 's/^MS=\([0-9]*\).*/\1/p' "$T/meta"; }
rc() { sed -n 's/.*RC=\([0-9]*\)$/\1/p' "$T/meta"; }

has() { grep -qF -- "$2" <<<"$1" && ok "$3" || { bad "$3"; echo "$1" | sed 's/^/     | /'; }; }

# --- fixture: 2 commits, modified + untracked file, markers, a tracked binary ---------------
R="$T/repo"; mkdir -p "$R"
git -C "$R" init -q -b main
printf 'x = 1  # TODO one\n# TODO two\n# FIXME three\n' > "$R/a.py"
printf 'HACK here\nXXX there\n' > "$R/b.txt"
printf 'TODO\0\0binary\n' > "$R/bin.dat"
git -C "$R" add . && git -C "$R" commit -q -m "first commit"
printf '# notes\n' > "$R/c.md"
git -C "$R" add . && git -C "$R" commit -q -m "second commit adds notes"
printf 'y = 2\n' >> "$R/a.py"
printf 'TODO untracked must not count\n' > "$R/new.txt"

OUT="$(feed "$R")"
[ "$(rc)" = 0 ] && ok "exit 0" || bad "exit code $(rc)"
has "$OUT" "## Repo context (session-context)" "header present"
has "$OUT" "branch: main" "branch name"
has "$OUT" " M a.py" "status: modified file"
has "$OUT" "?? new.txt" "status: untracked file"
has "$OUT" "first commit" "log: first commit subject"
has "$OUT" "second commit adds notes" "log: second commit subject"
has "$OUT" "2 TODO, 1 FIXME, 2 HACK/XXX in tracked files" "marker counts (tracked only, binary skipped)"
grep -qF "of upstream" <<<"$OUT" && bad "no upstream yet but ahead/behind shown" || ok "no ahead/behind without upstream"

# ahead/behind: clone, add a commit locally, one on the remote
git -C "$R" commit -q --allow-empty -m "third"
C="$T/clone"; git clone -q "$R" "$C"
git -C "$C" commit -q --allow-empty -m "local one"
git -C "$C" commit -q --allow-empty -m "local two"
git -C "$R" commit -q --allow-empty -m "remote only"
git -C "$C" fetch -q
OUT="$(feed "$C")"
has "$OUT" "branch: main (ahead 2 / behind 1 of upstream)" "ahead/behind of upstream (asymmetric: order proven)"

# git grep fallback when rg is not on PATH
OUT="$(PATH=/usr/bin:/bin feed "$R")"
has "$OUT" "2 TODO, 1 FIXME, 2 HACK/XXX in tracked files" "git grep fallback counts match"

# status truncation at 30 lines
for i in $(seq 1 35); do : > "$R/u$i.txt"; done
OUT="$(feed "$R")"
has "$OUT" "+7 more" "status truncated with +K more (37 lines -> 30 + 7)"

# --- skips --------------------------------------------------------------------------------
P="$T/plain"; mkdir -p "$P"
OUT="$(feed "$P")"
[ -z "$OUT" ] && [ "$(rc)" = 0 ] && ok "non-git dir: empty output, exit 0" || bad "non-git dir printed: $OUT"
OUT="$(feed "$R" ',"agent_id":"a1","agent_type":"Explore"')"
[ -z "$OUT" ] && ok "agent_id present: empty output" || bad "agent_id: printed $OUT"
OUT="$(CLAUDE_MODS_DISABLE=other,session-context feed "$R")"
[ -z "$OUT" ] && ok "CLAUDE_MODS_DISABLE honoured" || bad "disable ignored"
OUT="$(printf '' | "$HOOK")"; [ -z "$OUT" ] && ok "empty stdin: quiet" || bad "empty stdin printed"
OUT="$(feed "$T/does-not-exist")"
[ -z "$OUT" ] && [ "$(rc)" = 0 ] && ok "missing cwd: quiet, exit 0" || bad "missing cwd rc=$(rc) out=$OUT"

# --- slow tool: counting is skipped, total stays under budget -----------------------------
mkdir -p "$T/bin"; printf '#!/bin/sh\nsleep 5\n' > "$T/bin/rg"; chmod +x "$T/bin/rg"
OUT="$(PATH="$T/bin:$PATH" feed "$R")"
has "$OUT" "TODO/FIXME: (skipped, slow)" "slow rg -> (skipped, slow)"
has "$OUT" "branch: main" "slow rg still prints the git sections"
[ "$(ms)" -lt 2500 ] && ok "slow rg: wall $(ms)ms < 2500" || bad "slow rg: wall $(ms)ms"

# --- 10k-file repo: wall time < 2 s ----------------------------------------------------------
B="$T/big"; mkdir -p "$B"; git -C "$B" init -q -b main
python3 - "$B" <<'PY'
import os, sys
root = sys.argv[1]
for i in range(10000):
    d = os.path.join(root, "src", f"d{i // 100}")
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, f"f{i}.py"), "w") as f:
        f.write(f"def f{i}():\n    return {i}\n" + ("# TODO later\n" if i % 10 == 0 else ""))
PY
git -C "$B" add . && git -C "$B" commit -q -m "big"
OUT="$(feed "$B")"
has "$OUT" "1000 TODO, 0 FIXME, 0 HACK/XXX" "10k files: counts summed across xargs chunks"
[ "$(ms)" -lt 2000 ] && ok "10k files: wall $(ms)ms < 2000" || bad "10k files: wall $(ms)ms >= 2000"

[ "$fail" = 0 ] && echo "ALL PASSED" || { echo "SOME FAILED"; exit 1; }
