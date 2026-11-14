# Inbox beside Claude: the deeper task

2026-11-06. A brief, not a design: what to build, from what material, and who says it worked.

## The problem, restated

While session A works on a task, an in-scope idea B arrives. Typing B into A either
derails A or, typed mid-turn, queues into A's next turn and fills A's context anyway.
Wanted: capture B, ask B, or hand B to another session, from one screen, with A's
context untouched.

## What already exists (use before building)

| Need | Already there | Verify first |
| :-- | :-- | :-- |
| Ask a side question against A's context | `/btw <question>` (built into Claude Code 2.1.312: "Ask a quick side question without interrupting the main conversation") | `/context` before and after: the number must not move. Also: can it be typed while A is working? |
| Give a task to another session by name | `herdr agent prompt <name> "<text>"` from the Shell pane; `claude -n <name>` names a session so herdr can address it | Send to a *working* session: does herdr queue it into A's next turn? If yes, dispatch only ever targets an idle or different session |
| Start a sibling session for B | `herdr pane split --current --direction right --cwd "$PWD" --no-focus`, then `herdr agent start <name> --kind claude --pane <id> -- -n <name>` | none |
| B needs A's conversation, not just the project | `claude --resume <A's id> --fork-session -n <name>` (A's id: `herdr agent get` → `agent_session.value`) | works while A is live (the `--bg --resume` help says a running session gets a copy), and the fork writes nothing back into A |
| Fire-and-forget with no pane | `claude --bg -n <name>` with the task, later `claude attach <name>` | verify the prompt form: `-p` or a positional prompt with `--bg` was not checked |
| A pane-level counter with no TUI work | `herdr pane report-metadata <pane> --source inbox --state-label idle="inbox 3" --token inbox=3` (accepted 2026-11-06; sidebar rendering unverified) | look at the sidebar |

`/ecc:aside` runs as a prompt in the same session: its answer enters A's context.
Once `/btw` passes the context test, the Keepsake line "Quick side question mid-task:
/ecc:aside" should point at `/btw`.

## The deeper task

Separate **capture** from **dispatch**. Capture is as few keys as herdr allows, zero
decisions, append-only text. Dispatch is a later act with four routes: ask now (`/btw`), send to
a named session, spawn a session, or drop. The one screen is the Shell pane the column
already has; the inbox is a file it shows, as Roster and Keepsake are files it shows.

Build, in this order, each with its judge:

1. `park "<text>"` appends `time · cwd · text` to `~/.claude/inbox/<project>.md` (0600).
   Judge: the file gains exactly one line with time, cwd and text, its mode is 0600, and
   the Inbox view shows it at the next redraw. (Honest cost: focus the Shell pane, type,
   focus back: two herdr keybinds plus the text, not one key. A custom keybinding in
   `config.toml` that focuses the Shell pane gets it to two keys; design that later.)
2. **Inbox** view in the Shift+Tab cycle (Shell → Agents → Agent graph → Roster →
   Keepsake → Inbox), read at each redraw like the memos. Judge: the pty test in
   `viewer/shell_tabs_test.py`, one case per view, as the others have.
3. Dispatch verbs in the Shell pane, each a line of shell over the herdr commands
   above: `ask`, `send @name`, `spawn name`. Judge: `herdr agent wait <name>` observes
   `working` after a send; A's session id gains no `prompt` record.
4. Pane label `inbox N` through `pane report-metadata`, only if the sidebar renders it.

Not in scope: a new column, a new TUI, voice, a queue that auto-dispatches.

## Rawest source material

- `~/claude-journal/*.md`: 409 human prompts over 14 days. A regex for "also / by the
  way / new idea" at the start hits 21 (rough proxy, it also matches mid-sentence
  "also"). The leaks are visible; the ideas never typed are not, and only capture
  will show them.
- `~/.claude/agent-monitor/events.jsonl`: 328 `prompt` records with `session_id`,
  `cwd`, first 120 characters; `tokens` on agent stops; 42 prompt-bearing sessions,
  the longest 37 prompts.
- `~/.claude/projects/**/*.jsonl` (1.3 GB): the full transcripts, with per-request
  usage, so the context cost of each leaked prompt is computable.
- `herdr api snapshot`: the live layout. Today three Claude sessions in three
  workspaces (a work repo, a side project, this), w1G carrying two tabs with a full
  four-pane column each.

## Methods a professional would use

- **Diary study with a coding scheme.** Hand-label a two-week sample of prompts into
  four classes: on-task, side question, new task, redirect. Compute the leak rate
  (side question + new task typed into a working session) and, from the transcript
  usage, the tokens each leak added to A. That is the number nobody has yet.
- **GTD capture.** Capture must cost nothing: no choice of route at capture time
  (Hick's law), one key (Fitts). Triage happens when A is idle.
- **Job-control vocabulary.** `park`, `ask`, `send @name`, `spawn name`, as `jobs`,
  `fg`, `bg`, `%1`. Sessions get names (`claude -n`) so they can be addressed.
- **Self A/B.** One week without capture, one with. Compare leak rate, `/compact`
  count per session, and ideas captured per day.
- **Instrument, do not ask.** The journal hook already records every prompt; the
  park command records every capture; the diff between them is the effect.

## What verifies it, besides us

- `/context` token count of A, unchanged across a `/btw` and across a park.
- `events.jsonl`: zero new `prompt` records for A's session id after capture or
  dispatch; exactly one for the target session.
- `herdr agent wait <name> --until working --timeout 10000` returns after a send.
- The pty test for the Inbox view and the `claude plugin test` run in `test.sh`.
- The labeled leak rate after two weeks, against the baseline measured first.

## Layout

Keep one workspace per project and one named session per thread of work, as a tab,
not a split. Open the activity column beside the main session only: one column per
workspace, not per tab (w1G has two today). The Shell pane is the console for all of
it. A `--bg` session has no pane: use it for tasks you will read later, not watch.

## Open checks before building

1. `/btw` and context, `/btw` mid-turn.
2. `herdr agent prompt` to a working Claude: queued or rejected.
3. Does the sidebar render `state_labels` and `tokens` from `pane report-metadata`.
