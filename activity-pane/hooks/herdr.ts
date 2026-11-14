// The three panes of the column, by herdr pane id, and the git strip beside it when it has one
// (columns stored before the strip existed have none and are never given one).
export type GitPanes = { files: string; branches: string; commits: string }
export type Column = { flow: string; shell: string; tools: string; git?: GitPanes }

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

// The git strip is this many columns wide and opens only when the column keeps COLUMN_MIN beside it.
export const GIT_COLS = 52
export const COLUMN_MIN = 68
export const STRIP_MIN = GIT_COLS + COLUMN_MIN

// The share of the strip's height each pane keeps when split down in turn: Files 40 %, Branches 20 %,
// Commits 40 % (Branches keeps 20 of the 60 left below Files).
export const GIT_RATIOS = { files: 0.4, branches: 0.2 / 0.6 }

// The ratio that keeps `columns` in the split pane itself, for a split to the right.
export const ratioKeepingWide = (width: number, columns: number) => clamp(columns / width)

export const ratioText = (ratio: number) => ratio.toFixed(4)

// The new pane's id from `herdr pane split`'s answer.
export const paneIdOf = (stdout: string) => {
  const id = (JSON.parse(stdout) as { result?: { pane?: { pane_id?: unknown } } }).result?.pane?.pane_id
  if (typeof id !== 'string') throw new Error('herdr named no new pane')

  return id
}

// The narrowest Claude pane the column opens beside unasked, as Claude Code
// seats a pane it opens unasked; /activity opens it beside any.
export const MIN_COLUMNS = 144

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
