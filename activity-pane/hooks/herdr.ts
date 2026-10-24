// The three panes of the column, by herdr pane id.
export type Column = { flow: string; shell: string; tools: string }

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
export const viewerCommand = (root: string, viewer: 'flow' | 'tools', feed: string) =>
  `exec node ${quoted(`${root}/viewer/${viewer}.mjs`)} ${quoted(feed)}`

// The shell pane's command: a shell wrapped so Shift+Tab shows Agents and Agent graph.
export const shellCommand = (root: string, feed: string) =>
  `exec python3 ${quoted(`${root}/viewer/shell_tabs.py`)} ${quoted(feed)}`

// The feed's file for the column beside one herdr pane.
export const feedPathOf = (tmp: string, pane: string) =>
  `${tmp.replace(/\/+$/, '')}/claude-activity/${pane.replace(/[^\w-]/g, '-')}.json`
