# SECURITY POLICY — binding for every agent and every mod

## What this repo is, security-wise

Hooks run with the user's full privileges on every tool call. MCP servers are
local stdio child processes of Claude Code. Nothing here listens on a network
port, stores credentials, or does its own cryptography. The repo is PUBLIC.
So the risks are: (1) a hook or server doing something destructive or leaking
data, (2) the repo itself leaking private information, (3) the delivery path
(GitHub over SSH) being tampered with. The rules below address those three.

## 1. Code behaviour

- **Least privilege by default.** Anything that can touch hardware, a
  database or a remote system ships in mock / read-only / dry-run mode and
  needs an explicit opt-in env var *and* a config value to go live.
  - Scanner MCP: `SCANNER_MCP_REAL=1` plus a device path in its config file;
    otherwise every tool returns mock data and says so.
  - DB inspector: read-only is **enforced at the connection** (SQLite
    `file:...?mode=ro` URI; Postgres `options=-c default_transaction_read_only=on`
    and a server-side read-only session), *and* the server refuses any
    statement whose first keyword is not `SELECT`/`WITH`/`EXPLAIN`/`SHOW`/
    `PRAGMA`. Both layers, not one.
- **Never read secrets.** No mod reads `.env*`, `~/.ssh/*`, `*.pem`, `*.key`,
  `*credentials*`, `*.kdbx`, keychain (`security` CLI), or cloud credential
  dirs. The dangerous-command guard blocks Claude from doing so via Bash.
- **No shell injection.** Python: `subprocess.run([...])` with a list, never
  `shell=True` with data from stdin JSON. Bash: quote every expansion. Paths
  from hook JSON go through `os.path.realpath` and are checked to be inside
  `cwd` before you act on them.
- **AppleScript / osascript.** Pass user-controlled strings as arguments
  (`osascript script.scpt "$arg"` and `on run argv`), never by interpolating
  them into the script text.
- **Notifications** carry project name and status only, never prompt text or
  file contents.
- **Sensitive output files** (`~/claude-journal/`, `~/.claude/snapshots/`,
  `~/.claude/agent-monitor/`) are created with mode `0700` dirs / `0600`
  files. They contain prompts and transcripts.
- **Fail closed where it matters, fail quiet elsewhere.** The command guard
  blocks on parse failure. Everything else exits 0 on its own errors so a
  broken hook never bricks the session.
- **No `curl | bash`, no auto-install, no `sudo`.** Dependencies only via
  `uv run --with 'pkg>=X,<Y'` with a version range.
- **No telemetry.** Nothing phones home.

## 2. Repository hygiene (public repo)

- No secrets, tokens, hostnames, IPs, emails, personal names, device serials,
  org or private repo names, or `/Users/<name>` paths. Use `~`.
- `~/.claude/settings.json` and `~/.claude.json` are never read or quoted.
- Before every push the orchestrator runs a secret scan over the tree
  (`mcp__plugin-authoring__scan_secrets`) and `git diff --cached` review.
- Scripts that create files set explicit modes; nothing is world-writable.
- Every hook has a test file, and the command guard's test lists both
  blocked and allowed commands so false positives are caught in CI, not in
  the user's session.

## 3. Delivery path: SSH, keys, certificates, post-quantum

Measured on this machine (macOS 26.6, OpenSSH 10.3p1), 2026-10-24:

- `ssh -G git@github.com` shows Apple's build puts `ecdh-sha2-nistp256`
  **first** in the default KEX list, so the connection to GitHub negotiated
  classical ECDH (`debug1: kex: algorithm: ecdh-sha2-nistp256`).
- GitHub *does* accept the hybrid post-quantum exchange: forcing
  `-o KexAlgorithms=mlkem768x25519-sha256` connected fine.

**Recommendation (opt-in, one edit to `~/.ssh/config`, fully reversible):**

```
Host *
    KexAlgorithms mlkem768x25519-sha256,sntrup761x25519-sha512@openssh.com,curve25519-sha256
```

This makes every SSH session (GitHub, your VPS, the Pis) prefer ML-KEM-768 +
X25519 hybrid key exchange, which protects the session against
harvest-now-decrypt-later. Hosts that lack it fall back to X25519. Host keys
and user authentication stay Ed25519: OpenSSH has no post-quantum
*signature* algorithm yet, and that is fine because signatures only need to
be secure at the moment of use.

- **Commit signing:** the repo is configured locally
  (`git config --local`) to sign with the existing SSH key
  `~/.ssh/id_ed25519_github` (`gpg.format ssh`, `commit.gpgsign true`).
  GitHub shows "Verified" only once that public key is also uploaded as a
  *signing* key; the current `gh` token lacks the `admin:ssh_signing_key`
  scope, so that step is listed under "needs your input".
- **Certificates:** none are needed. The repo runs no TLS service; HTTPS to
  GitHub uses the system trust store. Do not add self-signed certs or a
  private CA.
- **No post-quantum library in the code.** Nothing here encrypts data at
  rest or in flight on its own, so adding liboqs/pqcrypto would be surface
  area without a threat it addresses. PQ protection is achieved at the
  transport (SSH KEX) where the data actually moves.
- **Installing on another machine:** `/plugin marketplace add Pumpernickel01/claude-mods`
  fetches over HTTPS/SSH from the user's own repo; verify signatures with
  `git log --show-signature` after cloning.

## 4. If you find a violation

Fix it in your own folder, note it in REPORT.md under "Security notes". If it
is in a shared file, report it to the orchestrator; do not edit the shared
file.
