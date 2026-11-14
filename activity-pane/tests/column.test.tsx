import { expect, test } from 'claude-code/testing'

import { IN_HERDR, herdr, session } from './kit'

const FEED = '/Users/me/.claude/activity/w0-p1.json'
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
  expect(runs.find(args => args[2] === 'w0:p2')?.[3]).toMatch(/^exec node '.*\/viewer\/flow\.mjs' '\/Users\/me\/\.claude\/activity\/w0-p1\.json'$/)
  expect(runs.find(args => args[2] === 'w0:p4')?.[3]).toMatch(/^exec node '.*\/viewer\/tools\.mjs' '\/Users\/me\/\.claude\/activity\/w0-p1\.json'$/)
  expect(runs.find(args => args[2] === 'w0:p3')?.[3]).toMatch(/^exec python3 '.*\/viewer\/shell_tabs\.py' '\/Users\/me\/\.claude\/activity\/w0-p1\.json'$/)
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

test('the feed lives in a folder only this user can read, under ~/.claude whatever TMPDIR says', async ($, on) => {
  const tab = herdr(on)
  const seen = session(on, IN_HERDR)

  await $.session.start(START)

  expect(tab.installs).toEqual([['-d', '-m', '700', '/Users/me/.claude/activity']])
  expect(seen.written.at(-1)?.path).toBe('/Users/me/.claude/activity/w0-p1.json')
})

// A 245-column, 61-row window: Claude keeps 123, the right half (122) is wide enough for the git strip.
const WIDE = { width: 245 }
const gitRuns = (tab: ReturnType<typeof herdr>) => tab.runs().filter(args => /viewer\/git_/.test(args[3] ?? ''))

test('git strip: Claude keeps its 123 columns, the strip 52 and the column the other 70, rows as before', async ($, on) => {
  const tab = herdr(on, WIDE)
  session(on, IN_HERDR)

  await $.session.start(START)

  // the first split is today's, so Claude's pane is the size it always was
  expect(tab.splits()[0]).toEqual(['pane', 'split', '--pane', 'w0:p1', '--direction', 'right', '--ratio', '0.5000', '--cwd', '/Users/me/lab2', '--no-focus'])
  expect(tab.widths.get('w0:p1')).toBe(123)
  // p2 Files, p3 Data flow, p4 Shell, p5 Tools, p6 Branches, p7 Commits
  expect(['w0:p2', 'w0:p3', 'w0:p4', 'w0:p5', 'w0:p6', 'w0:p7'].map(pane => tab.widths.get(pane))).toEqual([52, 70, 70, 70, 52, 52])
  expect([tab.panes.get('w0:p3'), tab.panes.get('w0:p4'), tab.panes.get('w0:p5')]).toEqual([11, 43, 7])
  // about 40 / 20 / 40 % of 61 rows
  expect([tab.panes.get('w0:p2'), tab.panes.get('w0:p6'), tab.panes.get('w0:p7')]).toEqual([24, 12, 25])
  expect(tab.splits().map(args => args.slice(2, 6))).toEqual([
    ['--pane', 'w0:p1', '--direction', 'right'],
    ['--pane', 'w0:p2', '--direction', 'right'],
    ['--pane', 'w0:p3', '--direction', 'down'],
    ['--pane', 'w0:p4', '--direction', 'down'],
    ['--pane', 'w0:p2', '--direction', 'down'],
    ['--pane', 'w0:p6', '--direction', 'down'],
  ])

  expect(tab.runs().find(args => args[2] === 'w0:p2')?.[3]).toMatch(/^exec node '.*\/viewer\/git_files\.mjs' '\/Users\/me\/lab2'$/)
  expect(tab.runs().find(args => args[2] === 'w0:p6')?.[3]).toMatch(/^exec node '.*\/viewer\/git_branches\.mjs' '\/Users\/me\/lab2'$/)
  expect(tab.runs().find(args => args[2] === 'w0:p7')?.[3]).toMatch(/^exec node '.*\/viewer\/git_commits\.mjs' '\/Users\/me\/lab2'$/)
  expect(tab.ran.filter(args => args[1] === 'rename').map(args => args.slice(2))).toEqual(
    expect.arrayContaining([['w0:p2', 'Files'], ['w0:p6', 'Branches'], ['w0:p7', 'Commits'], ['w0:p4', 'Shell']]),
  )

  // a reload keeps it all
  await $.session.start(START)
  expect(tab.splits()).toHaveLength(6)
})

test('git strip: a right half too narrow for it builds today\'s column and no git panes', async ($, on) => {
  const tab = herdr(on, { width: 239 }) // Claude keeps 120, the right half is 119: one short of 52 + 68
  session(on, IN_HERDR)

  await $.session.start(START)

  expect(tab.splits()).toHaveLength(3)
  expect(tab.panes.size).toBe(4)
  expect(gitRuns(tab)).toEqual([])
  expect([tab.panes.get('w0:p2'), tab.panes.get('w0:p3'), tab.panes.get('w0:p4')]).toEqual([11, 43, 7])
})

test('git strip: one pane of it closed is made again below a neighbour and restarted', async ($, on) => {
  const tab = herdr(on, WIDE)
  session(on, IN_HERDR)
  await $.session.start(START)

  tab.quit('w0:p6', 'w0:p2')
  await $.command.run(typed('activity'))

  expect(tab.splits().at(-1)?.slice(2, 6)).toEqual(['--pane', 'w0:p2', '--direction', 'down'])
  expect(tab.runs().at(-1)?.slice(2)).toEqual(['w0:p8', expect.stringMatching(/viewer\/git_branches\.mjs/)])
  expect(tab.ran.filter(args => args[1] === 'rename').at(-1)?.slice(2)).toEqual(['w0:p8', 'Branches'])
  expect(tab.splits()).toHaveLength(7)

  // the top pane: made below Branches, then swapped above it
  tab.quit('w0:p2', 'w0:p8')
  await $.command.run(typed('activity'))
  expect(tab.ran.filter(args => args[1] === 'swap')).toHaveLength(1)
  expect(tab.runs().at(-1)?.slice(2)).toEqual(['w0:p9', expect.stringMatching(/viewer\/git_files\.mjs/)])
})

test('git strip: with all three closed, /activity leaves them closed', async ($, on) => {
  const tab = herdr(on, WIDE)
  session(on, IN_HERDR)
  await $.session.start(START)
  const before = tab.splits().length
  const runs = tab.runs().length

  for (const pane of ['w0:p2', 'w0:p6', 'w0:p7']) tab.panes.delete(pane)
  await $.command.run(typed('activity'))

  expect(tab.splits()).toHaveLength(before)
  expect(tab.runs()).toHaveLength(runs)
})

test('git strip: a column stored without one is never given one, even when it is rebuilt', async ($, on) => {
  const tab = herdr(on, { width: 218 })
  session(on, IN_HERDR)
  await $.session.start(START)
  expect(tab.panes.size).toBe(4)

  // the window is wide now, and the old shell is gone: the column is made again as it was
  tab.widths.set('w0:p1', 245)
  tab.panes.delete('w0:p3')
  await $.command.run(typed('activity'))

  expect(gitRuns(tab)).toEqual([])
  expect(tab.panes.size).toBe(4)
})

test('git strip: leaving Claude closes its panes too', async ($, on) => {
  const tab = herdr(on, WIDE)
  session(on, IN_HERDR)
  await $.session.start(START)

  await $.session.end({ reason: 'prompt_input_exit', sessionId: 's2', resume: RESUME })
  expect(tab.closes().sort()).toEqual(['w0:p2', 'w0:p3', 'w0:p4', 'w0:p5', 'w0:p6', 'w0:p7'])
  expect([...tab.panes.keys()]).toEqual(['w0:p1'])
})

test('git strip: a build that fails closes every pane it made, the strip\'s too', async ($, on) => {
  const tab = herdr(on, WIDE)
  tab.failing.add('rename')
  session(on, IN_HERDR)

  await $.session.start(START)

  expect(tab.closes().sort()).toEqual(['w0:p2', 'w0:p3', 'w0:p4', 'w0:p5', 'w0:p6', 'w0:p7'])
})
