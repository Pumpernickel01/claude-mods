// The git strip's bottom pane: the commit graph. Run as `node git_commits.mjs <repo folder>`.
import { drawCommits, moveList } from './drawgit.mjs'
import { loader } from './gitdata.mjs'
import { runViewer } from './tui.mjs'

runViewer({
  load: loader('commits', process.argv[2]),
  view: { at: 0 },
  draw: drawCommits,
  act: (view, action, feed, rows) => moveList(view, action, feed?.commits?.length ?? 0, rows),
})
