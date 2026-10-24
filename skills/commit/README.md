# /mods:commit

Writes a Conventional Commits message from what is staged and commits it after you approve.

## What it does

1. Loads `git status --short`, `git diff --cached --stat`, the staged diff (first 30 KB) and the last 15 commit subjects into the prompt before Claude reads it.
2. Stops if nothing is staged. It never runs `git add`; staging is your call.
3. Drafts `type(scope): subject` (feat/fix/docs/refactor/test/chore/perf/build/ci/style), scope from the touched paths and your history's scope names, body bullets and a `BREAKING CHANGE:` footer only when the diff needs them. No trailers you did not ask for.
4. Shows the message in a fenced block and asks "Commit this? (yes / edit / cancel)". Commits only on an explicit yes, using `git commit -m "$(cat <<'EOF' ... EOF)"`. Never `--no-verify`, never `--amend`, never push.

## How to use

Stage your changes, then type `/mods:commit`, or `/mods:commit <hint>` (for example `/mods:commit fixes the retry loop`). The hint guides intent; it is not pasted into the message.

## How to disable

The skill has `disable-model-invocation: true`, so it only runs when you type it; Claude cannot trigger it on its own. To remove it entirely, delete or rename `skills/commit/`. `CLAUDE_MODS_DISABLE` does not apply here: there is no script to check it.

## Terminal.app vs Ghostty

None. The skill is plain text in the chat.

## Permissions / packages

`git` only. `allowed-tools` pre-approves `git diff`, `git status`, `git log`, `git rev-parse` and `git commit`. No hooks.json, .mcp.json or settings.json entry is needed.
