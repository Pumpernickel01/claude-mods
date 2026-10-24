# security-auditor (subagent `mods:security-auditor`)

Read-only security audit of a codebase or a diff. Tools are `Read, Glob, Grep`
only, so it cannot modify files, run commands, or install anything. It traces
untrusted data from entry points (HTTP handlers, CLI args, file readers,
env/config loaders, message consumers) to dangerous sinks and reports a table
sorted by severity (Critical/High/Medium/Low/Info) with `path:line`, CWE id,
evidence snippet, one-sentence exploit sketch and one-sentence fix. Every row is
marked **Confirmed** (data flow read end to end) or **Potential** (sink found,
source not traced). The report always ends with `No files were modified.`

Checks: SQL built from strings, shell/command injection, `eval`/`exec`/`Function(`,
unsafe deserialization (`pickle`, `yaml.load` without SafeLoader, `marshal`,
`ObjectInputStream`, `unserialize`), path traversal, open redirect, SSRF, weak
crypto (MD5/SHA1 for passwords, ECB, hardcoded IV), hardcoded secrets (AWS,
PEM, OpenAI, GitHub, Slack, JWT, `password =`), missing auth checks, verbose
error leakage, insecure TLS, tempfile races, `chmod 777`, CORS `*` with
credentials. Patterns cover Python, JS/TS, Go, Rust, Swift/Kotlin and shell.

## Use

- Whole repo (vendored/generated dirs skipped): `@agent-mods:security-auditor audit this repo`
- Narrow scope: `@agent-mods:security-auditor audit src/api/ and lib/auth.py`
- A diff: the agent has no Bash, so paste the diff into the prompt:
  `@agent-mods:security-auditor audit this diff: <output of git diff main...HEAD>`
- From another agent: `Agent(subagent_type: "mods:security-auditor", prompt: "...")`.

Name the paths or paste the diff; otherwise it audits the whole repo.

## Privacy

It never opens `.env*`, `*.pem`, `*.key`, `*.p12`, `*.kdbx`, `*credentials*` or
`.ssh/`: those globs are excluded from every Grep and only their presence is
reported. Real secret values found in source are masked to 4 characters.

## Disable

Agent definitions have no runtime code, so `CLAUDE_MODS_DISABLE` does not apply.
Disable the whole plugin with `/plugin disable mods`, or delete
`agents/security-auditor.md` and run `/reload-plugins`.

## Terminal.app vs Ghostty

No difference: the agent only returns Markdown text.

## Permissions and packages

None. Read, Glob and Grep need no permission prompts and no external tools.
No `hooks.json`, `.mcp.json` or `settings.json` entry: plugin `agents/` loads
it automatically.
