// The column's top pane: where Claude's data goes, one line per transfer.
// Run as `node flow.mjs <feed file>`.
import { drawFlow, moveFlow } from './draw.mjs'
import { runViewer } from './tui.mjs'

runViewer({
  feedPath: process.argv[2],
  view: { selected: null, end: null },
  draw: drawFlow,
  act: (view, action, feed, rows) => ({ ...view, ...moveFlow(view, action, feed?.flows ?? [], rows) }),
})
