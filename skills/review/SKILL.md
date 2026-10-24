---
name: review
description: Review uncommitted changes for bugs, missing error handling, security issues and leftover debug output; report only
disable-model-invocation: true
argument-hint: "[path]"
allowed-tools: Bash(git diff *), Bash(git status *), Bash(git ls-files *), Read, Grep, Glob
disallowed-tools: Edit, Write, NotebookEdit, Bash(git commit *), Bash(git add *)
---

# Review uncommitted changes (read-only)

Scope: `$ARGUMENTS` (empty = whole working tree). When a path is given, append it to the git commands in Steps and report only findings under it.

## Current state

Status:
!`git status --short`

Unstaged:
!`git diff --stat`

Staged:
!`git diff --cached --stat`

Untracked (first 50):
!`git ls-files --others --exclude-standard | head -50`

## Steps

1. Read the full diffs with `git diff` and `git diff --cached`. Read every untracked file listed above in full, except `.env*`, `*.pem`, `*.key` and `*credentials*`: report those as a High finding (secret about to be committed) without opening them.
2. Open surrounding code with Read or Grep only when a hunk cannot be judged on its own.
3. Check every hunk and every untracked file against the checklist.
4. Report. You have no write tools in this skill: do not edit, stage or commit anything.

## Checklist

- Logic bugs: off-by-one, wrong comparison, inverted condition, wrong variable
- Unhandled errors, swallowed exceptions, missing `await`, ignored return values
- Resource leaks: files, sockets, DB handles, subprocesses not closed or released
- Input validation at trust boundaries: CLI args, HTTP, env, file contents
- Injection: SQL, shell, path traversal, template
- Hardcoded secrets, tokens, passwords, private keys
- Insecure defaults: debug on, permissive CORS, world-writable modes, TLS verification off
- Race conditions and unsynchronised shared state
- Leftover debug output: `console.log`, `print(`, `debugger`, `dbg!`, `pdb`, `binding.pry`, `TODO remove`
- Commented-out code
- Missing tests for new behaviour

## Report format

Group findings by severity, highest first: **Critical**, **High**, **Medium**, **Low**, **Nit**. Omit empty groups. One bullet per finding:

`path:line` — one sentence stating the problem. Fix: one sentence.

If there is nothing to report, say so. End with the line `No changes were made.` followed by one of `Verdict: ship` or `Verdict: fix first`.
