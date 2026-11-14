// The terminal side of a viewer: the feed polled from its file, the keys and
// the mouse read, the pane redrawn. What it draws is draw.mjs's.
import { readFileSync, statSync } from 'node:fs'

import { actionsOf, clean } from './draw.mjs'

const POLL_MS = 250

// Runs a viewer full-pane until q: `draw(feed, view, rows, cols)` gives the
// lines, `act(view, action, feed, rows, cols)` the view after a key or the wheel.
// The feed is polled from `feedPath`, or, given `load` (async, a feed or undefined for
// no change), from that.
export function runViewer({ feedPath, load, view: first, draw, act }) {
  const out = process.stdout
  let feed
  let view = first
  let seen = ''

  // Each row is cleared before it is drawn: an erase after a line that fills the
  // last column would take that column's character with it.
  const render = () => {
    const rows = out.rows || 10
    const cols = out.columns || 80
    const lines = draw(feed, view, rows, cols).slice(0, rows)
    out.write(Array.from({ length: rows }, (_, row) => `\x1b[${row + 1};1H\x1b[2K${lines[row] ?? ''}`).join(''))
  }

  // The feed is rewritten whole; a read that lands mid-write keeps the last good copy.
  const poll = () => {
    try {
      const { mtimeMs, size } = statSync(feedPath)
      const stamp = `${mtimeMs}:${size}`
      if (stamp === seen) return

      feed = JSON.parse(readFileSync(feedPath, 'utf8'), (_key, value) => (typeof value === 'string' ? clean(value) : value))
      seen = stamp
      render()
    } catch {
      // Not written yet, or caught mid-write: try again on the next poll.
    }
  }

  let isLoading = false
  const pull = async () => {
    if (isLoading) return

    isLoading = true
    try {
      const next = await load()
      if (next !== undefined) {
        feed = next
        render()
      }
    } catch {
      // The next poll tries again.
    } finally {
      isLoading = false
    }
  }
  const tick = load === undefined ? poll : pull

  const restore = () => out.write('\x1b[?1006l\x1b[?1000l\x1b[?25h\x1b[?1049l')
  const quit = () => {
    restore()
    process.exit(0)
  }

  out.write('\x1b[?1049h\x1b[?25l\x1b[?1000h\x1b[?1006h')
  process.on('exit', restore)
  for (const signal of ['SIGTERM', 'SIGHUP', 'SIGINT']) process.on(signal, quit)

  if (process.stdin.isTTY) process.stdin.setRawMode(true)
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', chunk => {
    for (const action of actionsOf(chunk)) {
      if (action.kind === 'quit') quit()
      view = act(view, action, feed, out.rows || 10, out.columns || 80)
    }
    render()
  })
  out.on('resize', render)

  setInterval(tick, POLL_MS)
  tick()
  render()
}
