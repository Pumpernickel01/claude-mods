# /mods:changelog

Release notes from the commits since the last tag, grouped by Conventional Commit type, printed to chat as markdown.

## Usage

```
/mods:changelog                    # last tag..HEAD (first commit..HEAD if the repo has no tag)
/mods:changelog v1.2.0             # v1.2.0..HEAD
/mods:changelog v1.2.0 v1.3.0      # explicit range; heading uses v1.3.0 as the version
/mods:changelog v1.2.0..v1.3.0     # same, git range syntax
```

Before Claude sees the prompt, four read-only git commands run (last tag, five most recent tags, the commit list,
the `origin` URL) and their output is pasted into the skill. Claude then groups the subjects under, in this order:
Breaking Changes (`type!:` or a `BREAKING CHANGE` footer), Features, Bug Fixes, Performance, Documentation,
Refactoring, Tests, Build/CI, Other (non-conventional subjects, verbatim). `chore(release)` commits are dropped.
Each commit is one bullet: `description (scope) — hash`; when `origin` is a GitHub URL the hash links to the commit
and a `[Full diff](.../compare/from...to)` line follows the heading.

The heading is `## <version> (YYYY-MM-DD)`: the `to` ref when it is a tag, otherwise the last semver tag bumped
(major for breaking, minor for feat, else patch), otherwise `Unreleased`.

Example:

```
## v1.1.0 (2026-10-24)
[Full diff](https://github.com/example/project/compare/v1.0.0...HEAD)

### Breaking Changes
- drop v1 endpoints (api) — [8385444](https://github.com/example/project/commit/8385444)

### Features
- add --json flag (cli) — [bee13b8](https://github.com/example/project/commit/bee13b8)
```

Nothing is written to disk. If you want the section saved, say so ("write it to CHANGELOG.md"): Claude prepends it
above the existing content (keeping a `# Changelog` title on top) and asks for file-write permission first, since only
the five git read commands are pre-approved.

## Disable

The skill is user-invoke-only (`disable-model-invocation: true`): Claude never runs it on its own, so it is inert unless
you type it. It has no script, so `CLAUDE_MODS_DISABLE` does not apply. To remove it from the `/` menu delete
`skills/changelog/` from the plugin (or `claude plugin disable mods` to disable the whole plugin).

## Terminal.app vs Ghostty

No difference: the output is plain markdown in the chat.

## Requirements and permissions

`git` only. Pre-approved tools: `git describe`, `git log`, `git tag`, `git rev-list`, `git remote` (all read-only).
Run `bash skills/changelog/test.sh` to check the context commands against a throwaway repo and run
`claude plugin validate`.
