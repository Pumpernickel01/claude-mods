---
name: changelog
description: Release notes from commits since the last tag, grouped by Conventional Commit type
disable-model-invocation: true
argument-hint: "[from-ref] [to-ref]  (default: last tag..HEAD)"
allowed-tools: Bash(git describe *), Bash(git log *), Bash(git tag *), Bash(git rev-list *), Bash(git remote *)
---

Generate release notes for this repository. Print the markdown to chat. Do NOT write any file unless the user asks.

## Context (collected before you read this)

Last tag: !`git describe --tags --abbrev=0 2>/dev/null || echo NO_TAG`
Recent tags:
!`git tag --sort=-creatordate | head -5`
Commits since last tag, tab-separated (hash, subject, author, date):
!`git log --no-merges --pretty=format:'%h%x09%s%x09%an%x09%ad' --date=short $(git describe --tags --abbrev=0 2>/dev/null || git rev-list --max-parents=0 HEAD)..HEAD`
Remote: !`git remote get-url origin 2>/dev/null || true`

Arguments: $ARGUMENTS

## Range

- No arguments: use the commit list above (last tag..HEAD; first commit..HEAD when there is no tag).
- `<from> [<to>]` or `<from>..<to>`: discard the list above and run
  `git log --no-merges --pretty=format:'%h%x09%s%x09%an%x09%ad' --date=short <from>..<to>` (`<to>` defaults to HEAD).
- Also run `git log --no-merges --grep='BREAKING CHANGE' --pretty=format:%h` on the range in use: those commits are breaking too.
- No commits in range: say so and stop.

## Grouping

Parse each subject as `type(scope)!: description`. `###` headings in this order, omit empty ones:
Breaking Changes (`type(scope)!:` form, or a `BREAKING CHANGE` footer), Features (feat), Bug Fixes (fix),
Performance (perf), Documentation (docs), Refactoring (refactor), Tests (test), Build/CI (build, ci),
Other (everything else: non-conventional subjects, chore, style, revert; keep subjects verbatim).
Each commit appears once (Breaking Changes wins). Drop `chore(release)` commits entirely.

## Format

- One bullet per commit: `- description (scope) — abc1234`. No scope: omit `(scope)`.
- Remote is GitHub (`git@github.com:o/r.git` or `https://github.com/o/r[.git]`): link the hash as
  `[abc1234](https://github.com/o/r/commit/abc1234)` and put `[Full diff](https://github.com/o/r/compare/<from>...<to>)`
  on the line under the heading. Any other remote, or none: plain hashes, no compare line.
- Heading: `## <version> (YYYY-MM-DD)` with today's date. Version: `<to>` when it is a tag; otherwise bump the last
  semver tag (major if any breaking change, minor if any feat, else patch; keep a `v` prefix); otherwise `Unreleased`.

## Writing to CHANGELOG.md

Only when the user explicitly asks. Prepend the new section above the existing content, keeping an existing
`# Changelog` title on top; create the file with that title if it does not exist. Never rewrite older entries.
