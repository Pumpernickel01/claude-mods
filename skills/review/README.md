# review — `/mods:review`

Read-only review of your uncommitted changes. Claude reads `git diff`,
`git diff --cached` and every untracked file, then reports findings grouped
by severity (Critical / High / Medium / Low / Nit), each as `path:line`, one
sentence on the problem and one sentence on the fix. It ends with a one-line
verdict: `ship` or `fix first`. It never edits, stages or commits.

## Use

```
/mods:review              # whole working tree
/mods:review src/api      # only changes under src/api
```

Run it inside a git repository. The skill is user-invoked only
(`disable-model-invocation: true`): Claude will not start it on its own.

## What it checks

Logic bugs and off-by-one; unhandled errors, swallowed exceptions, missing
`await`; resource leaks; input validation at trust boundaries; SQL / shell /
path / template injection; hardcoded secrets; insecure defaults; race
conditions; leftover `console.log` / `print(` / `debugger` / `dbg!` / `pdb` /
`binding.pry` / `TODO remove`; commented-out code; missing tests for new
behaviour.

## Read-only, enforced

The frontmatter removes `Edit`, `Write`, `NotebookEdit`, `Bash(git commit *)`
and `Bash(git add *)` from the tool pool for the turn, and pre-approves only
`Bash(git diff *)`, `Bash(git status *)`, `Bash(git ls-files *)`, `Read`,
`Grep` and `Glob`. Any other command still goes through your normal
permission prompts.

## Disable

Nothing runs unless you type `/mods:review`, so there is nothing to switch
off. The repo-wide `CLAUDE_MODS_DISABLE` convention does not apply: this mod
is a single Markdown file with no script. To remove it entirely, delete
`skills/review/` or disable the `mods` plugin.

## Terminal.app vs Ghostty

No difference. Output is plain Markdown in the chat; nothing is drawn or
coloured by the skill.

## Permissions and packages

None beyond `git` on `PATH`. No hooks, no MCP server, no `hooks.json` entry.

## Test

```
bash skills/review/test.sh
```

Checks the frontmatter, the line budget, builds a throwaway repo with a
`print()` left in and an unchecked `open()`, runs the four dynamic-context
commands against it, and runs `claude plugin validate --strict` on a temp
plugin wrapper when `claude` is on `PATH`.
