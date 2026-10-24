import { expect, test } from 'claude-code/testing'

import { IN_HERDR, herdr, session } from './kit'

const FEED = '/tmp/t/claude-activity/w0-p1.json'
const START = { cwd: '/Users/me/lab2', surface: 'terminal', isInteractive: true } as const
const RESUME = { id: 's1', isResumable: true } as never

const typed = (command: string) =>
  ({ command, args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 218 } }) as const


test('opens the column right of Claude: data flow on top, the shell in the middle, tools at the bottom', async ($, on) => {
  const tab = herdr(on)
  const seen = session(on, IN_HERDR)

  await $.session.start(START)

  expect(tab.splits()).toEqual([
    ['pane', 'split', '--pane', 'w0:p1', '--direction', 'right', '--ratio', '0.5000', '--cwd', '/Users/me/lab2', '--no-focus'],
    ['pane', 'split', '--pane', 'w0:p2', '--direction', 'down', '--ratio', '0.1803', '--cwd', '/Users/me/lab2', '--no-focus'],
    ['pane', 'split', '--pane', 'w0:p3', '--direction', 'down', '--ratio', '0.8600', '--cwd', '/Users/me/lab2', '--no-focus'],
  ])
  // 9 rows for the data flow, 5 for the tools, each with herdr's 2-row frame; the shell the rest.
  expect([tab.panes.get('w0:p2'), tab.panes.get('w0:p3'), tab.panes.get('w0:p4')]).toEqual([11, 43, 7])

  const runs = tab.runs()
  expect(runs.map(args => args[2])).toEqual(expect.arrayContaining(['w0:p2', 'w0:p4']))
  expect(runs.find(args => args[2] === 'w0:p2')?.[3]).toMatch(/^exec node '.*\/viewer\/flow\.mjs' '\/tmp\/t\/claude-activity\/w0-p1\.json'$/)
  expect(runs.find(args => args[2] === 'w0:p4')?.[3]).toMatch(/^exec node '.*\/viewer\/tools\.mjs' '\/tmp\/t\/claude-activity\/w0-p1\.json'$/)
  expect(runs.find(args => args[2] === 'w0:p3')?.[3]).toMatch(/^exec python3 '.*\/viewer\/shell_tabs\.py' '\/tmp\/t\/claude-activity\/w0-p1\.json'$/)
  expect(tab.ran.filter(args => args[1] === 'rename').map(args => args.slice(2))).toEqual(
    expect.arrayContaining([['w0:p3', 'Shell'], ['w0:p2', 'Data flow'], ['w0:p4', 'Tools']]),
  )

  expect(seen.opened).toEqual([])
  expect(seen.written.at(-1)?.path).toBe(FEED)
  expect(JSON.parse(seen.written.at(-1)?.text ?? '{}')).toEqual({ calls: [], flows: [], session: 's1' })
})

test('keeps the same column when the mod reloads', async ($, on) => {
  const tab = herdr(on)
  session(on, IN_HERDR)

  await $.session.start(START)
  await $.session.start(START)

  expect(tab.splits()).toHaveLength(3)
  expect(tab.panes.size).toBe(4)
})

test('/activity brings back a viewer that was quit, leaving the shell as it is', async ($, on) => {
  const tab = herdr(on)
  session(on, IN_HERDR)
  await $.session.start(START)

  // q in the tools viewer: its pane closes and the shell takes its rows.
  tab.quit('w0:p4', 'w0:p3')
  expect((await $.command.run(typed('activity'))).text).toBe('Activity column open beside Claude.')
  expect(tab.splits().at(-1)?.slice(2, 4)).toEqual(['--pane', 'w0:p3'])
  expect([tab.panes.get('w0:p3'), tab.panes.get('w0:p5')]).toEqual([43, 7])
  expect(tab.runs().at(-1)?.slice(2, 3)).toEqual(['w0:p5'])

  // And the data flow viewer: made below the shell, then swapped above it.
  tab.quit('w0:p2', 'w0:p3')
  await $.command.run(typed('activity'))
  expect(tab.ran.at(-3)?.slice(0, 2)).toEqual(['pane', 'swap'])
  expect([tab.panes.get('w0:p6'), tab.panes.get('w0:p3')]).toEqual([11, 43])
  expect(tab.runs().at(-1)?.slice(2, 3)).toEqual(['w0:p6'])
  expect(tab.closes()).toEqual([])
})

test('makes the whole column again when its shell is gone, closing what was left of it', async ($, on) => {
  const tab = herdr(on)
  session(on, IN_HERDR)
  await $.session.start(START)

  tab.panes.delete('w0:p3')
  await $.command.run(typed('activity'))

  expect(tab.closes()).toEqual(expect.arrayContaining(['w0:p2', 'w0:p4']))
  expect(tab.splits()).toHaveLength(6)
  expect(tab.panes.size).toBe(4)
})

test('closes the column when Claude exits, and keeps it through a /clear', async ($, on) => {
  const tab = herdr(on)
  session(on, IN_HERDR)
  await $.session.start(START)

  await $.session.end({ reason: 'clear', sessionId: 's1', resume: RESUME })
  expect(tab.closes()).toEqual([])

  await $.session.end({ reason: 'prompt_input_exit', sessionId: 's2', resume: RESUME })
  expect(tab.closes().sort()).toEqual(['w0:p2', 'w0:p3', 'w0:p4'])
  expect([...tab.panes.keys()]).toEqual(['w0:p1'])
})

test('outside herdr, opens the Activity pane inside Claude as before', async ($, on) => {
  const tab = herdr(on)
  const seen = session(on, { TMPDIR: '/tmp/t/' })

  await $.session.start(START)

  expect(seen.opened).toEqual(['activity'])
  expect(tab.ran).toEqual([])
  expect(seen.written).toEqual([])
})

test('beside a Claude pane already too narrow to share, waits for /activity to open the column', async ($, on) => {
  const tab = herdr(on, { width: 109 })
  const seen = session(on, IN_HERDR)

  await $.session.start(START)

  expect(seen.opened).toEqual(['activity'])
  expect(tab.splits()).toEqual([])

  expect((await $.command.run(typed('activity'))).text).toBe('Activity column open beside Claude.')
  expect(tab.splits()).toHaveLength(3)

  // Once it is there, a reload keeps it however narrow Claude's pane is.
  await $.session.start(START)
  expect(tab.splits()).toHaveLength(3)
  expect(seen.opened).toEqual(['activity'])
})

test('falls back to the Activity pane, saying why, when herdr refuses the split', async ($, on) => {
  const tab = herdr(on)
  tab.failing.add('split')
  const seen = session(on, IN_HERDR)

  await $.session.start(START)

  expect(seen.opened).toEqual(['activity'])
  expect(seen.toasts[0]).toMatch(/^The herdr column could not be opened \(herdr pane split: split refused\)/)
})

test('without a TMPDIR the feed goes under ~/.claude, never the shared /tmp', async ($, on) => {
  herdr(on)
  const { TMPDIR: _unset, ...env } = IN_HERDR
  const seen = session(on, { ...env, HOME: '/Users/me' })

  await $.session.start(START)

  expect(seen.written.at(-1)?.path).toBe('/Users/me/.claude/activity/claude-activity/w0-p1.json')
})
