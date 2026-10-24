# Claude Code plugin, hook, skill, agent, MCP and settings formats

Verified 2026-10-24 from raw markdown of code.claude.com/docs/en pages (CLI 2.1.310 target). JSON/YAML blocks are verbatim from the docs unless marked (summary). "vX.Y.Z+" = version the docs say a feature needs.

Doc URL changes: `plugins-reference` now renders `plugins/manifest-reference`; `plugin-marketplaces` now renders `plugins/create-marketplace`; `plugins` now renders `plugins/overview`; `slash-commands` renders the same page as `skills` (commands are folded into skills).

---

## 1. HOOKS (hooks.md)

### 1.1 Config shape

Three levels: event -> matcher group -> handler list. Same shape in settings.json, in plugin `hooks/hooks.json` (with a top-level `"hooks"` wrapper), and in skill/agent frontmatter.

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "if": "Bash(rm *)",
            "command": "${CLAUDE_PROJECT_DIR}/.claude/hooks/block-rm.sh",
            "args": []
          }
        ]
      }
    ]
  }
}
```

Same shape with `"matcher": "Edit|Write"` on `PostToolUse` runs a lint script after edits.
Locations: `~/.claude/settings.json`, `.claude/settings.json`, `.claude/settings.local.json`, managed policy, plugin `hooks/hooks.json`, skill frontmatter (active for rest of session after invoke; `once: true` removes after first success; honored only here), subagent frontmatter (active only while subagent runs; `Stop` becomes `SubagentStop`). Hooks merge across files; the same handler in two settings files runs once.

### 1.2 Handler fields

- `type`: `command` | `http` | `mcp_tool` | `prompt` | `agent`
- Common: `if` (permission-rule syntax, tool events only, e.g. `"Bash(git *)"`; one rule per `if`), `timeout` (seconds; default 600 for command/http/mcp_tool, 30 prompt, 60 agent; 30 for command/http/mcp_tool on UserPromptSubmit, PreModelSwitch, PostModelSwitch; 10 on MessageDisplay), `statusMessage`, `once` (skill frontmatter only).
- command: `command`, `args` (exec form: no shell, each element one argv), `async`, `asyncRewake`, `shell` (`"bash"` | `"powershell"`), `onFailure` (`"continue"` | `"block"`, v2.1.295+).
- Exec form + `onFailure` example: `"command": "node", "args": ["${CLAUDE_PROJECT_DIR}/.claude/hooks/check-command.js"], "onFailure": "block"` (missing script blocks the Bash call).
- Prompt handler (hooks-guide, verbatim): `{"type": "prompt", "prompt": "Check if all tasks are complete. If not, respond with {\"ok\": false, \"reason\": \"what remains to be done\"}."}`

### 1.3 Matchers

- `"*"`, `""`, or omitted: all. Only letters, digits, `_`, `-`, space, `,`, `|`: exact string or list (`Edit|Write`, `Edit, Write`). Anything else: unanchored JavaScript regex (`Edit.*` also matches `NotebookEdit`; use `^Edit$`). FileChanged and StopFailure accept only `|` as separator.
- A `matcher` on an event without matcher support is silently ignored.

| Event(s) | Matches | Values |
| :- | :- | :- |
| PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest, PermissionDenied | tool name | `Bash`, `Edit\|Write`, `mcp__.*` |
| SessionStart | source | `startup`, `resume`, `clear`, `compact`, `fork` |
| Setup | CLI flag | `init`, `maintenance` |
| PreCompact, PostCompact | trigger | `manual`, `auto` |
| Notification | type | `permission_prompt`, `idle_prompt`, `auth_success`, `elicitation_dialog`, `elicitation_url_dialog`, `elicitation_complete`, `elicitation_response`, `agent_needs_input`, `agent_completed`, `quota_auto_resume_fired`, `quota_auto_resume_stale`, `quota_auto_resume_disabled`, `plugin_notification` |
| SubagentStart, SubagentStop | agent type | `general-purpose`, `Explore`, `Plan`, custom `name`, plugin-scoped `^my-plugin:reviewer$` |
| SessionEnd | reason | `clear`, `resume`, `logout`, `prompt_input_exit`, `other` |
| ConfigChange | source | `user_settings`, `project_settings`, `local_settings`, `policy_settings`, `skills` |
| InstructionsLoaded | load reason | `session_start`, `nested_traversal`, `path_glob_match`, `include`, `compact` |
| StopFailure | error | `rate_limit`, `overloaded`, `authentication_failed`, `billing_error`, `invalid_request`, `model_not_found`, `server_error`, `max_output_tokens`, `cloud_credential_error` (v2.1.267+), `unknown` (plus `oauth_org_not_allowed`, `account_on_hold`) |
| PreModelSwitch, PostModelSwitch | canonical model | `claude-opus-5`, `claude-opus-4-6\|claude-opus-5`, `.*opus.*` |
| FileChanged | filename | `.envrc\|.env` |
| DirectoryAdded | how | `slash_command`, `register_repo_root` |
| UserPromptExpansion | command name | your skill/command names |
| Elicitation, ElicitationResult | MCP server | configured server names |
| UserPromptSubmit, PostToolBatch, Stop, TeammateIdle, TaskCreated, TaskCompleted, WorktreeCreate, WorktreeRemove, MessageDisplay, CwdChanged | none | always fires |

Tool names for PreToolUse/PostToolUse (docs list): `Bash`, `PowerShell`, `Edit`, `Write`, `Read`, `Glob`, `Grep`, `Agent`, `Workflow`, `WebFetch`, `WebSearch`, `AskUserQuestion`, `ExitPlanMode`, `SubagentHandback`, plus MCP tools. `MultiEdit` is not in the docs. The subagent tool is `Agent` (see section 8).

MCP tool names: `mcp__<server>__<tool>`. Plugin-bundled server: `mcp__plugin_<plugin>_<server>__<tool>` (a bare server name never matches; use `mcp__plugin_<plugin>_<server>__.*`).

### 1.4 Events (33) and stdin

Groups: session `SessionStart`, `SessionEnd`; turn `UserPromptSubmit`, `Stop`, `StopFailure`; tool loop `PreToolUse`, `PermissionRequest`, `PermissionDenied`, `PostToolUse`, `PostToolUseFailure`, `PostToolBatch`; subagents `SubagentStart`, `SubagentStop`; tasks `TaskCreated`, `TaskCompleted`, `TeammateIdle`; compaction `PreCompact`, `PostCompact`; models `PreModelSwitch`, `PostModelSwitch`; other `Setup`, `UserPromptExpansion`, `Notification`, `MessageDisplay`, `InstructionsLoaded`, `ConfigChange`, `CwdChanged`, `DirectoryAdded`, `FileChanged`, `WorktreeCreate`, `WorktreeRemove`, `Elicitation`, `ElicitationResult`.

Common stdin fields (all events): `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `prompt_id` (absent before first input), `scratchpad_dir` (v2.1.257+), `permission_mode` (`default`, `plan`, `acceptEdits`, `auto`, `dontAsk`, `bypassPermissions`; the UI "Manual" arrives as `default`; not on every event), `effort` (`{"level": "low|medium|high|xhigh|max"}` on tool-context events), `agent_id` and `agent_type` (inside subagents or with `--agent`). `model` appears only on SessionStart, and only sometimes. Model-switch events use `from_model`/`to_model`. There is no `$CLAUDE_MODEL`.

PreToolUse, Bash (verbatim):
```json
{
  "session_id": "abc123",
  "prompt_id": "550e8400-e29b-41d4-a716-446655440000",
  "transcript_path": "/home/user/.claude/projects/.../transcript.jsonl",
  "cwd": "/home/user/my-project",
  "scratchpad_dir": "/tmp/claude-1000/-home-user-my-project/abc123/scratchpad",
  "permission_mode": "default",
  "hook_event_name": "PreToolUse",
  "tool_name": "Bash",
  "tool_input": {
    "command": "npm test",
    "description": "Run test suite",
    "timeout": 120000,
    "run_in_background": false
  },
  "tool_use_id": "toolu_01ABC123..."
}
```

PostToolUse, Write (verbatim; `duration_ms` is optional):
```json
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "permission_mode": "default",
  "hook_event_name": "PostToolUse",
  "tool_name": "Write",
  "tool_input": {
    "file_path": "/path/to/file.txt",
    "content": "file content"
  },
  "tool_response": {
    "filePath": "/path/to/file.txt",
    "type": "create"
  },
  "tool_use_id": "toolu_01ABC123...",
  "duration_ms": 12
}
```

SessionStart resume stdin adds `source: "resume"`, `model`, and `seconds_since_last_response`, `context_tokens`, `prompt_cache_likely_expired`, `estimated_cache_write_usd` (v2.1.251+).
SessionStart: `source` (`startup`|`resume`|`clear`|`compact`|`fork`), `model` (optional), `agent_type` (with `--agent`), `session_title` (custom title only). The four `seconds_since_last_response`, `context_tokens`, `prompt_cache_likely_expired`, `estimated_cache_write_usd` fields appear only on resume/fork (v2.1.251+).

Per-event extra fields (exact names):
- Setup: `trigger` (`init` | `maintenance`)
- InstructionsLoaded: `file_path`, `memory_type` (`User|Project|Local|Managed`), `load_reason`, `globs`, `trigger_file_path`, `parent_file_path`
- UserPromptSubmit: `prompt`, `session_title`. Cannot rewrite the prompt.
- UserPromptExpansion: `expansion_type` (`slash_command`|`mcp_prompt`), `command_name`, `command_args`, `command_source`, `prompt`
- MessageDisplay: `turn_id`, `message_id`, `index`, `final`, `delta`
- PreToolUse: `tool_name`, `tool_input`, `tool_use_id`; MCP tools add `mcp_server: {name, source}`
- PermissionRequest: `tool_name`, `tool_input`, `permission_suggestions` (no `tool_use_id`)
- PermissionDenied: `tool_name`, `tool_input`, `tool_use_id`, `reason`
- PostToolUse: `tool_name`, `tool_input`, `tool_response`, `tool_use_id`, `duration_ms`
- PostToolUseFailure: `tool_name`, `tool_input`, `tool_use_id`, `error` (string), `is_interrupt`, `duration_ms`
- PostToolBatch: `tool_calls[]` of `{tool_name, tool_input, tool_use_id, tool_response}`
- Notification: `message`, `title` (opt), `notification_type`
- SubagentStart: `agent_id`, `agent_type`
- SubagentStop: `stop_hook_active`, `agent_id`, `agent_type`, `agent_transcript_path`, `last_assistant_message`, `background_tasks`, `session_crons`
- Stop: `stop_hook_active`, `last_assistant_message`, `background_tasks`, `session_crons`
- StopFailure: `error` (type), `error_details` (opt), `last_assistant_message` (the API error text)
- TaskCreated / TaskCompleted: `task_id`, `task_subject`, `task_description` (opt), `teammate_name` (opt), `team_name` (deprecated)
- TeammateIdle: `teammate_name`, `team_name` (deprecated)
- ConfigChange: `source`, `file_path` (opt)
- CwdChanged: `old_cwd`, `new_cwd`
- DirectoryAdded: `directory`, `source` (`slash_command` | `register_repo_root`)
- FileChanged: `file_path`, `event` (`change` | `add` | `unlink`)
- WorktreeCreate: `name`; WorktreeRemove: `worktree_path`
- PreCompact: `trigger` (`manual|auto`), `custom_instructions` (null for auto). PostCompact: `trigger`, `compact_summary`
- PreModelSwitch / PostModelSwitch: `from_model`, `to_model`, `requested_model`, `source` (`command|picker|sdk`; Post adds `auto`, `resume`), `context_tokens`, `prompt_cache_warm`, `cache_ttl`, `estimated_cache_write_usd`, `pricing`
- SessionEnd: `reason` (`clear|resume|logout|prompt_input_exit|other`)
- Elicitation: `mcp_server_name`, `message`, `mode`, `url`, `elicitation_id`, `requested_schema`. ElicitationResult: `mcp_server_name`, `action`, `mode`, `elicitation_id`, `content`

### 1.5 Exit codes

- 0: success. Stdout is parsed as JSON only if it is exactly one JSON object; otherwise it is plain text. Plain stdout becomes context only on UserPromptSubmit, UserPromptExpansion, SessionStart, PostModelSwitch. stderr is hidden unless debug logging is on.
- 2: blocking error. stderr is the reason. Honored only on events that can block (below). On PostToolUse and PostToolUseFailure it shows stderr to Claude (the tool already ran).
- Any other code, including 1: non-blocking error. The action proceeds unless `onFailure: "block"`.
- Blocks on exit 2: PreToolUse (tool), UserPromptSubmit (prompt), UserPromptExpansion, Stop and SubagentStop (keeps working), TeammateIdle, TaskCreated (rollback), TaskCompleted, ConfigChange (except policy_settings), PreCompact, PreModelSwitch, Elicitation (declines), ElicitationResult, PostToolBatch (stops loop), WorktreeCreate and WorktreeRemove (any non-zero).
- Does not block: PermissionRequest (use decision object), PostToolUse, PostToolUseFailure, PermissionDenied, Notification, SubagentStart, SessionStart, Setup, SessionEnd, CwdChanged, DirectoryAdded, FileChanged, PostCompact, PostModelSwitch, InstructionsLoaded, StopFailure, MessageDisplay.
- `onFailure: "block"`: a hook that cannot start, times out, returns non-2xx (HTTP), or prints invalid JSON blocks the action. No effect on Stop, SubagentStop, TaskCompleted, TeammateIdle, or async hooks.

### 1.6 JSON output

Universal fields:
- `continue` (default true): `false` stops Claude; message in `stopReason`.
- `suppressOutput`: accepted, has NO effect.
- `systemMessage`: warning shown to the user (discarded by Notification, PreCompact, PostCompact, SessionEnd, Setup).
- `terminalSequence`: OSC 0/1/2/9/99/777 or BEL only (desktop notifications, titles). Interactive sessions only.
- Each string (`additionalContext`, `systemMessage`, `initialUserMessage`, plain stdout) is capped at 10,000 chars.

Top-level `decision` (no hookSpecificOutput), used by UserPromptSubmit, UserPromptExpansion, PostToolUse, PostToolUseFailure, PostToolBatch, Stop, SubagentStop, ConfigChange, PreCompact, TaskCreated. Only value: `"block"`.
```json
{
  "decision": "block",
  "reason": "Test suite must pass before proceeding"
}
```

`hookSpecificOutput` requires `hookEventName`. PreToolUse decision (verbatim allow example below; deny is `{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "..."}}`):- `permissionDecision`: `allow` | `deny` | `ask` | `defer` (defer only with `-p`). Deny/ask rules in settings still apply. Precedence across hooks: deny > defer > ask > allow.
- `updatedInput`: replaces the whole input object (pair with `allow`). AskUserQuestion and ExitPlanMode need `updatedInput` plus `allow`.
- `additionalContext`: added next to the tool result.
- Deprecated: top-level `decision`/`reason` for PreToolUse; `approve` = `allow`, `block` = `deny`.

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow",
    "permissionDecisionReason": "My reason here",
    "updatedInput": {
      "field_to_modify": "new value"
    },
    "additionalContext": "Current environment: production. Proceed with caution."
  }
}
```

PostToolUse: `additionalContext`, `updatedToolOutput` (replaces what Claude sees; the tool already ran), `classifierContext` (v2.1.236+), `updatedMCPToolOutput` (MCP only, older). Verbatim:
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "This file is generated. Edit src/schema.ts and run `bun generate` instead."
  }
}
```
`updatedToolOutput` example (docs): `{"hookSpecificOutput": {"hookEventName": "PostToolUse", "updatedToolOutput": {"stdout": "[redacted]", "stderr": "", "interrupted": false, "isImage": false}}}` (must match the tool's output shape).

Stop and SubagentStop (verbatim, both forms):
```json
{
  "decision": "block",
  "reason": "Must be provided when Claude is blocked from stopping"
}
```
```json
{
  "hookSpecificOutput": {
    "hookEventName": "Stop",
    "additionalContext": "Please run the test suite before finishing"
  }
}
```
Continuation cap: 8 consecutive stop-hook continuations (`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` raises it). Check `stop_hook_active`.

SessionStart (verbatim): additional fields `initialUserMessage` (first turn, `-p` mode), `watchPaths` (absolute paths for FileChanged), `sessionTitle`, `reloadSkills` (bool).
```json
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "Current branch: feat/auth-refactor\nUncommitted changes: src/auth.ts, src/login.tsx\nActive issue: #4211 Migrate to OAuth2",
    "sessionTitle": "auth-refactor"
  }
}
```

UserPromptSubmit (verbatim):
```json
{
  "decision": "block",
  "reason": "Explanation for decision",
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "My additional context here",
    "sessionTitle": "My session title",
    "suppressOriginalPrompt": true
  }
}
```

SubagentStart (verbatim): `{"hookSpecificOutput": {"hookEventName": "SubagentStart", "additionalContext": "Follow security guidelines for this task"}}`

Other decisions (summary):
- PermissionRequest: `hookSpecificOutput.decision = {"behavior": "allow"|"deny", "updatedInput": {...}}`. Exit 2 not honored.
- PermissionDenied: `hookSpecificOutput.retry: true` lets the model retry.
- Elicitation / ElicitationResult: `action` (`accept|decline|cancel`), `content`.
- MessageDisplay: `displayContent` replaces on-screen text only.
- WorktreeCreate: command hook prints the path on stdout; HTTP hook returns `hookSpecificOutput.worktreePath`.
- PreModelSwitch: `permissionDecision` (`allow|deny|ask`) or top-level `decision: "block"`.
- Context-only: SessionStart, SubagentStart, PostModelSwitch. No decision: Setup, Notification, SessionEnd, PostCompact, InstructionsLoaded, StopFailure, CwdChanged, DirectoryAdded, FileChanged.

### 1.7 Environment variables for hooks

- `CLAUDE_PROJECT_DIR`: project root where the session started (stays put in worktrees). Also set for stdio MCP servers and plugin LSP servers.
- `CLAUDE_PLUGIN_ROOT`: plugin install dir. `CLAUDE_PLUGIN_DATA`: persistent per-plugin data dir (`~/.claude/plugins/data/<id>/`). `CLAUDE_PLUGIN_OPTION_<KEY>`: each userConfig value. Set for plugin hook commands.
- `CLAUDE_ENV_FILE`: ONLY for SessionStart, Setup, CwdChanged, FileChanged. Append `export NAME=value` lines (`>>`); they persist into later Bash commands.
- `CLAUDE_EFFORT`: effort level, also visible to the Bash tool. `CLAUDE_CODE_REMOTE`: `"true"` in web sessions only.
- Hook processes inherit the environment except `OTEL_*` exporter variables.
- Placeholders `${CLAUDE_PROJECT_DIR}`, `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}` are substituted inline in `command` and `args`.

Exit-2 pattern (docs): read stdin JSON with `jq -r '.tool_input.command'`, `echo ... >&2; exit 2` to block, `exit 0` otherwise.

---

## 2. SETTINGS (settings.md, settings-reference.md)

| Scope | File | Shared |
| :- | :- | :- |
| User | `~/.claude/settings.json` | no |
| Project shared | `.claude/settings.json` | yes (commit) |
| Project local | `.claude/settings.local.json` | no (gitignored when Claude Code creates it) |
| Managed | `managed-settings.json`, MDM, server-managed | org-wide |

Precedence, highest first: managed > command line (`--settings <file-or-json>`, session only) > project local > project shared > user. Hooks and permission rules merge across files. Environment variables are not a level: they are decided per pair (e.g. `ANTHROPIC_MODEL` beats `model`).

Untrusted folders: `permissions.allow`, `extraKnownMarketplaces`, and most `env` values in `.claude/settings.json` apply only after the workspace trust dialog is accepted. `-p` runs in untrusted folders ignore `extraKnownMarketplaces` without a message.

`mcpServers` is NOT a settings key. MCP config lives in `.mcp.json` (project), `~/.claude.json` (user, local), plugin `.mcp.json`, or managed config. Related keys: `enableAllProjectMcpServers`, `enabledMcpjsonServers`, `disabledMcpjsonServers`, `allowedMcpServers`, `deniedMcpServers`.

`statusLine` example (same as section 3 config): `{"statusLine": {"type": "command", "command": "~/.claude/statusline.sh", "padding": 2}}`.`statusLine`: `type` must be `"command"`; `command` (shell string or path); `padding` (chars, default 0); `refreshInterval` (seconds, min 1); `hideVimModeIndicator` (bool). Unset = no status line.

```json
{
  "permissions": {
    "allow": ["Bash(npm run *)"],
    "ask": ["Bash(git push *)"],
    "deny": ["Read(./.env)"],
    "defaultMode": "acceptEdits"
  }
}
```
Other keys: `additionalDirectories`, `blockReadsOutsideWorkingDirectories`, `disableBypassPermissionsMode`, `disableAutoMode`.

```json
{
  "env": {
    "DISABLE_AUTO_COMPACT": "1",
    "ANTHROPIC_BASE_URL": "https://proxy.example.com"
  }
}
```
String values; `""` cancels a shell export.

```json
{
  "enabledPlugins": {
    "code-formatter@team-tools": true,
    "deployment-tools@team-tools": true,
    "experimental-features@personal": false
  }
}
```
Key = `plugin-name@marketplace-name`. Unset = plugin's `defaultEnabled`. `/plugin` and `claude plugin enable|disable` write it.

```json
{
  "extraKnownMarketplaces": {
    "acme-tools": {
      "source": {
        "source": "github",
        "repo": "acme-corp/claude-plugins"
      }
    },
    "security-plugins": {
      "source": {
        "source": "git",
        "url": "https://git.example.com/security/plugins.git"
      }
    }
  }
}
```
Optional `autoUpdate: true` per marketplace. An enabled plugin in a project file does not install it for teammates; each user installs it.

Hooks key (settings-reference, summary): object keyed by event, each value an array of `{ "matcher", "hooks" }` groups. `subagentStatusLine` (section 3). `pluginConfigs` holds per-plugin userConfig `options`. Also: `disableAllHooks`, `allowManagedHooksOnly`, `allowedHttpHookUrls`, `strictKnownMarketplaces`, `blockedMarketplaces`, `strictPluginOnlyCustomization`.

---

## 3. STATUS LINE (statusline.md)

Config (verbatim):
```json
{
  "statusLine": {
    "type": "command",
    "command": "~/.claude/statusline.sh",
    "padding": 2
  }
}
```
Inline form (verbatim): `"command": "jq -r '\"[\\(.model.display_name)] \\(.context_window.used_percentage // 0)% context\"'"`

Full stdin JSON (verbatim, docs "Full JSON schema"):
```json
{
  "cwd": "/current/working/directory",
  "session_id": "abc123...",
  "session_name": "my-session",
  "prompt_id": "550e8400-e29b-41d4-a716-446655440000",
  "transcript_path": "/path/to/transcript.jsonl",
  "model": {
    "id": "claude-opus-5-5",
    "display_name": "Opus"
  },
  "workspace": {
    "current_dir": "/current/working/directory",
    "project_dir": "/original/project/directory",
    "added_dirs": [],
    "git_worktree": "feature-xyz",
    "repo": {
      "host": "github.com",
      "owner": "anthropics",
      "name": "claude-code"
    }
  },
  "version": "2.1.90",
  "output_style": {
    "name": "default"
  },
  "cost": {
    "total_cost_usd": 0.01234,
    "total_duration_ms": 45000,
    "total_api_duration_ms": 2300,
    "total_lines_added": 156,
    "total_lines_removed": 23
  },
  "context_window": {
    "total_input_tokens": 15500,
    "total_output_tokens": 1200,
    "context_window_size": 200000,
    "used_percentage": 8,
    "remaining_percentage": 92,
    "current_usage": {
      "input_tokens": 8500,
      "output_tokens": 1200,
      "cache_creation_input_tokens": 5000,
      "cache_read_input_tokens": 2000
    }
  },
  "exceeds_200k_tokens": false,
  "prompt_cache": {
    "warm": true,
    "caching_observed": true,
    "ttl": "1h",
    "expires_at": 1738429200,
    "requests": 14,
    "misses": 2,
    "expected_rebuilds": 1,
    "hit_ratio": 0.91,
    "cache_write_tokens": 352000,
    "miss_recache_tokens": 310200,
    "last_miss_at": 1738425230,
    "last_miss_cause": {
      "causes": ["tools_changed"],
      "tools_added": 2,
      "tools_removed": 0
    },
    "miss_causes": {
      "tools_changed": 2
    },
    "recache_tokens_if_cold": 45000
  },
  "fast_mode": false,
  "effort": {
    "level": "high"
  },
  "thinking": {
    "enabled": true
  },
  "rate_limits": {
    "five_hour": {
      "used_percentage": 23.5,
      "resets_at": 1738425600
    },
    "seven_day": {
      "used_percentage": 41.2,
      "resets_at": 1738857600
    },
    "spend_limit": {
      "used_percentage": 62.8,
      "resets_at": 1740787200,
      "used_usd": 314.12,
      "limit_usd": 500,
      "period": "monthly"
    }
  },
  "vim": {
    "mode": "NORMAL"
  },
  "agent": {
    "name": "security-reviewer"
  },
  "pr": {
    "number": 1234,
    "url": "https://github.com/anthropics/claude-code/pull/1234",
    "review_state": "pending"
  },
  "worktree": {
    "name": "my-feature",
    "path": "/path/to/.claude/worktrees/my-feature",
    "branch": "worktree-my-feature",
    "original_cwd": "/path/to/project",
    "original_branch": "main"
  }
}
```

Field notes:
- Model: `model.id`, `model.display_name`.
- Directory: `workspace.current_dir` (preferred) = `cwd`; `workspace.project_dir` is the launch dir.
- Cost: `cost.total_cost_usd` (list-price estimate unless `modelPricing` set), `cost.total_duration_ms`, `cost.total_api_duration_ms`, `cost.total_lines_added`, `cost.total_lines_removed`.
- Context: `context_window.context_window_size` (200000, or 1000000 for extended); `context_window.used_percentage` and `remaining_percentage` (may be null early); `context_window.total_input_tokens` and `total_output_tokens` (current window, most recent response); `context_window.current_usage.{input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens}` (null before first call and after /compact).
- `used_percentage` = input + cache_creation + cache_read (output excluded). `exceeds_200k_tokens` uses a fixed 200k threshold.
- Other: `session_id`, `session_name` (custom or AI title; absent otherwise), `transcript_path`, `version`, `output_style.name`, `effort.level`, `thinking.enabled`, `fast_mode`, `vim.mode`, `agent.name`, `pr.*`, `worktree.*`, `prompt_cache.*`.
- `rate_limits.*` appears only for claude.ai Pro/Max or gateway spend limits; each window may be absent. Use `jq -r '.rate_limits.five_hour.used_percentage // empty'`.

Update timing and caching:
- Runs at session start (including resume), after each new assistant message, after `/compact`, on permission-mode change, on vim toggle, when `command` changes, when a rate-limit window hits `resets_at`, and when a warm prompt cache hits `expires_at`.
- Debounced 300 ms; a new trigger cancels the running script. A `command` change runs immediately.
- `refreshInterval` (seconds, min 1) adds a fixed timer, needed for clocks or idle sessions with background subagents.
- No built-in caching: cache expensive calls in your own script.
- Runs locally, no API tokens. Read `COLUMNS` and `LINES` for width (`tput cols` does not work). ANSI colors and OSC 8 links work.
- Blank until workspace trust is accepted (`claude --debug` logs `Status line command skipped: workspace trust not accepted`).

subagentStatusLine (verbatim):
```json
{
  "subagentStatusLine": {
    "type": "command",
    "command": "~/.claude/subagent-statusline.sh"
  }
}
```
Stdin: base hook fields plus `columns` and `tasks[]`. Stdout: one line per overridden row, `{"id": "<task id>", "content": "<row body>"}`. Plugins can ship a default `subagentStatusLine` in `settings.json`, but cannot set the main `statusLine`.

---

## 4. SKILLS AND COMMANDS (skills.md)

Locations:

| Location | Path | Scope |
| :- | :- | :- |
| Personal | `~/.claude/skills/<skill-name>/SKILL.md` | all projects on this machine |
| Project | `.claude/skills/<skill-name>/SKILL.md` | this repo (commit it) |
| Nested | `<subdir>/.claude/skills/<skill-name>/SKILL.md` | sessions in or below `<subdir>` |
| Plugin | `<plugin>/skills/<skill-name>/SKILL.md` | where enabled, as `/plugin-name:skill-name` |
| Plugin root | `<plugin>/SKILL.md` | one skill; set `name` |
| Legacy command | `.claude/commands/<name>.md`, plugin `commands/<name>.md` | still works; skills supersede |

Reserved: a skill folder named `synced`; `anthropic-skills` outside plugins.

Frontmatter (verbatim example from docs):
```yaml
---
name: my-skill
description: What this skill does
disable-model-invocation: true
allowed-tools: Read Grep
---

Your skill instructions here...
```

All fields optional; `description` recommended. Names must match exactly (unknown fields ignored silently).
- `name`: command name (default: directory). In a plugin skill it replaces the last segment only.
- `description`: when to use it; truncated at 1,536 chars with `when_to_use` in the listing.
- `when_to_use`: extra trigger text. `argument-hint`: autocomplete hint, e.g. `[issue-number]`. `arguments`: names for `$name` substitution.
- `disable-model-invocation`: `true` = user-only (also blocks subagent preload and scheduled runs). Default false.
- `user-invocable`: `false` = hidden from `/` menu, Claude-only. Default true.
- `allowed-tools`: pre-approved tools for the invoking turn; space/comma string or list; e.g. `Bash(${CLAUDE_SKILL_DIR}/scripts/render.sh *)`.
- `disallowed-tools`: removed from the pool while active.
- `model` (or `inherit`), `effort` (`low|medium|high|xhigh|max`).
- `context: fork` runs in a subagent; `agent` picks its type (e.g. `Explore`); `background` (default true with fork).
- `hooks`: hooks registered on invoke (section 1 format).
- `paths`: globs limiting auto-activation (skills only; not command files).
- `shell`: `bash` (default) or `powershell` for `` !`cmd` `` blocks.
- `metadata`, `license`, `compatibility`: accepted, not acted on.
- Command files accept the same fields except `name` and `paths`.

Naming: personal/project skill -> `/<dir-or-name>`. Plugin skill `my-plugin/skills/review/SKILL.md` -> `/my-plugin:review`; with `name: fancy` -> `/my-plugin:fancy`. Command `.claude/commands/frontend/component.md` -> `/frontend:component`. Plugin command `commands/db/migrate.md` -> `/my-plugin:db:migrate`.

Substitutions:
- `$ARGUMENTS` (full string; if no placeholder receives args, Claude Code appends `ARGUMENTS: <value>`), `$ARGUMENTS[N]` or `$N` (0-based, shell quoting), `$name` (from `arguments`).
- `${CLAUDE_SKILL_DIR}` (skill folder; works in content and allowed-tools), `${CLAUDE_SESSION_ID}`, `${CLAUDE_EFFORT}`, `${CLAUDE_PROJECT_DIR}`.
- `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`: plugin skills only.
- Escape a literal dollar with a backslash: `\$1.00`.

Verbatim `$ARGUMENTS` skill:
```yaml
---
name: fix-issue
description: Fix a GitHub issue
disable-model-invocation: true
---

Fix GitHub issue $ARGUMENTS following our coding standards.
```

Verbatim positional skill:
```yaml
---
name: migrate-component
description: Migrate a component from one language to another
---

Migrate the $ARGUMENTS[0] component from $ARGUMENTS[1] to $ARGUMENTS[2].
Preserve all existing behavior and tests.
```

Dynamic context: `` !`<command>` `` runs before Claude sees the content; output replaces the placeholder (the docs' `pr-summary` example uses `context: fork`, `agent: Explore`, `allowed-tools: Bash(gh *)`, and `` !`gh pr diff` ``). Not run for claude.ai-synced skills, or when a hook blocks the prompt.

Skill/agent frontmatter `hooks:` uses the section 1.1 shape in YAML (for example `hooks: {PreToolUse: [{matcher: "Bash", hooks: [{type: command, command: "./scripts/security-check.sh"}]}]}`).

---

## 5. SUBAGENTS (sub-agents.md)

Locations (1 = highest priority): 1 managed settings (org); 2 `--agents '<json>'` (session); 3 `.claude/agents/<name>.md` (project); 4 `~/.claude/agents/<name>.md` (all projects); 5 plugin `agents/` (where enabled). Project and user dirs scan subfolders; identity is the frontmatter `name`, not the filename.

Verbatim example:
```markdown
---
name: code-reviewer
description: Reviews code for quality and best practices
tools: Read, Glob, Grep
model: sonnet
---

You are a code reviewer. When invoked, analyze the code and provide
specific, actionable feedback on quality, security, and best practices.
```

Frontmatter (only `name` and `description` required; camelCase exact):
- `name`: unique, <= 256 chars, no `:`, no leading `-`.
- `description`: when to delegate. Combined descriptions over 15,000 tokens trigger a warning.
- `tools`: comma string or list; inherits all if omitted. `disallowedTools`: removed from that list.
- `model`: `sonnet`, `opus`, `haiku`, `fable`, a full model ID, or `inherit`.
- `permissionMode`: `default`, `acceptEdits`, `auto`, `dontAsk`, `bypassPermissions`, `plan`, or `manual` (alias of default). Ignored for plugin agents.
- `maxTurns`, `autoCompactWindow` (100000-1000000, v2.1.296+), `effort` (`low|medium|high|xhigh|max`), `background`, `omitClaudeMd` (v2.1.271+).
- `skills` (preload full content), `mcpServers` (names or inline configs), `hooks` (scoped). `mcpServers` and `hooks` are ignored for plugin agents.
- `memory`: `user`, `project`, or `local`. `isolation`: `worktree` only. `color`: `red|blue|green|yellow|purple|orange|pink|cyan`. `initialPrompt`: first turn when run via `--agent`.
- `experimental.cacheTtl`: `5m` or `1h` (nested under `experimental`).

Plugin agents: `permissionMode`, `hooks`, `mcpServers`, `initialPrompt` are ignored. Ship hooks in `hooks/hooks.json` and MCP in `.mcp.json`. Plugin agent name is `<plugin>:<name>`; `agents/review/security.md` -> `my-plugin:review:security`. Invoke with `@agent-<plugin>:<name>`.

Tool rename: the subagent tool is `Agent` (renamed from `Task` in v2.1.63; `Task(...)` in settings and agent definitions still works as an alias). Agent tool input: `prompt`, `description`, `subagent_type`, `model`. SubagentStart/SubagentStop matchers match the agent type string.

---

## 6. MCP (mcp.md)

Scopes:

| Scope | Stored in | Shared |
| :- | :- | :- |
| local (default) | `~/.claude.json` under `projects[<path>]` | no |
| project | `.mcp.json` at project root | yes (approval prompt in interactive use) |
| user | `~/.claude.json` | no |

Precedence (whole entry, no field merge): local > project > user > plugin > claude.ai connectors.

Project `.mcp.json` (verbatim, docs):
```json
{
  "mcpServers": {
    "shared-server": {
      "type": "http",
      "url": "https://example.com/mcp"
    }
  }
}
```

stdio fields: `command`, `args`, `env` (add-json form also takes `"type":"stdio"`). Example (verbatim, plugin `.mcp.json`):
```json
{
  "mcpServers": {
    "database-tools": {
      "command": "${CLAUDE_PLUGIN_ROOT}/servers/db-server",
      "args": ["--config", "${CLAUDE_PLUGIN_ROOT}/config.json"],
      "env": {
        "DB_URL": "${DB_URL}"
      }
    }
  }
}
```

Env expansion: `${VAR}` and `${VAR:-default}` in `command`, `args`, `env`, `url`, `headers`. Verbatim:
```json
{
  "mcpServers": {
    "api-server": {
      "type": "http",
      "url": "${API_BASE_URL:-https://api.example.com}/mcp",
      "headers": {
        "Authorization": "Bearer ${API_KEY}"
      }
    }
  }
}
```
`${CLAUDE_PROJECT_DIR}` is set in stdio servers' environment, so in user/local/project config write `${CLAUDE_PROJECT_DIR:-.}`. Plugin `.mcp.json` substitutes it directly.

CLI: `claude mcp add --transport http stripe https://mcp.stripe.com` (local); `claude mcp add --transport http shared-server --scope project https://example.com/mcp`; `claude mcp add --env KEY=val --transport stdio airtable -- npx -y airtable-mcp-server` (`--` separates Claude's flags from the server command); `claude mcp add-json <name> '<json>'`.

Plugin-bundled MCP: `.mcp.json` at plugin root (the `mcpServers` wrapper is optional here), or the `mcpServers` manifest key (inline map, `.json` path, `.mcpb`/`.dxt` bundle path, or https bundle URL). Manifest entries replace same-name `.mcp.json` entries. Plugin servers start when the plugin is enabled. Tool names are `mcp__plugin_<plugin>_<server>__<tool>`; `/mcp` shows `plugin:<plugin>:<server>`. Plugin stdio processes get `CLAUDE_PLUGIN_ROOT` and `CLAUDE_PLUGIN_DATA`.

---

## 7. PLUGINS, MARKETPLACES, CLI (plugins/*)

### 7.1 Layout

```
my-plugin/
  .claude-plugin/plugin.json   manifest (optional; only file in this dir)
  skills/<name>/SKILL.md       skills
  commands/<name>.md           legacy commands (prefer skills/)
  agents/<name>.md             subagents
  hooks/hooks.json             hooks (wrapper key "hooks")
  .mcp.json                    MCP servers
  .lsp.json                    LSP servers
  output-styles/  themes/  monitors/monitors.json  bin/  settings.json
```
Everything except plugin.json goes at the plugin root. `bin/` files go on the Bash tool's PATH. A `CLAUDE.md` at the plugin root is not loaded.

### 7.2 plugin.json (verbatim, docs)

```json
{
  "name": "deploy-tools",
  "displayName": "Deploy Tools",
  "version": "1.2.0",
  "description": "Deployment commands, a review agent, and a status monitor",
  "author": {
    "name": "Example Team",
    "email": "dev@example.com",
    "url": "https://example.com"
  },
  "homepage": "https://example.com/docs/deploy-tools",
  "repository": "https://github.com/example/deploy-tools",
  "license": "MIT",
  "keywords": ["deployment", "ci"],
  "defaultEnabled": true,
  "dependencies": ["secrets-vault"],
  "metadata": { "catalogId": "cat-123" },
  "skills": ["./extra-skills/"],
  "commands": {
    "status": {
      "source": "./commands/status.md",
      "description": "Show the current deployment status"
    },
    "about": {
      "content": "Explain what the deploy-tools plugin provides.",
      "description": "Describe this plugin"
    }
  },
  "agents": ["./agents/reviewer.md"],
  "hooks": "./config/extra-hooks.json",
  "mcpServers": {
    "deploy-api": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/server.js"]
    }
  },
  "lspServers": "./.lsp.json",
  "outputStyles": "./styles/",
  "experimental": {
    "themes": "./themes/",
    "monitors": "./config/monitors.json"
  },
  "userConfig": {
    "api_token": {
      "type": "string",
      "title": "API token",
      "description": "Token for the deployment API",
      "sensitive": true
    }
  }
}
```

Rules:
- `name`: the only required key. kebab-case; no spaces, `@`, `:`. Prefixes `claude-`, `anthropic-`, `anthropics-`, `cc-plugin-` fail validation.
- `version`: free string, pins the install. `author.name` required if author is set. `homepage` must parse as a URL.
- `settings`: only `agent` and `subagentStatusLine` take effect.
- Component paths must start with `./` and stay inside the plugin root.
- Replace default folder: `commands`, `agents`, `outputStyles`, `workflows`, `experimental.themes`, `experimental.monitors`. Add to default: `skills`. Merge with default file: `hooks`, `mcpServers`, `lspServers`.
- Top-level `themes`/`monitors` still load with a warning; use `experimental.*`. Unknown top-level keys are stripped with a warning; unknown keys inside `userConfig` are errors.

### 7.3 hooks/hooks.json (verbatim, docs)

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "\"${CLAUDE_PLUGIN_ROOT}/scripts/format.sh\""
          }
        ]
      }
    ]
  }
}
```
The `"hooks"` wrapper is required in the file. An inline `hooks` manifest value takes the event map directly, with no wrapper.

### 7.4 marketplace.json (verbatim, docs)

Path: `<marketplace-root>/.claude-plugin/marketplace.json`. Relative sources resolve from the root, the directory that contains `.claude-plugin/`.

```json
{
  "name": "my-marketplace",
  "description": "Plugins for my team",
  "owner": {
    "name": "Your Name"
  },
  "plugins": [
    {
      "name": "my-first-plugin",
      "source": "./plugins/my-first-plugin",
      "description": "A greeting plugin to learn the basics"
    }
  ]
}
```

- Required: `name`, `owner` (`name` required; `email`, `url` optional), `plugins`. Optional: `$schema`, `description`, `version`, `metadata.pluginRoot`, `forceRemoveDeletedPlugins`, `allowCrossMarketplaceDependenciesOn`, `renames`.
- Marketplace name: letters, digits, `.`, `_`, `-`. Reserved names include `claude-plugins-official`, `anthropic-marketplace`, `claude-code-plugins`, `agent-skills`; `github`, `npm`, `pip`, `uv`, `cargo`, `gh` in any casing.
- Entry fields: `name` and `source` required. Also `description`, `version`, `category`, `tags`, `strict` (default true), `relevance`, `dependencies`, `defaultEnabled`, `displayName`, `metadata`, `headers`, `headersHelper`. Any plugin.json field is accepted too.
- Entry `hooks` must be an inline object mapping events to matcher arrays; a file path there is unsupported.
- `strict: true` (default): entry `commands`/`agents`/`skills`/`outputStyles`/`themes` are appended to plugin.json. `strict: false` with both sources declaring components is a load error.
- Entry `mcpServers`, `lspServers`, `userConfig`, `channels` are ignored when the plugin has a plugin.json; declare them there.

Plugin entry `source` forms:
- relative path: `"./plugins/my-first-plugin"` (must start `./`; no `..`)
- github: `{ "source": "github", "repo": "your-org/my-first-plugin" }` (+ `ref`, `sha`)
- git-subdir: `{ "source": "git-subdir", "url": "your-org/monorepo", "path": "tools/my-first-plugin" }` (+ `ref`, `sha`)
- url (git repo), npm (`package`, `version`, `registry`), archive (`url`, `sha256`, v2.1.224+), command (`command`, `timeout`, `mode`, v2.1.229+)

Marketplace add accepts: `owner/repo`, `owner/repo#ref`, `owner/repo@ref`, `user@host:path` (SSH), a `.git` or github/gitlab HTTPS URL (git), another `https://` URL (a marketplace.json), `./path` or `/path` (directory), or a `.json` file path.

### 7.5 CLI and in-session commands

Build and test a marketplace (docs walkthrough, verbatim commands):
```bash
mkdir -p my-marketplace/.claude-plugin my-marketplace/plugins
cp -r my-first-plugin my-marketplace/plugins/
claude plugin validate ./my-marketplace/plugins/my-first-plugin
claude plugin validate ./my-marketplace
claude plugin marketplace add ./my-marketplace
claude plugin install my-first-plugin@my-marketplace
claude plugin list
claude plugin details my-first-plugin
```

Share from GitHub: `claude plugin marketplace add your-org/your-marketplace --scope project` then `claude plugin install formatter@my-marketplace --scope project`.
Teammates run `claude plugin marketplace add <owner>/<repo>`. Equivalent in session: `/plugin marketplace add owner/repo`, `/plugin install name@marketplace`.

- `claude plugin install <plugin>@<marketplace> [-s user|project|local] [-y] [--json] [--marketplace <source>]` (`--marketplace` v2.1.292+). Install takes `name@marketplace`, not a path.
- `claude plugin validate <path> [--strict] [--json]`: exit 0 `Validation passed` (or with warnings); 1 failed (or a warning under `--strict`); 2 unexpected error. Given a directory, it validates marketplace.json if present, else plugin.json, else the skills/agents/commands folders.
- `claude plugin marketplace list|update [name]|remove <name>`.
- `claude plugin list|details|enable|disable|update|uninstall|configure|tag`.
- `claude plugin init <name> [--with skills agents hooks mcp lsp output-style channel] [--description] [--author]` scaffolds to `~/.claude/skills/<name>/` and loads as `<name>@skills-dir`.
- Local test without install: `claude --plugin-dir ./my-plugin` (repeatable; also `.zip`; `--plugin-url`). Session-only plugins show as `<name>@inline`. Edits to loaded plugins need `/reload-plugins`.
- In session: `/plugin` (panel), `/plugin validate <path>`, `/reload-plugins`.

---

## 8. DEPRECATED, RENAMED, SURPRISES

1. Subagent tool is `Agent` (renamed from `Task` in 2.1.63; `Task(...)` still aliases). Task-list tools are `TaskCreate`, `TaskGet`, `TaskList`, `TaskUpdate`.
2. Commands are superseded by skills. Plugin `commands/` still loads.
3. PreToolUse top-level `decision`/`reason` are deprecated; use `hookSpecificOutput.permissionDecision` (`approve` = allow, `block` = deny).
4. `suppressOutput` has no effect.
5. Exit 1 is non-blocking. Exit 2 blocks.
6. `allowedPrompts` in ExitPlanMode input is ignored. `team_name` (TaskCreated, TaskCompleted, TeammateIdle) is deprecated.
7. SessionEnd reason `bypass_permissions_disabled` was removed (v2.1.234).
8. Plugins cannot set `statusLine`; only `agent` and `subagentStatusLine` from plugin settings.
9. `mcpServers` is not a settings.json key.
10. `$CLAUDE_MODEL` does not exist. Use `model` (SessionStart) or `to_model` (model-switch hooks).
11. Plugin agents ignore `permissionMode`, `hooks`, `mcpServers`, `initialPrompt`.
12. Plugin hook files need the `"hooks"` wrapper; inline manifest hooks do not.
13. `CLAUDE.md` at a plugin root is not loaded. Put instructions in a skill.
14. Plugin component paths must start with `./`.

Out of scope here: mods (`plugins/mods/*`), channels, monitors, LSP details, userConfig dialog, dependencies, relevance, org policy, and the hooks-guide walkthroughs.
