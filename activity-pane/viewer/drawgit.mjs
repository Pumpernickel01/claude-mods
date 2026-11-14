// What the git viewers draw, as plain functions of the parsed feed, the view and the pane's
// size, like draw.mjs's. Read-only: the view is only which row is selected.
import { MOCHA, cellsOf, clean, fit, headerOf, onSelected, paint } from './draw.mjs'
import { shortAge } from './gitdata.mjs'

// Text from git on one line, no control character in it.
const one = text => clean(text).replace(/[\t\n\r]/g, ' ')

const waiting = (title, feed, cols) => {
  if (feed === undefined) return [headerOf(title, 'waiting for git…', cols)]
  if (feed.repo === false) return [headerOf(`${title} · not a git repository`, '', cols)]

  return undefined
}

// The first row shown: the selected one kept in view, as near the middle as the list allows.
export const startOf = (total, body, at) => Math.max(0, Math.min(total - body, at - Math.floor(body / 2)))

// The selected row after an action; a click picks a row (row 1 is the header).
export const moveList = (view, action, total, rows) => {
  const body = Math.max(1, rows - 1)
  const at = Math.min(view.at, Math.max(0, total - 1))
  const to = {
    up: at - 1,
    down: at + 1,
    pageUp: at - body,
    pageDown: at + body,
    top: 0,
    bottom: total - 1,
    click: startOf(total, body, at) + (action.row ?? 0) - 2,
  }[action.kind]
  if (to === undefined || (action.kind === 'click' && (to < 0 || to >= total))) return view

  return { at: Math.max(0, Math.min(total - 1, to)) }
}

// The header, then the rows that fit, the selected one on its own background.
const listOf = (title, total, rows, view, lineOf, cols) => {
  const body = Math.max(1, rows - 1)
  const at = Math.min(view.at, Math.max(0, total - 1))
  const start = startOf(total, body, at)
  const lines = [headerOf(title, total === 0 ? '' : `${at + 1}/${total}`, cols)]
  for (let row = start; row < Math.min(total, start + body); row += 1) {
    const line = lineOf(row)
    lines.push(row === at ? onSelected(line) : line)
  }

  return lines
}

const MARK_COLOR = { ' ': MOCHA.text, '?': MOCHA.red }

// One changed path: "M  src/app.mjs", the index's letter green, the worktree's red, the folder dim.
export const fileLineOf = (entry, cols) => {
  const x = one(entry.x)
  const y = one(entry.y)
  const path = one(entry.path)
  const text = fit(entry.orig === undefined ? path : `${path} ← ${one(entry.orig)}`, Math.max(0, cols - 3))
  const dirCells = path.lastIndexOf('/') + 1

  return [
    paint(entry.x === '?' ? MOCHA.red : MOCHA.green, x),
    paint(MARK_COLOR[entry.y] ?? MOCHA.red, y),
    ' ',
    paint(MOCHA.overlay1, text.slice(0, dirCells)),
    paint(MOCHA.text, text.slice(dirCells)),
  ].join('')
}

// The Files pane: the branch and the counts, then every changed path.
export const drawFiles = (feed, view, rows, cols) => {
  const early = waiting('Files', feed, cols)
  if (early !== undefined) return early

  const { head, upstream, ahead, behind, entries } = feed.status
  const counts = [
    [entries.filter(entry => entry.x !== ' ' && entry.x !== '?').length, 'staged'],
    [entries.filter(entry => entry.y !== ' ' && entry.y !== '?').length, 'changed'],
    [entries.filter(entry => entry.x === '?').length, 'new'],
  ]
    .filter(([n]) => n > 0)
    .map(([n, word]) => `${n} ${word}`)
  const rest = [upstream === undefined ? '' : `↑${ahead} ↓${behind}`, counts.length === 0 ? 'clean' : counts.join(' · ')]
  const name = fit(one(head), Math.min(cols, cellsOf(one(head))))
  const left = rest[0] === '' ? rest[1] : `${rest[0]} · ${rest[1]}`
  const header = paint(MOCHA.blue, name) + paint(MOCHA.overlay1, fit(` ${left}`, cols - cellsOf(name)))

  return [header, ...listOf('', entries.length, rows, view, row => fileLineOf(entries[row], cols), cols).slice(1)]
}

const statusOf = branch => {
  if (branch.isGone) return ['gone', MOCHA.red]
  if (!branch.hasUpstream) return ['·', MOCHA.overlay0]
  if (branch.ahead === 0 && branch.behind === 0) return ['✓', MOCHA.green]

  return [[branch.ahead > 0 && `↑${branch.ahead}`, branch.behind > 0 && `↓${branch.behind}`].filter(Boolean).join(' '), MOCHA.peach]
}

// The Branches pane: "* dev  ↑1 ↓0  3d", the current branch teal.
export const drawBranches = (feed, view, rows, cols) => {
  const early = waiting('Branches', feed, cols)
  if (early !== undefined) return early

  const list = feed.branches
  const statusCells = Math.max(1, ...list.map(branch => cellsOf(statusOf(branch)[0])))
  const nameCells = Math.max(1, cols - 2 - 1 - statusCells - 1 - 4)
  const lineOf = row => {
    const branch = list[row]
    const [status, color] = statusOf(branch)
    const tint = branch.isCurrent ? MOCHA.teal : MOCHA.text

    return [
      paint(MOCHA.teal, branch.isCurrent ? '* ' : '  '),
      paint(tint, fit(one(branch.name), nameCells)),
      ' ',
      paint(color, fit(status, statusCells)),
      ' ',
      paint(MOCHA.overlay1, shortAge(branch.age).padStart(4)),
    ].join('')
  }

  return listOf(list.length === 0 ? 'Branches · none' : `Branches · ${list.length}`, list.length, rows, view, lineOf, cols)
}

const REF_COLOR = ref => (ref.startsWith('HEAD') ? MOCHA.teal : ref.startsWith('tag: ') ? MOCHA.yellow : MOCHA.green)

// "[HEAD -> dev, origin/dev]" within `budget` cells, refs dropped from the end when it is too long.
// shortcut: a ref with a slash counts as a remote (so a local feature/x is green too); no flag in %D.
const refsOf = (refs, budget) => {
  const kept = []
  let used = 2
  for (const ref of refs) {
    const cells = cellsOf(one(ref)) + (kept.length > 0 ? 2 : 0)
    if (used + cells > budget) break

    kept.push(ref)
    used += cells
  }
  if (kept.length === 0) return { cells: 0, text: '' }

  const text = kept
    .map((ref, at) => (at > 0 ? paint(MOCHA.overlay0, ', ') : '') + paint(REF_COLOR(ref), one(ref)))
    .join('')

  return { cells: used, text: paint(MOCHA.overlay0, '[') + text + paint(MOCHA.overlay0, ']') }
}

// The Commits pane: "* 1a2b3c4 [HEAD -> dev] subject  3d", unpushed shas red.
export const drawCommits = (feed, view, rows, cols) => {
  const early = waiting('Commits', feed, cols)
  if (early !== undefined) return early

  const list = feed.commits
  const unpushed = feed.unpushed
  const lineOf = row => {
    const commit = list[row]
    const graph = one(commit.graph).slice(0, Math.floor(cols / 3))
    if (commit.sha === undefined) return paint(MOCHA.overlay0, fit(graph, cols))

    const room = Math.max(0, cols - cellsOf(graph) - 7 - 1 - 5)
    const refs = refsOf(commit.refs, Math.floor(room / 2))
    const spacer = refs.cells > 0 ? 1 : 0
    const isUnpushed = unpushed !== undefined && unpushed.has(commit.sha)

    return [
      paint(MOCHA.overlay0, graph),
      paint(isUnpushed ? MOCHA.red : MOCHA.yellow, commit.sha.slice(0, 7)),
      ' ',
      refs.text,
      ' '.repeat(spacer),
      paint(MOCHA.text, fit(one(commit.subject), room - refs.cells - spacer)),
      ' ',
      paint(MOCHA.overlay1, shortAge(commit.age).padStart(4)),
    ].join('')
  }
  const pending = unpushed === undefined || unpushed.size === 0 ? '' : ` · ${unpushed.size} unpushed`

  return listOf(list.length === 0 ? 'Commits · none' : `Commits${pending}`, list.length, rows, view, lineOf, cols)
}
