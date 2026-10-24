// The column's bottom pane: Claude's tool calls, newest at the bottom.
// Run as `node tools.mjs <feed file>`.
import { drawTools, scrollTools } from './draw.mjs'
import { runViewer } from './tui.mjs'

runViewer({
  feedPath: process.argv[2],
  view: { end: null },
  draw: drawTools,
  act: (view, action, feed, rows) => scrollTools(view, action, feed?.calls?.length ?? 0, rows),
})
