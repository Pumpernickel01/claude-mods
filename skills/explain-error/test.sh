#!/bin/bash
# Offline check: SKILL.md validates inside a minimal plugin and meets the spec limits.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
fail=0

if command -v claude >/dev/null 2>&1; then
  T="$(mktemp -d)"
  mkdir -p "$T/.claude-plugin" "$T/skills"
  # stub manifest carries the fields --strict warns about; the real one is the orchestrator's
  printf '{"name":"mods","version":"0.0.0","description":"stub","author":{"name":"stub"}}\n' > "$T/.claude-plugin/plugin.json"
  cp -R "$HERE" "$T/skills/explain-error"   # validator does not follow symlinks
  claude plugin validate --strict "$T" || fail=1
  rm -rf "$T"
else
  echo "SKIP: claude CLI not found, manifest validation not run"
fi

for key in 'name: explain-error' 'disable-model-invocation: true' \
           'argument-hint: \[paste the error or stack trace\]' '\$ARGUMENTS' 'AskUserQuestion'; do
  grep -q -- "$key" "$HERE/SKILL.md" || { echo "FAIL: SKILL.md missing $key"; fail=1; }
done
lines=$(( $(wc -l < "$HERE/SKILL.md") ))
[ "$lines" -lt 60 ] || { echo "FAIL: SKILL.md has $lines lines (limit 60)"; fail=1; }

[ "$fail" -eq 0 ] && echo "PASS: explain-error ($lines lines)" || echo "FAIL: explain-error"
exit "$fail"
