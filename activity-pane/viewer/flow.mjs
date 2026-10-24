// The column's top pane, two tabs that Tab switches: where Claude's data goes,
// one line per transfer, and the workflow guide in ~/.claude/workflow-guide.md.
// Run as `node flow.mjs <feed file>`.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { clean, drawFlow, drawGuide, guideLinesOf, moveFlow, scrollGuide } from './draw.mjs'
import { runViewer } from './tui.mjs'

const GUIDE_PATH = join(homedir(), '.claude', 'workflow-guide.md')
const GUIDE_SHOWN = '~/.claude/workflow-guide.md'

// Read at each draw, so an edit shows at the next redraw; undefined while it does not exist.
const readGuide = () => {
  try {
    return clean(readFileSync(GUIDE_PATH, 'utf8'))
  } catch {
    return undefined
  }
}

runViewer({
  feedPath: process.argv[2],
  view: { tab: 'flow', selected: null, end: null, guide: { top: 0 } },
  draw: (feed, view, rows, cols) =>
    view.tab === 'guide' ? drawGuide(readGuide(), GUIDE_SHOWN, view.guide, rows, cols) : drawFlow(feed, view, rows, cols),
  act: (view, action, feed, rows, cols) => {
    if (action.kind === 'tab') return { ...view, tab: view.tab === 'flow' ? 'guide' : 'flow' }
    if (view.tab === 'guide') {
      return { ...view, guide: scrollGuide(view.guide, action, guideLinesOf(readGuide() ?? '', cols).length, rows) }
    }

    return { ...view, ...moveFlow(view, action, feed?.flows ?? [], rows) }
  },
})
