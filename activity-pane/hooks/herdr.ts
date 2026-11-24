// The three panes of the column, by herdr pane id, and the git strip beside it (columns made by
// older versions may have none). `tab` is the
// column's own tab in the Activity workspace; a column stored without one sits beside Claude.
export type GitPanes = { files: string; branches: string; commits: string }
// `server` stamps which start of the activity server made it (see `serverOf` in register.tsx).
export type Column = { tab?: string; server?: number; flow: string; shell: string; tools: string; git?: GitPanes }

// The herdr session that holds every Claude session's column, one tab each, so a second terminal
// window attached to it (`herdr session attach activity`) shows them apart from Claude's window.
export const SESSION = 'activity'
// The workspace made there when it has none.
export const WORKSPACE = 'Activity'

// Rows each small pane shows, its header included; herdr spends 2 more on its frame.
export const FLOW_ROWS = 9
export const TOOLS_ROWS = 5
const FRAME = 2

const clamp = (ratio: number) => Math.min(0.9, Math.max(0.1, ratio))

// herdr's `--ratio` is the share the split pane keeps, the new pane the rest.
export const ratiosOf = (height: number) => {
  const flow = FLOW_ROWS + FRAME
  const tools = TOOLS_ROWS + FRAME

  return { flow: clamp(flow / height), tools: clamp((height - flow - tools) / (height - flow)) }
}

// The ratio that leaves a new pane of `rows` below a pane `height` tall.
export const ratioLeaving = (height: number, rows: number) => clamp((height - rows - FRAME) / height)

// The ratio that keeps `rows` in the split pane itself.
export const ratioKeeping = (height: number, rows: number) => clamp((rows + FRAME) / height)

// The git strip's share of the tab's width, the column the rest. A share, not a count of columns
// with a minimum: the tab is built at whatever size the second window has then (or none), so a
// minimum once left the strip out.
export const GIT_SHARE = 0.4

// The share of the strip's height each pane keeps when split down in turn: Files 40 %, Branches 20 %,
// Commits 40 % (Branches keeps 20 of the 60 left below Files).
export const GIT_RATIOS = { files: 0.4, branches: 0.2 / 0.6 }


export const ratioText = (ratio: number) => ratio.toFixed(4)

// The new pane's id from `herdr pane split`'s answer.
export const paneIdOf = (stdout: string) => {
  const id = (JSON.parse(stdout) as { result?: { pane?: { pane_id?: unknown } } }).result?.pane?.pane_id
  if (typeof id !== 'string') throw new Error('herdr named no new pane')

  return id
}

// The workspace for a new tab from `herdr workspace list`'s answer: the one labelled Activity, else
// the first (the one a window attached to the session made), if there is any.
export const workspaceOf = (stdout: string) => {
  type Listed = { result?: { workspaces?: { workspace_id: string; label: string }[] } }
  const list = (JSON.parse(stdout) as Listed).result?.workspaces ?? []

  return (list.find(one => one.label === WORKSPACE) ?? list[0])?.workspace_id
}

// The socket of a running herdr session from `herdr session list --json`'s answer; none when it is not running.
export const socketOf = (stdout: string, name: string) => {
  type Listed = { sessions?: { name: string; running: boolean; socket_path: string }[] }
  const found = (JSON.parse(stdout) as Listed).sessions?.find(one => one.name === name)

  return found?.running === true ? found.socket_path : undefined
}

// The new tab and its one pane from `herdr workspace create` or `herdr tab create`.
export const tabOf = (stdout: string) => {
  type Made = { result?: { tab?: { tab_id?: unknown }; root_pane?: { pane_id?: unknown } } }
  const made = (JSON.parse(stdout) as Made).result
  const [tab, pane] = [made?.tab?.tab_id, made?.root_pane?.pane_id]
  if (typeof tab !== 'string' || typeof pane !== 'string') throw new Error('herdr named no new tab')

  return { tab, pane }
}

// A pane's size from `herdr pane layout`'s answer.
export const rectOf = (stdout: string, pane: string) => {
  type Layout = { result?: { layout?: { panes?: { pane_id: string; rect: { width: number; height: number } }[] } } }
  const panes = (JSON.parse(stdout) as Layout).result?.layout?.panes ?? []

  return panes.find(one => one.pane_id === pane)?.rect
}

const quoted = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`

// What a viewer pane's shell is told to run; `exec`, so quitting it closes the pane.
// The git viewers take the repository's folder where the others take the feed.
export const viewerCommand = (root: string, viewer: 'flow' | 'tools' | 'git_files' | 'git_branches' | 'git_commits', feed: string) =>
  `exec node ${quoted(`${root}/viewer/${viewer}.mjs`)} ${quoted(feed)}`

// The shell pane's command: a shell wrapped so Tab cycles it with Agents and Agent graph.
export const shellCommand = (root: string, feed: string) =>
  `exec python3 ${quoted(`${root}/viewer/shell_tabs.py`)} ${quoted(feed)}`

// The feed's file for the column beside one herdr pane, in ~/.claude/activity (made 0700: it holds
// commands and file names), never a shared temporary folder.
export const feedPathOf = (home: string, pane: string) =>
  `${home.replace(/\/+$/, '')}/.claude/activity/${pane.replace(/[^\w-]/g, '-')}.json`

export const feedDirOf = (feed: string) => feed.slice(0, feed.lastIndexOf('/'))
