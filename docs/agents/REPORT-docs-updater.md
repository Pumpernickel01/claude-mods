# REPORT — docs-updater (agent `mods:docs-updater`)

## Files created

- `agents/docs-updater.md` — the subagent (frontmatter + 70-line body).
- `agents/README-docs-updater.md` — user docs.
- `agents/REPORT-docs-updater.md` — this file.

No scripts, no `test.sh`: the mod is a single prompt file. The `agents/`
folder is shared; nothing else in it was touched.

## hooks.json / .mcp.json / settings.json snippets

None. A plugin agent needs no `hooks.json`, `.mcp.json` or `settings.json`
entry; Claude Code loads every `agents/*.md` from the plugin root. Nothing for
the orchestrator to merge.

Orchestrator note: `README-docs-updater.md` and `REPORT-docs-updater.md` sit
in `agents/` because the task fixed those paths. They have no frontmatter.
`claude plugin validate` did not warn about them (output below), but FORMATS
§5 says plugin `agents/` loads every `.md` as an agent, so if the runtime
complains about them on `/reload-plugins`, move them to `docs/` and update
the one cross-reference in the README (none in the agent body).

## Tests run

Environment: this build session runs under `TERM_PROGRAM=herdr`; the agent
has no terminal-dependent behaviour, so no `TERM_PROGRAM` overrides were
needed and no real Terminal.app or Ghostty window was opened.

```
$ claude plugin validate ~/claude-mods/agents
Validating components in: ~/claude-mods/agents

✔ Validation passed
exit=0

$ claude plugin validate ~/claude-mods/agents --strict
Validating components in: ~/claude-mods/agents

✔ Validation passed
exit=0
```

How much that proves: little. A probe in a temp dir with
`name: bad:name` (a colon, which FORMATS §5 forbids) also printed
`Validation passed`, so the directory validator does not check agent
frontmatter deeply. The frontmatter was therefore also checked with a
stdlib Python script against FORMATS §5: exactly the keys `name`,
`description`, `tools`, `color`; `name` has no `:` and no leading `-`;
`color` is in the allowed set; `tools` is a comma string of known tools;
`description` is one line. Result: `frontmatter ok`. Body line count: 70
(limit 80). Privacy grep for home-directory paths, emails and personal names over the
three files: clean.

Not tested: actually running the agent in a Claude Code session (needs the
orchestrator's `plugin.json` and `claude --plugin-dir`), and whether the
model follows the "Bash is for git only" instruction.

## Needs from user

None. `git` on PATH and a git working directory at run time.

## Terminal.app vs Ghostty differences

None. The agent emits chat text and file edits only.

## Known limitations

- `tools` uses plain `Bash`, not `Bash(git diff *)` forms. FORMATS §5 only
  says `tools` is a "comma string or list" and shows pattern syntax solely
  for hook `if`, settings `permissions` and skill `allowed-tools`, so per the
  task's fallback the restriction lives in the agent body. The validator
  accepts `tools: Read, Bash(git diff *)` syntactically (probed in a temp
  dir), but that says nothing about runtime enforcement; if the orchestrator
  confirms the runtime honours pattern forms for agent `tools`, swap the
  frontmatter line to
  `tools: Read, Glob, Grep, Edit, Write, Bash(git diff *), Bash(git status *), Bash(git log *)`
  and keep the body rule as belt-and-braces.
- No `CLAUDE_MODS_DISABLE` support: a prompt file runs no code, so the
  convention cannot apply. README says how to disable instead.
- No `test.sh` (CONVENTIONS asks every mod for one; the task fixed the
  deliverables to three files). The only offline check possible for a prompt
  file is the frontmatter check above; if the orchestrator wants it as a
  file, it is an eight-line stdlib Python script.
- The agent is instruction-bound: it cannot technically be stopped from
  editing code, only told not to. Review its "Edited" list before committing.

## Security notes

- Bash access is unrestricted at the permission layer; the body limits it to
  `git diff`, `git status`, `git log` and forbids writing git subcommands.
  This is advisory. Risk: the model runs something else. Mitigation available
  to the user: the plugin's dangerous-command guard hook (separate mod) still
  applies to subagent Bash calls.
- The body forbids reading `.env*`, keys and credential files even when a
  doc points at them (SECURITY.md §1).
- No network, no files written outside the repository, no secrets in the
  three files.
