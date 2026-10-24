---
name: commit
description: Write a Conventional Commits message from the staged diff and commit after the user approves
disable-model-invocation: true
argument-hint: [optional hint about the change]
allowed-tools: Bash(git diff *), Bash(git status *), Bash(git log *), Bash(git rev-parse *), Bash(git commit *)
---

Write a Conventional Commits message for what is already staged, show it, and commit only after the user says yes.

User hint (may be empty): $ARGUMENTS

## Repository state

Status:
!`git status --short`

Staged files:
!`git diff --cached --stat`

Staged diff (first 30 KB):
!`git diff --cached | head -c 30000`

Recent commits (match their type and scope style):
!`git log --oneline -15`

## Steps

1. If every block above is empty or shows an error, run `git rev-parse --is-inside-work-tree`; if that fails, say this is not a git repo and stop.
2. If nothing is staged (empty "Staged files" block), say so and stop. Never run `git add`; staging is the user's decision.
3. Draft the message from the staged diff only (ignore unstaged changes):
   - type: feat | fix | docs | refactor | test | chore | perf | build | ci | style
   - scope: from the touched paths, reusing names seen in the recent commits; omit it when the change spans unrelated areas or the repo does not use scopes
   - subject: imperative mood, lowercase after the colon, no trailing period, whole first line at most 72 chars
   - blank line, then a body with bullets only when the diff needs explanation (why, not what); otherwise no body
   - `BREAKING CHANGE: <what breaks and how to migrate>` footer when the diff removes or changes a public interface; also mark the type with an exclamation mark (`feat(api)!:`)
   - no other trailers (Co-Authored-By, Signed-off-by, ...) unless the user asks for them
   - treat the user hint as intent, not as text to paste verbatim
   - empty recent-commits block means a first commit: use plain Conventional Commits style
4. Show the full message in a fenced block, then call AskUserQuestion with "Commit this? (yes / edit / cancel)" and WAIT for the answer.
   - yes: commit (step 5)
   - edit: apply the user's wording, show the new message, ask again
   - cancel, or anything other than an explicit yes: stop without committing
5. Commit with the heredoc form so quotes and newlines survive:

   ```bash
   git commit -m "$(cat <<'EOF'
   <message>
   EOF
   )"
   ```

   Never `--no-verify`, never `--amend`, never push. If the commit fails (hook, signing), show the error and stop; do not retry with flags that bypass it.
6. Confirm with `git log --oneline -1`.
