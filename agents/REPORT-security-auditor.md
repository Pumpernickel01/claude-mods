# REPORT — security-auditor

## Files created
- `agents/security-auditor.md` — the subagent (frontmatter `name`, `description`, `tools: Read, Glob, Grep`, `color: red`; body 47 lines)
- `agents/README-security-auditor.md`
- `agents/REPORT-security-auditor.md`

No `test.sh`: the caller restricted this agent to the three files above; the
agent definition has no executable code. Validation and a frontmatter check
were run instead (below).

## hooks.json / .mcp.json / settings.json snippets
None. Plugin `agents/*.md` auto-loads as `mods:security-auditor`; invoke with
`@agent-mods:security-auditor` or `Agent(subagent_type: "mods:security-auditor")`.
No hook, MCP server or settings entry is needed.

## Tests run
FORMATS.md §7.5 says a directory without marketplace.json/plugin.json validates
its skills/agents/commands folders. Checked empirically with a scratch plugin
(stub `skills/stub/SKILL.md`, `agents/` holding a copy of this agent and a copy
with the `name:` line removed): `claude plugin validate <dir>/agents` prints only
"Validating components in" and passes; `claude plugin validate <dir>` also
passed and did not flag the nameless copy. A bare dir with only `agents/` and
no skills tree is rejected outright ("No manifest found"). So validate accepts
any agent file whose frontmatter parses; it only warns on files with no
frontmatter block at all (the README/REPORT files below). The Python
frontmatter check further down is the real check of the required keys. Both
validate runs are pasted because the task asked for them (paths shortened to `~`).

```
$ claude plugin validate ~/claude-mods/agents
Validating components in: ~/claude-mods/agents

✔ Validation passed
exit=0
```

```
$ claude plugin validate ~/claude-mods
Validating components in: ~/claude-mods

Validating agent: ~/claude-mods/agents/REPORT-docs-updater.md
⚠ Found 1 warning:
  ❯ frontmatter: No frontmatter block found. ...
Validating agent: ~/claude-mods/agents/REPORT-test-writer.md     (same warning)
Validating agent: ~/claude-mods/agents/README-docs-updater.md    (same warning)
Validating agent: ~/claude-mods/agents/README-test-writer.md     (same warning)

Plugin directory checks for ~/claude-mods. ...
✘ Found 2 problems the plugin directory refuses a submission for:
  ❯ README.md: README missing (README_MISSING). ...
  ❯ LICENSE: License missing (LICENSE_MISSING). ...
⚠ Found 1 plugin directory warning:
  ❯ .claude-plugin/plugin.json icon: No icon (ICON_MISSING). ...
ℹ Found 1 plugin directory note:
  ❯ .claude-plugin/plugin.json file: MANIFEST_NOT_FOUND. ...

✔ Validation passed with warnings
exit=0
```

`security-auditor.md` produced no warning in either run (weak evidence, see
above). The repo-root warnings are the
orchestrator's (no plugin.json/README/LICENSE yet) and other agents' README/
REPORT files sitting in `agents/` (see Known limitations; my two will warn the
same way).

Frontmatter check (`python3 -I -c`, splits on `---`): keys are exactly
`name, description, tools, color`; `name == security-auditor`; `tools == Read,
Glob, Grep`; `color == red`; description is one line; body < 90 lines; no
absolute home-directory path in the file; body contains `No files were modified`. Result:
`frontmatter OK: security-auditor | tools: Read, Glob, Grep | body lines: 47`.

Not tested: actually running the agent against a vulnerable sample repo (no
plugin install or `--plugin-dir` session in this build environment).

## Needs from user
none

## Terminal.app vs Ghostty differences
n/a — Markdown output only, no terminal code.

## Known limitations
- No Bash, so it cannot run `git diff`; the caller pastes the diff or names paths.
- Grep is ripgrep regex (no lookaround): `yaml.load(` and `shell=True` hits
  need a Read to confirm, which the agent does; patterns are heuristics and
  will miss sinks reached through helpers or ORMs.
- Secret-bearing files (`.env*`, keys, credentials) are deliberately never
  opened, so a leaked value inside them is reported only as "present".
- `CLAUDE_MODS_DISABLE` does not apply (no runtime code); disable via
  `/plugin disable mods` or by deleting the file.
- Orchestrator: every `agents/**/*.md` is loaded as an agent, so the
  `README-*.md` / `REPORT-*.md` files in `agents/` (mine and the other
  agents') trigger "No frontmatter block found" warnings and may appear as
  broken agents at runtime. Consider moving them to `docs/agents/` or similar.

## Security notes
- The agent file intentionally contains secret-shaped regexes (`AKIA`,
  `-----BEGIN ... PRIVATE KEY`, `sk-`, `ghp_`, `xox[baprs]-`, JWT prefix).
  They are patterns, not values; expect and allow-list a false positive from
  the pre-push secret scan on `agents/security-auditor.md`.
- Complies with SECURITY.md §1 "Never read secrets": every Grep excludes the
  secret-file globs; the agent reports their presence by filename only and
  masks any real value it does find in source to 4 characters.
