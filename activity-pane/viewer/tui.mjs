// The terminal side of a viewer: the feed polled from its file, the keys and
// the mouse read, the pane redrawn. What it draws is draw.mjs's.
import { readFileSync, statSync } from 'node:fs'

import { actionsOf } from './draw.mjs'

const POLL_MS = 250

// Runs a viewer full-pane until q: `draw(feed, view, rows, cols)` gives the
// lines, `act(view, action, feed, rows, cols)` the view after a key or the wheel.
export function runViewer({ feedPath, view: first, draw, act }) {
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

      feed = JSON.parse(readFileSync(feedPath, 'utf8'))
      seen = stamp
      render()
    } catch {
      // Not written yet, or caught mid-write: try again on the next poll.
    }
  }

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

  setInterval(poll, POLL_MS)
  poll()
  render()
}
