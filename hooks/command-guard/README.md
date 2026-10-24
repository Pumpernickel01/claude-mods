# command-guard — dangerous command guard

A `PreToolUse` hook on `Bash`. Before Claude runs a shell command it checks the
command against seven fixed rules and denies the call with a one-sentence
reason that says what to do instead. Everything else passes silently.
Python 3 stdlib only; no network, no files written.

## What it blocks

| Rule name | Blocked | Still allowed |
| :- | :- | :- |
| `rm-system-path` | `rm` with recursive+force flags (`-rf`, `-fr`, `-r -f`, `-Rf`, `--recursive --force`) on `/`, `/*`, `~`, `$HOME`, `${HOME}`, `~/Library`, `~/Library/*`, `/Users/*`, `/System`, `/Library`, `/usr`, `/etc`, `/var`, `/bin`, `/sbin` (each also with `/` or `/*` suffix). Relative targets are resolved against `cwd`, so `rm -rf ..` from `~/code` is caught too. | `rm -rf ./build`, `node_modules`, `dist/`, `/tmp/foo`, `~/Library/Caches/myapp`, `/usr/local/lib/foo` |
| `force-push-protected` | `git push` with `-f`/`--force`, or a `+refspec`, when the refspec names `main`/`master` (`origin main`, `HEAD:main`, `+main`), or when no branch is named and `cwd` is on `main`/`master` (`git -C cwd symbolic-ref`, 2 s timeout; unknown = allow). | `--force-with-lease`, force push to any other branch, plain `git push origin main` |
| `disk-wipe` | `diskutil erase*`, `secureErase`, `zeroDisk`, `randomDisk`, `partitionDisk`, `reformat`; `dd` with `of=/dev/disk*`, `rdisk*`, `sd*`, `nvme*` | `diskutil list`, `dd if=/dev/zero of=disk.img` |
| `chmod-777-recursive` | `chmod -R 777` in any flag order, also `0777`, `a+rwx`, `ugo+rwx` | `chmod 777 file`, `chmod -R 755` |
| `security-bypass` | `csrutil disable` (incl. `authenticated-root disable`), `spctl --master-disable` / `--global-disable`, `nvram` with `amfi_get_out_of_my_way` or `csr-active-config` | `csrutil status`, `spctl --status`, `nvram -p` |
| `secret-file` | A secrets path given to cat/less/more/head/tail/grep/rg/awk/sed/cut/sort/strings/xxd/hexdump/base64/od/vi/vim/nano/open/cp/mv/scp/rsync/curl/tee/wc/source/`.`/python/node/ruby/perl, or used as a `>`/`>>`/`<` target. Secrets paths: `.env`, `.env.*`, `~/.ssh/id_*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.keystore`, `*.jks`, `*.keychain-db`, `.aws/credentials`, `.netrc`, `.git-credentials`, `.docker/config.json`, `.kube/config`, `~/.npmrc`, `.pypirc`, `credentials.json`, `service-account*.json`, `~/Library/Keychains`. `$(...)` and pipes are scanned, so `export $(cat .env \| xargs)` is caught. | `.env.example`/`.sample`/`.template`/`.dist`, `.envrc`, `*.pub`, `~/.ssh/config`, project-local `.npmrc`; `ls`, `test`, `[`, `stat`, `find`, `git diff/status/add` on any file |
| `keychain-access` | `security find-generic-password`, `find-internet-password`, `dump-keychain`, `export`, `import`, `add-*-password`, `delete-*-password`, `delete-keychain`, `unlock-keychain`, `set-keychain-password` | `security find-identity`, `list-keychains`, `verify-cert`, `find-certificate`, `authorizationdb read` |

Commands are split on `;`, `&&`, `||`, `|`, `&`, newlines, `$(`, `` ` ``; `sudo`,
`env`, `VAR=x`, `command`, `exec`, `nohup`, `time`, `nice` prefixes are stripped;
`bash|sh|zsh -c "..."` and `eval` strings are scanned recursively; quotes are
honoured, so `grep -r "rm -rf" docs/` and `git commit -m "... rm -rf ..."` pass.

## Hook contract

- Hit: prints `{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "<rule>: <sentence>"}}`, exit 0.
- No hit: exit 0, no output.
- stdin not JSON, or an internal error: exit 2 with the reason on stderr (fails closed).
- Empty stdin or no `tool_input.command`: exit 0.

## Install

Add to the plugin's `hooks/hooks.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "python3 \"${CLAUDE_PLUGIN_ROOT}/hooks/command-guard/guard.py\"",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

Disable: add `command-guard` to `CLAUDE_MODS_DISABLE` in settings.json `env`
(comma-separated list).

## Accepted false positives (by design, conservative)

- `cp .env.example .env` is denied: `cp` with a `.env` argument counts as a write. Ask the user to copy it.
- `*.key` catches Keynote files and `*.pem` catches public certificates.
- Heredoc bodies are scanned as commands: a line `rm -rf /` or `cat .env` inside `cat <<EOF ... EOF` is denied.
- A quoted `~` or `"$HOME"` (which the shell would not expand) is treated as the home directory.
- `wc -l .env` is denied (only `ls`, `test`, `[`, `stat` are treated as metadata-only).

## Known gaps (not caught)

- Paths built inside interpreter code (`python -c "open('.env')"`), via variables (`rm -rf "$DIR"`), or through `xargs`/`find -exec`.
- `cd elsewhere && git push -f`: the branch check uses the `cwd` the hook receives.
- `sudo -u root <cmd>` (option with a value) hides the command behind `root`.
- Backticks inside double quotes.

## Terminal.app vs Ghostty

No difference: the hook prints JSON to stdout only, no terminal output.

## Permissions / packages

None. `git` is only invoked for the current-branch check and failure is treated as "unknown" (allow).

## Tests

`bash test.sh` runs every line of `tests.txt` (`BLOCK <cmd>` / `ALLOW <cmd>`,
`@main` suffix = cwd on branch main) through `guard.py` with realistic
PreToolUse stdin, plus four contract cases (bad JSON, missing command, empty
stdin, disable switch). Prints each mismatching line; exit 1 on any failure.
