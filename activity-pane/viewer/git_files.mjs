// The git strip's top pane: the branch and every changed path. Run as `node git_files.mjs <repo folder>`.
import { drawFiles, moveList } from './drawgit.mjs'
import { loader } from './gitdata.mjs'
import { runViewer } from './tui.mjs'

runViewer({
  load: loader('files', process.argv[2]),
  view: { at: 0 },
  draw: drawFiles,
  act: (view, action, feed, rows) => moveList(view, action, feed?.status?.entries.length ?? 0, rows),
})
