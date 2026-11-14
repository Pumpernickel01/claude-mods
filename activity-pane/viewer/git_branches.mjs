// The git strip's middle pane: the local branches, newest first. Run as `node git_branches.mjs <repo folder>`.
import { drawBranches, moveList } from './drawgit.mjs'
import { loader } from './gitdata.mjs'
import { runViewer } from './tui.mjs'

runViewer({
  load: loader('branches', process.argv[2]),
  view: { at: 0 },
  draw: drawBranches,
  act: (view, action, feed, rows) => moveList(view, action, feed?.branches?.length ?? 0, rows),
})
