# REPORT — skills/explain-error

## Files created
- `skills/explain-error/SKILL.md` (49 lines) — the `/mods:explain-error` skill.
- `skills/explain-error/README.md`
- `skills/explain-error/test.sh` (executable)
- `skills/explain-error/REPORT.md`

## hooks.json / .mcp.json / settings.json snippets
None. **No hooks.json entry**, no `.mcp.json` entry, no settings key. A plugin
skill is discovered from `skills/explain-error/SKILL.md` automatically and
appears as `/mods:explain-error` once the orchestrator's
`.claude-plugin/plugin.json` exists (FORMATS.md §4, Plugin row).

## Tests run
Command: `bash ~/claude-mods/skills/explain-error/test.sh` (exit 0). It copies
the skill into a throwaway plugin dir with a stub `plugin.json`, runs
`claude plugin validate --strict` (FORMATS.md §7.5), and asserts the
frontmatter fields, `$ARGUMENTS`, `AskUserQuestion`, and the < 60 line limit.
No env overrides apply: the skill has no terminal-dependent code.

Output (paths are the temp dir; `Fix:` lines elided):
```
Validating plugin manifest: $TMPDIR/tmp.P9ZXqsI9Gt/.claude-plugin/plugin.json
Plugin directory checks for $TMPDIR/tmp.P9ZXqsI9Gt. The plugin directory is the catalog that plugins are submitted to; this is a subset of what it runs.
✘ Found 2 problems the plugin directory refuses a submission for:
  ❯ README.md: README missing (README_MISSING). ...
  ❯ LICENSE: License missing (LICENSE_MISSING). ...
⚠ Found 1 plugin directory warning:
  ❯ .claude-plugin/plugin.json icon: No icon (ICON_MISSING). ...
These plugin directory checks do not change the result below. To fail on problems the directory refuses a submission for, run this command with --profile directory.
The directory also runs a safety scan and a policy review that this command does not.
✔ Validation passed
PASS: explain-error (49 lines)
```
The three "plugin directory" items are about the stub plugin root (README,
LICENSE, icon), not this skill; they are informational and do not affect the
exit code. Orchestrator: the same checks will apply to the real repo root.

Validator behaviour verified with controls (temp copies, not committed):
- `claude plugin validate <skill folder>` → "No manifest found", exit 1; it
  needs a plugin root or a `skills/` tree. Symlinked skills are not read.
- A copy with the closing `---` removed → "frontmatter: No frontmatter block
  found", strict exit 1. So the pass above does reflect this `SKILL.md`.
- A copy with an unknown frontmatter key (`bogus-field: x`) still passed under
  `--strict`, so the validator does not check the field names; the five fields
  used here are taken verbatim from FORMATS.md §4.

## Needs from user
none

## Terminal.app vs Ghostty differences
None. Markdown-only skill, no scripts, colours or images.

## Known limitations
- The safety rules ("only after an explicit yes", "repo files only") are
  instructions to the model, not enforced by code; `Edit`/`Bash` still go
  through Claude Code's normal permission prompts.
- `AskUserQuestion` needs an interactive session; in `-p` mode the skill
  cannot get a yes and should stop at the proposal.
- Frame-to-source mapping is heuristic (listed dependency dirs, build prefixes,
  `.js`→`.ts`); source maps and bundler-renamed symbols are not resolved.
- Not tested end to end in a live session (needs the orchestrator's
  `plugin.json` or `claude --plugin-dir ~/claude-mods`), and not tested with
  real stack traces.
- `CLAUDE_MODS_DISABLE` cannot stop it (no script runs); README says so.

## Security notes
Reads only files inside `${CLAUDE_PROJECT_DIR}`; no secrets, no network, no
telemetry. Nothing to flag.
