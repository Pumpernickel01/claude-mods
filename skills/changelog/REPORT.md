# REPORT — skills/changelog (`/mods:changelog`)

## Files created
- `~/claude-mods/skills/changelog/SKILL.md` — the skill (50 lines; frontmatter + body, no scripts)
- `~/claude-mods/skills/changelog/test.sh` — offline test, 1.4 s, exit 1 on failure
- `~/claude-mods/skills/changelog/README.md`
- `~/claude-mods/skills/changelog/REPORT.md`

## hooks.json / .mcp.json / settings.json snippets
None. This is a pure skill: Claude Code picks up `skills/changelog/SKILL.md` from the plugin root with no
hooks.json entry, no MCP server and no settings. Nothing for the orchestrator to merge.

## Tests run

`bash ~/claude-mods/skills/changelog/test.sh` — exit 0, "ALL PASSED", 1.4 s. It isolates git from the user's
config (`GIT_CONFIG_GLOBAL=/dev/null`, identity `dev <dev@example.com>`) so no real name leaks into this file.
Checks: frontmatter fields, line count < 60, exactly four `` !`…` `` commands extracted *from SKILL.md* and no other
`` !` `` byte pair anywhere in the body (Claude Code would run it as a command; the extraction is from the file so the
test cannot drift from the skill), their output in a repo with tag v1.0.0 + 5 mixed conventional commits + fake
GitHub remote, their output in a repo with no tag and no remote, then `claude plugin validate` (plain and
`--strict`) on a temp plugin copy with a minimal `plugin.json`.

Rendered `!` context, repo with tag (one `!` command per block, output beneath):
```
--- !`git describe --tags --abbrev=0 2>/dev/null || echo NO_TAG`
v1.0.0
--- !`git tag --sort=-creatordate | head -5`
v1.0.0
--- !`git log --no-merges --pretty=format:'%h%x09%s%x09%an%x09%ad' --date=short $(git describe --tags --abbrev=0 2>/dev/null || git rev-list --max-parents=0 HEAD)..HEAD`
5c826f8	Tidy up whitespace	dev	2026-10-24
d4e139f	docs: update readme	dev	2026-10-24
55bc77a	fix(parser): handle empty scope	dev	2026-10-24
bee13b8	feat(cli): add --json flag	dev	2026-10-24
8385444	feat(api)!: drop v1 endpoints	dev	2026-10-24
--- !`git remote get-url origin 2>/dev/null || true`
git@github.com:example/project.git
```
Repo without tag/remote: line 1 → `NO_TAG`; line 2 empty; line 3 → `629969d	fix: second	dev	2026-10-24`
(root commit excluded, see limitations); line 4 empty.

`claude plugin validate --strict <tmp>/plugin/mods` (plugin.json `{"name":"mods",…}` + copy of this folder), 2.1.310:
```
Validating plugin manifest: <tmp>/plugin/mods/.claude-plugin/plugin.json

Plugin directory checks for <tmp>/plugin/mods. The plugin directory is the catalog that plugins are submitted to; this is a subset of what it runs.

✘ Found 2 problems the plugin directory refuses a submission for:
  ❯ README.md: README missing (README_MISSING). …
  ❯ LICENSE: License missing (LICENSE_MISSING). …
⚠ Found 1 plugin directory warning:
  ❯ .claude-plugin/plugin.json icon: No icon (ICON_MISSING). …

These plugin directory checks do not change the result below. To fail on problems the directory refuses a submission for, run this command with --profile directory.

✔ Validation passed
```
Exit 0 with and without `--strict`. The three "directory" findings are about the temp plugin root (no README,
LICENSE, icon), not about the skill; the real plugin root is the orchestrator's. Also validated a folder holding
only `skills/changelog/` (no manifest): `--strict` exit 0, `--json` → `"success": true, "advice": []`.

Terminal env overrides were not applied: the skill emits no colour or escape sequences, so there is nothing
terminal-specific to test.

## Needs from user
None. `git` is present. The validator's README/LICENSE/icon findings apply to the plugin root, for the orchestrator.

## Terminal.app vs Ghostty differences
None: plain markdown to chat.

## Known limitations
- `BREAKING CHANGE` footers are not in the pre-fetched `%s` list; the body tells Claude to run one extra
  `git log --grep='BREAKING CHANGE'` (covered by `Bash(git log *)`).
- No tag: the fallback `rev-list --max-parents=0 HEAD..HEAD` excludes the root commit itself and breaks on repos
  with several root commits (spec-given command, kept as is).
- `git describe --tags --abbrev=0` picks the nearest tag reachable from HEAD, not the newest by date.
- The date in the heading is "today" from Claude's context, not from git.
- Not tested: a live `claude -p "/mods:changelog"` render (would inherit this session's gate hooks and spend tokens);
  Claude's grouping, link building and CHANGELOG.md prepend are prompt behaviour, verified by reading only.
- `CLAUDE_MODS_DISABLE` has no effect (no script); see README for how to remove the skill.

## Security notes
Read-only git commands only; `allowed-tools` pre-approves nothing that writes. Writing CHANGELOG.md goes through
the normal permission prompt. test.sh never touches the user's git config or any file outside its `mktemp -d`.
