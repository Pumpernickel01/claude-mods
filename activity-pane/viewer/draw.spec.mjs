// Run with `node --test viewer/draw.spec.mjs`.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  actionsOf,
  amountOf,
  cellsOf,
  clean,
  drawFlow,
  drawTools,
  fit,
  flowLineOf,
  moveFlow,
  scrollTools,
} from './draw.mjs'

const plain = line => line.replace(/\x1b\[[\d;]*m/g, '')

const AT = new Date(2026, 9, 18, 14, 2, 0).getTime()

const flow = (n, extra = {}) => ({
  id: `f${n}`,
  at: AT + n * 1000,
  from: 'Bash',
  to: `host${n}.example.com`,
  what: 'curl',
  detail: `curl https://host${n}.example.com`,
  ...extra,
})

const call = n => ({ id: `c${n}`, tool: 'Bash', detail: `command ${n}`, isSubagent: false, state: 'done', ms: 1200 })

test('fit pads short text and cuts long text with an ellipsis, in cells', () => {
  assert.equal(fit('abc', 5), 'abc  ')
  assert.equal(fit('abcdefgh', 5), 'abcd…')
  assert.equal(cellsOf(fit('日本語テキスト', 6)), 6)
})

test('amounts read as tokens, bytes, KB and MB', () => {
  assert.equal(amountOf({ n: 640, unit: 'tok' }), '640 tok')
  assert.equal(amountOf({ n: 64_213, unit: 'tok' }), '64k tok')
  assert.equal(amountOf({ n: 1_100, unit: 'tok' }), '1.1k tok')
  assert.equal(amountOf({ n: 200, unit: 'B' }), '200 B')
  assert.equal(amountOf({ n: 12_400, unit: 'B' }), '12.1 KB')
  assert.equal(amountOf({ n: 3 * 1024 * 1024, unit: 'B' }), '3.0 MB')
})

test('a flow line names the time, sender, destination with its tag, and sizes, within the width', () => {
  const line = plain(
    flowLineOf(
      flow(0, { from: 'MCP', to: 'Gmail via claude.ai', what: 'search_threads', up: { n: 200, unit: 'B' }, down: { n: 8_200, unit: 'B' } }),
      100,
    ),
  )
  assert.match(line, /^14:02:00 MCP {7}▶ Gmail via claude\.ai +search_threads +↑ 200 B ↓ 8\.0 KB$/)
  assert.ok(cellsOf(line) <= 100)

  const lan = plain(flowLineOf(flow(1, { to: '192.168.4.1', tag: 'LAN', what: 'curl' }), 100))
  assert.match(lan, /▶ 192\.168\.4\.1 LAN +curl/)
})

test('the flow pane shows a header, the newest flows that fit, and the newest one’s detail', () => {
  const feed = { calls: [], flows: Array.from({ length: 20 }, (_, n) => flow(n)) }
  const lines = drawFlow(feed, { selected: null, end: null }, 9, 100).map(plain)

  assert.equal(lines.length, 9)
  assert.match(lines[0], /^Data flow · 20 transfers .*↑↓ pick a line$/)
  assert.match(lines[1], /host13\.example\.com/)
  assert.match(lines[7], /host19\.example\.com/)
  assert.match(lines[8], /└ curl https:\/\/host19\.example\.com/)
})

test('↑ picks the line above and shows what it sent; ↓ from the newest follows again', () => {
  const flows = Array.from({ length: 20 }, (_, n) => flow(n))
  let view = { selected: null, end: null }
  for (let i = 0; i < 8; i += 1) view = moveFlow(view, { kind: 'up' }, flows, 9)

  assert.equal(view.selected, 'f11')
  const lines = drawFlow({ flows }, view, 9, 100).map(plain)
  assert.match(lines[1], /host11\.example\.com/)
  assert.match(lines[8], /└ curl https:\/\/host11\.example\.com/)
  assert.match(lines[0], /▼ \d+ newer · G newest$/)

  view = moveFlow(view, { kind: 'bottom' }, flows, 9)
  assert.deepEqual(view, { selected: null, end: null })
})

test('a selected older flow stays put while new ones arrive', () => {
  const flows = Array.from({ length: 20 }, (_, n) => flow(n))
  const view = moveFlow({ selected: null, end: null }, { kind: 'up' }, flows, 9)
  const more = [...flows, flow(20), flow(21)]
  const lines = drawFlow({ flows: more }, view, 9, 100).map(plain)

  assert.match(lines[8], /host18\.example\.com/)
  assert.match(lines[7], /host19\.example\.com/)
  assert.match(lines[0], /▼ 2 newer/)
})

test('a click picks the flow on that row', () => {
  const flows = Array.from({ length: 20 }, (_, n) => flow(n))
  // Row 1 is the header, row 2 the first flow shown (f13 while following).
  const view = moveFlow({ selected: null, end: null }, { kind: 'click', row: 3 }, flows, 9)

  assert.equal(view.selected, 'f14')
})

test('the tools pane shows the 4 newest calls under a header that counts the rest', () => {
  const feed = { calls: Array.from({ length: 23 }, (_, n) => call(n)), flows: [] }
  const lines = drawTools(feed, { end: null }, 5, 80).map(plain)

  assert.equal(lines.length, 5)
  assert.match(lines[0], /^Tools · 23 calls .*▲ 19 more$/)
  assert.match(lines[1], /^✓ Bash 1\.2s command 19 +$/)
  assert.match(lines[4], /command 22/)
})

test('the tools pane scrolls up and back down to following', () => {
  const feed = { calls: Array.from({ length: 23 }, (_, n) => call(n)) }
  let view = scrollTools({ end: null }, { kind: 'up' }, 23, 5)
  view = scrollTools(view, { kind: 'up' }, 23, 5)
  const lines = drawTools(feed, view, 5, 80).map(plain)

  assert.match(lines[0], /▲ 17 more · ▼ 2 newer$/)
  assert.match(lines[4], /command 20/)

  view = scrollTools(view, { kind: 'down' }, 23, 5)
  view = scrollTools(view, { kind: 'down' }, 23, 5)
  assert.deepEqual(view, { end: null })

  assert.equal(scrollTools({ end: null }, { kind: 'top' }, 23, 5).end, 4)
})

test('keys, the wheel and a click read as actions', () => {
  assert.deepEqual(actionsOf('\x1b[Ak\x1b[Bj').map(a => a.kind), ['up', 'up', 'down', 'down'])
  assert.deepEqual(actionsOf('\x1b[<64;10;3M\x1b[<65;10;3M').map(a => a.kind), ['up', 'down'])
  assert.deepEqual(actionsOf('\x1b[<0;10;4M\x1b[<0;10;4m'), [{ kind: 'click', row: 4 }])
  assert.deepEqual(actionsOf('\x1b[5~\x1b[6~gGq').map(a => a.kind), ['pageUp', 'pageDown', 'top', 'bottom', 'quit'])
  assert.deepEqual(actionsOf('x\x1b[1;5Cz'), [])
})

test('before the feed exists each pane says it is waiting', () => {
  assert.match(plain(drawFlow(undefined, { selected: null, end: null }, 9, 80)[0]), /waiting for Claude…$/)
  assert.match(plain(drawTools(undefined, { end: null }, 5, 80)[0]), /waiting for Claude…$/)
})

test('clean turns control characters into spaces, so feed text cannot drive the terminal', () => {
  // OSC 52 (write the clipboard), a cursor move, a C1 CSI, DEL; tab and newline stay
  assert.equal(clean('a\x1b]52;c;aGk=\x07b\x1b[2Jc\x9b31md\x7fe\tf\ng'), 'a ]52;c;aGk= b [2Jc 31md e\tf\ng')
})
