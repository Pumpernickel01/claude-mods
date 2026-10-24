// What the column's viewers draw, as plain functions of the feed, the view and
// the pane's size: no terminal here, so `node --test` can check every line.

// Catppuccin Mocha, as the pane inside Claude and herdr itself use.
export const MOCHA = {
  text: '#cdd6f4',
  blue: '#89b4fa',
  mauve: '#cba6f7',
  green: '#a6e3a1',
  yellow: '#f9e2af',
  peach: '#fab387',
  red: '#f38ba8',
  teal: '#94e2d5',
  subtext0: '#a6adc8',
  overlay1: '#7f849c',
  overlay0: '#6c7086',
  surface0: '#313244',
}

const rgb = hex => [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16)).join(';')

export const paint = (hex, text) => (text === '' ? '' : `\x1b[38;2;${rgb(hex)}m${text}\x1b[39m`)
export const bold = text => `\x1b[1m${text}\x1b[22m`
const onSelected = text => `\x1b[48;2;${rgb(MOCHA.surface0)}m${text}\x1b[49m`

const NONE = /[\p{M}‍︎️]/u
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|\p{Emoji_Presentation}/u
const cellsOfChar = char => (NONE.test(char) ? 0 : WIDE.test(char) ? 2 : 1)

// Terminal cells a text takes: wide for CJK and emoji, none for marks and joiners.
export const cellsOf = text => {
  let cells = 0
  for (const char of text) cells += cellsOfChar(char)

  return cells
}

// The text in exactly `cells`: cut with an ellipsis, or padded with spaces.
export const fit = (text, cells) => {
  if (cells <= 0) return ''
  if (cellsOf(text) <= cells) return text + ' '.repeat(cells - cellsOf(text))

  let kept = ''
  let used = 0
  for (const char of text) {
    if (used + cellsOfChar(char) > cells - 1) break
    kept += char
    used += cellsOfChar(char)
  }

  return `${kept}…${' '.repeat(cells - 1 - used)}`
}

const oneLine = text => String(text).replace(/\s+/g, ' ').trim()

// "64k tok", "12.3 KB": an amount short enough for the log's right edge.
export const amountOf = ({ n, unit }) => {
  if (unit === 'tok') return n < 1000 ? `${n} tok` : `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k tok`
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`

  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

const pad = n => String(n).padStart(2, '0')
export const clockOf = at => {
  const date = new Date(at)

  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

// Which rows show: `end` is where a scrolled view stops, null while it follows the newest.
export const windowOf = (total, rows, end) => {
  const stop = end === null ? total : Math.min(total, Math.max(end, Math.min(rows, total)))

  return { start: Math.max(0, stop - rows), end: stop }
}

// The flow log's view: the selected flow (null, the newest) and where it is scrolled to.
export const flowWindow = (flows, rows, view) => {
  const found = view.selected === null ? -1 : flows.findIndex(flow => flow.id === view.selected)
  const index = found === -1 ? flows.length - 1 : found
  let { start, end } = windowOf(flows.length, rows, view.end)
  if (index >= end) ({ start, end } = windowOf(flows.length, rows, index + 1))
  if (index < start) ({ start, end } = windowOf(flows.length, rows, index + rows))

  return { start, end, index }
}

// Keys and the mouse as actions: arrows, j/k, PgUp/PgDn, g/G, Home/End, Tab, the wheel, a click, q.
export const actionsOf = chunk => {
  const actions = []
  const KEYS = [
    ['\x1b[A', 'up'], ['\x1bOA', 'up'], ['k', 'up'],
    ['\x1b[B', 'down'], ['\x1bOB', 'down'], ['j', 'down'],
    ['\x1b[5~', 'pageUp'], ['\x1b[6~', 'pageDown'],
    ['\x1b[H', 'top'], ['\x1b[1~', 'top'], ['g', 'top'],
    ['\x1b[F', 'bottom'], ['\x1b[4~', 'bottom'], ['G', 'bottom'],
    ['\t', 'tab'],
    ['q', 'quit'], ['\x03', 'quit'],
  ]
  let rest = chunk
  while (rest.length > 0) {
    const mouse = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/.exec(rest)
    if (mouse !== null) {
      const [whole, button, , row, kind] = mouse
      if (button === '64') actions.push({ kind: 'up' })
      else if (button === '65') actions.push({ kind: 'down' })
      else if (button === '0' && kind === 'M') actions.push({ kind: 'click', row: Number(row) })
      rest = rest.slice(whole.length)
      continue
    }

    const key = KEYS.find(([text]) => rest.startsWith(text))
    if (key !== undefined) {
      actions.push({ kind: key[1] })
      rest = rest.slice(key[0].length)
    } else {
      // Any other escape sequence whole, or one plain character.
      rest = rest.slice(/^\x1b(?:\[[\d;?<]*[A-Za-z~]|O.)?/.exec(rest)?.[0].length ?? 1)
    }
  }

  return actions
}

// A header: what the pane is on the left, how far it is scrolled on the right.
const headerOf = (left, right, cols) => {
  const room = Math.max(0, cols - cellsOf(right) - 1)

  return paint(MOCHA.overlay1, fit(left, room)) + ' ' + paint(MOCHA.overlay0, right)
}

// The top pane's two tabs: the open one bright, the other dim with the key that opens it.
const TABS = [['flow', 'Data flow'], ['guide', 'Guide']]
const tabNamesOf = active => TABS.map(([tab, name]) => [tab === active, tab === active ? name : `${name} (Tab)`])

// The top pane's header: its tabs, what the open one shows, how far it is scrolled on the right.
const tabbedHeaderOf = (active, left, right, cols) => {
  const names = tabNamesOf(active)
  const tabs = names.map(([isOpen, name]) => (isOpen ? bold(paint(MOCHA.text, name)) : paint(MOCHA.overlay0, name)))
  const room = Math.max(0, cols - cellsOf(names.map(([, name]) => name).join(' │ ')) - cellsOf(right) - 1)

  return (
    tabs.join(paint(MOCHA.overlay0, ' │ ')) +
    paint(MOCHA.overlay1, fit(left === '' ? '' : ` · ${left}`, room)) +
    ' ' +
    paint(MOCHA.overlay0, right)
  )
}

const TAG_COLOR = { LAN: MOCHA.teal, local: MOCHA.subtext0 }

// One flow as a line: "14:02:20 MCP       ▶ Gmail via claude.ai  search_threads  ↑ 0.2 KB ↓ 8 KB".
export const flowLineOf = (flow, cols) => {
  const fromCells = 9
  const toCells = Math.max(12, Math.min(28, Math.floor(cols * 0.28)))
  const sizes = [flow.up && `↑ ${amountOf(flow.up)}`, flow.down && `↓ ${amountOf(flow.down)}`].filter(Boolean).join(' ')
  const to = flow.tag === undefined ? flow.to : `${flow.to} ${flow.tag}`
  const fixed = 8 + 1 + fromCells + 3 + toCells + 2
  const sizeCells = sizes === '' ? 0 : cellsOf(sizes) + 2
  const whatCells = Math.max(0, cols - fixed - sizeCells)
  const what = (flow.isFailed ? '✗ ' : '') + oneLine(flow.what)
  const toText = fit(to, toCells)
  const tagAt = flow.tag === undefined ? -1 : toText.lastIndexOf(` ${flow.tag}`)
  const toPainted =
    tagAt === -1
      ? paint(flow.tag === undefined ? MOCHA.blue : TAG_COLOR[flow.tag], toText)
      : paint(TAG_COLOR[flow.tag], toText.slice(0, tagAt)) + paint(MOCHA.overlay0, toText.slice(tagAt))

  return [
    paint(MOCHA.overlay0, clockOf(flow.at)),
    ' ',
    paint(MOCHA.mauve, fit(flow.from, fromCells)),
    paint(MOCHA.overlay0, ' ▶ '),
    toPainted,
    '  ',
    paint(flow.isFailed ? MOCHA.red : MOCHA.text, fit(what, whatCells)),
    sizes === '' ? '' : '  ',
    flow.up ? paint(MOCHA.yellow, `↑ ${amountOf(flow.up)}`) : '',
    flow.up && flow.down ? ' ' : '',
    flow.down ? paint(MOCHA.green, `↓ ${amountOf(flow.down)}`) : '',
  ].join('')
}

// The data flow pane: a header, the flows that fit, the selected one's detail.
export const drawFlow = (feed, view, rows, cols) => {
  const list = feed?.flows ?? []
  const body = Math.max(1, rows - 2)
  if (feed === undefined) return [tabbedHeaderOf('flow', '', 'waiting for Claude…', cols)]
  if (list.length === 0) return [tabbedHeaderOf('flow', '', '', cols), paint(MOCHA.overlay0, 'No transfers yet.')]

  const { start, end, index } = flowWindow(list, body, view)
  const newer = list.length - end
  const right = view.selected === null ? '↑↓ pick a line' : newer > 0 ? `▼ ${newer} newer · G newest` : 'G newest'
  const lines = [tabbedHeaderOf('flow', `${list.length} transfers`, right, cols)]
  for (let at = start; at < end; at += 1) {
    const line = flowLineOf(list[at], cols)
    lines.push(at === index ? onSelected(line) : line)
  }
  lines.push(paint(MOCHA.overlay1, fit(`  └ ${oneLine(list[index].detail)}`, cols)))

  return lines
}

const MARK = { running: '…', done: '✓', failed: '✗', denied: '⊘' }
const MARK_COLOR = { running: MOCHA.yellow, done: MOCHA.green, failed: MOCHA.red, denied: MOCHA.peach }
const took = ms => (ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`)

// One tool call as a line: "✓ ↳ Bash 1.2s claude plugin test .".
export const toolLineOf = (call, cols) => {
  const head = `${MARK[call.state]} ${call.isSubagent ? '↳ ' : ''}`
  const time = call.ms === undefined ? '' : ` ${took(call.ms)}`
  const room = Math.max(0, cols - cellsOf(head) - cellsOf(call.tool) - cellsOf(time) - 1)

  return [
    paint(MARK_COLOR[call.state], MARK[call.state]),
    ' ',
    call.isSubagent ? paint(MOCHA.mauve, '↳ ') : '',
    paint(MOCHA.blue, bold(call.tool)),
    paint(MOCHA.overlay0, time),
    ' ',
    paint(MOCHA.subtext0, fit(oneLine(call.detail), room)),
  ].join('')
}

// The tools pane: a header with the totals, then the calls that fit.
export const drawTools = (feed, view, rows, cols) => {
  const list = feed?.calls ?? []
  const body = Math.max(1, rows - 1)
  if (feed === undefined) return [headerOf('Tools', 'waiting for Claude…', cols)]

  const failed = list.filter(call => call.state === 'failed').length
  const { start, end } = windowOf(list.length, body, view.end)
  const right = [start > 0 && `▲ ${start} more`, end < list.length && `▼ ${list.length - end} newer`].filter(Boolean).join(' · ')
  const left = list.length === 0 ? 'Tools · no calls yet' : `Tools · ${list.length} calls${failed > 0 ? `, ${failed} failed` : ''}`

  return [headerOf(left, right, cols), ...list.slice(start, end).map(call => toolLineOf(call, cols))]
}

const clampEnd = (end, total, rows) => (end >= total ? null : Math.max(Math.min(rows, total), end))

// The tools view after an action: it scrolls, and follows again at the bottom.
export const scrollTools = (view, action, total, rows) => {
  const body = Math.max(1, rows - 1)
  const end = view.end ?? total
  const by = { up: -1, down: 1, pageUp: -body, pageDown: body }[action.kind]
  if (by !== undefined) return { end: clampEnd(end + by, total, body) }
  if (action.kind === 'top') return { end: clampEnd(Math.min(body, total), total, body) }
  if (action.kind === 'bottom') return { end: null }

  return view
}

// The flow view after an action: it moves the selection, a click picks a row.
export const moveFlow = (view, action, flows, rows) => {
  const body = Math.max(1, rows - 2)
  const { start, end, index } = flowWindow(flows, body, view)
  const pick = at => {
    const to = Math.max(0, Math.min(flows.length - 1, at))
    if (to === flows.length - 1) return { selected: null, end: null }

    const shown = flowWindow(flows, body, { selected: flows[to].id, end: end === flows.length ? null : end })
    return { selected: flows[to].id, end: shown.end }
  }
  if (flows.length === 0) return view

  switch (action.kind) {
    case 'up': return pick(index - 1)
    case 'down': return pick(index + 1)
    case 'pageUp': return pick(index - body)
    case 'pageDown': return pick(index + body)
    case 'top': return pick(0)
    case 'bottom': return { selected: null, end: null }
    case 'click': {
      // Row 1 is the header; the flows start on row 2.
      const at = start + action.row - 2
      return at >= start && at < end ? pick(at) : view
    }
    default: return view
  }
}

// `code` and **bold** marks take no cells.
const shownCells = text => cellsOf(text.replace(/`|\*\*/g, ''))

// A text in rows of at most `cols` cells, broken between words (a word too long
// for a row, inside it): the first row starts with `lead`, the rest with `hang`.
export const wrapOf = (text, cols, lead = '', hang = ' '.repeat(cellsOf(lead))) => {
  const rows = []
  let row = ''
  const prefix = () => (rows.length === 0 ? lead : hang)
  const room = () => Math.max(1, cols - cellsOf(prefix()))
  const push = () => {
    rows.push(prefix() + row)
    row = ''
  }

  for (let word of text.split(/\s+/).filter(Boolean)) {
    if (row !== '' && shownCells(`${row} ${word}`) > room()) push()
    while (shownCells(word) > room()) {
      let head = ''
      for (const char of word) {
        if (head !== '' && shownCells(head + char) > room()) break
        head += char
      }
      row = head
      push()
      word = word.slice(head.length)
    }
    row = row === '' ? word : `${row} ${word}`
  }
  if (row !== '' || rows.length === 0) push()

  return rows
}

// One wrapped row painted: `code` in peach, **bold** bold; `marks` carries a
// mark still open at the row's end into the next row.
const paintInline = (text, color, marks) => {
  let out = ''
  for (const part of text.split(/(`|\*\*)/)) {
    if (part === '`') marks.code = !marks.code
    else if (part === '**' && !marks.code) marks.strong = !marks.strong
    else if (part !== '') {
      const painted = paint(marks.code ? MOCHA.peach : color, part)
      out += marks.strong ? bold(painted) : painted
    }
  }

  return out
}

// The guide's Markdown as painted rows of the pane's width: headings, rules,
// bullets and numbered steps (their text hung under the first word), quotes,
// `code` and **bold**.
export const guideLinesOf = (markdown, cols) => {
  const lines = []
  for (const source of markdown.replace(/\r/g, '').split('\n')) {
    const marks = { code: false, strong: false }
    const rowsOf = (text, color, lead = '', leadColor = MOCHA.overlay1) =>
      wrapOf(text, cols, lead).map((row, at) => {
        const prefix = at === 0 ? lead : ' '.repeat(cellsOf(lead))
        return paint(leadColor, prefix) + paintInline(row.slice(prefix.length), color, marks)
      })
    const heading = /^(#{1,6})\s+(.*)$/.exec(source)
    const item = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(source)

    if (source.trim() === '') lines.push('')
    else if (/^\s*(-{3,}|\*{3,})\s*$/.test(source)) lines.push(paint(MOCHA.overlay0, '─'.repeat(cols)))
    else if (heading !== null) lines.push(...rowsOf(heading[2], heading[1].length === 1 ? MOCHA.mauve : MOCHA.blue).map(bold))
    else if (item !== null) {
      const isStep = /\d/.test(item[2])
      lines.push(...rowsOf(item[3], MOCHA.text, `${item[1]}${isStep ? item[2] : '•'} `, isStep ? MOCHA.yellow : MOCHA.overlay1))
    } else if (source.startsWith('>')) lines.push(...rowsOf(source.replace(/^>\s?/, ''), MOCHA.overlay1))
    else lines.push(...rowsOf(source.trim(), MOCHA.text))
  }

  return lines
}

// The guide tab: the header, then the guide's rows from where it is scrolled to.
// `markdown` is undefined while the file does not exist.
export const drawGuide = (markdown, path, view, rows, cols) => {
  const body = Math.max(1, rows - 1)
  if (markdown === undefined) {
    return [tabbedHeaderOf('guide', path, '', cols), paint(MOCHA.overlay0, fit(`No guide yet: write it to ${path}`, cols))]
  }

  const lines = guideLinesOf(markdown, cols)
  const start = Math.min(view.top, Math.max(0, lines.length - body))
  const end = Math.min(lines.length, start + body)
  const right = [start > 0 && `▲ ${start} above`, end < lines.length && `▼ ${lines.length - end} more`].filter(Boolean).join(' · ')

  return [tabbedHeaderOf('guide', path, right, cols), ...lines.slice(start, end)]
}

// The guide's view after an action: it scrolls by a line or a page, within the guide.
export const scrollGuide = (view, action, total, rows) => {
  const body = Math.max(1, rows - 1)
  const last = Math.max(0, total - body)
  const by = { up: -1, down: 1, pageUp: -body, pageDown: body }[action.kind]
  const top = by !== undefined ? Math.min(view.top, last) + by : ({ top: 0, bottom: last }[action.kind] ?? view.top)

  return { top: Math.max(0, Math.min(last, top)) }
}
