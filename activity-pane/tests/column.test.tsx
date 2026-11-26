import { expect, test } from 'claude-code/testing'

import { IN_HERDR, herdr, session } from './kit'

const FEED = '/Users/me/.claude/activity/w0-p1.json'
const START = { cwd: '/Users/me/lab2', surface: 'terminal', isInteractive: true } as const
const RESUME = { id: 's1', isResumable: true } as never

const typed = (command: string) =>
  ({ command, args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 218 } }) as const


// A narrow window. Every tab has the git strip: p2 Files, p3 Data flow, p4 Shell, p5 Tools,
// p6 Branches, p7 Commits.
const NARROW = { width: 110 }
const SIX = ['w0:p2', 'w0:p3', 'w0:p4', 'w0:p5', 'w0:p6', 'w0:p7']
const OPEN = 'Activity panels open in the herdr session "activity".'

test('opens the column in a new "Activity" workspace, not beside Claude: data flow, shell, tools', async ($, on) => {
  const tab = herdr(on, NARROW)
  const seen = session(on, IN_HERDR)

  await $.session.start(START)

  // nothing is split off Claude's pane, and nothing takes focus
  expect(tab.splits().filter(args => args[3] === 'w0:p1')).toEqual([])
  expect(tab.ran).toContainEqual(['workspace', 'create', '--label', 'Activity', '--cwd', '/Users/me/lab2', '--focus'])
  // every call goes to the activity session, for the second window to show
  expect(new Set(tab.sessions)).toEqual(new Set(['activity']))
  // the workspace is looked for and made holding the lock
  expect(tab.locks).toEqual([['mkdir', '/Users/me/.claude/activity/workspace.lock'], ['rmdir', '/Users/me/.claude/activity/workspace.lock']])
  expect(tab.ran).toContainEqual(['tab', 'rename', 'w0:t2', 'lab2'])
  expect(tab.splits()[0]).toEqual(['pane', 'split', '--pane', 'w0:p2', '--direction', 'right', '--ratio', '0.4000', '--cwd', '/Users/me/lab2', '--no-focus'])
  expect(tab.splits().slice(1, 3)).toEqual([
    ['pane', 'split', '--pane', 'w0:p3', '--direction', 'down', '--ratio', '0.1803', '--cwd', '/Users/me/lab2', '--no-focus'],
    ['pane', 'split', '--pane', 'w0:p4', '--direction', 'down', '--ratio', '0.8600', '--cwd', '/Users/me/lab2', '--no-focus'],
  ])
  expect(tab.activity().sort()).toEqual(SIX)
  // 9 rows for the data flow, 5 for the tools, each with herdr's 2-row frame; the shell the rest.
  expect([tab.panes.get('w0:p3'), tab.panes.get('w0:p4'), tab.panes.get('w0:p5')]).toEqual([11, 43, 7])

  const runs = tab.runs()
  expect(runs.find(args => args[2] === 'w0:p3')?.[3]).toMatch(/^exec node '.*\/viewer\/flow\.mjs' '\/Users\/me\/\.claude\/activity\/w0-p1\.json'$/)
  expect(runs.find(args => args[2] === 'w0:p5')?.[3]).toMatch(/^exec node '.*\/viewer\/tools\.mjs' '\/Users\/me\/\.claude\/activity\/w0-p1\.json'$/)
  expect(runs.find(args => args[2] === 'w0:p4')?.[3]).toMatch(/^exec python3 '.*\/viewer\/shell_tabs\.py' '\/Users\/me\/\.claude\/activity\/w0-p1\.json'$/)
  expect(tab.ran.filter(args => args[0] === 'pane' && args[1] === 'rename').map(args => args.slice(2))).toEqual(
    expect.arrayContaining([['w0:p4', 'Shell'], ['w0:p3', 'Data flow'], ['w0:p5', 'Tools']]),
  )

  expect(seen.opened).toEqual([])
  expect(seen.written.at(-1)?.path).toBe(FEED)
  expect(JSON.parse(seen.written.at(-1)?.text ?? '{}')).toEqual({ calls: [], flows: [], session: 's1' })
})

test('a second session gets its own tab, named after its folder, in the same Activity workspace', async ($, on) => {
  const tab = herdr(on, NARROW)
  tab.workspaces.set('Activity', 'w7')
  session(on, IN_HERDR)

  await $.session.start(START)

  expect(tab.ran.filter(args => args[0] === 'workspace' && args[1] === 'create')).toEqual([])
  expect(tab.ran).toContainEqual(['tab', 'create', '--workspace', 'w7', '--label', 'lab2', '--cwd', '/Users/me/lab2', '--no-focus'])
  expect(tab.activity().sort()).toEqual(SIX)
})

test('a restored workspace that lost its label is named "Activity" again, not after a folder', async ($, on) => {
  const tab = herdr(on, NARROW)
  tab.workspaces.set('inosport-crm', 'w3')
  session(on, IN_HERDR)

  await $.session.start(START)

  expect(tab.ran).toContainEqual(['workspace', 'rename', 'w3', 'Activity'])
  expect(tab.ran).toContainEqual(['tab', 'create', '--workspace', 'w3', '--label', 'lab2', '--cwd', '/Users/me/lab2', '--no-focus'])
})

test('a column left beside Claude by the old mod stays on reload; /activity moves it to the Activity workspace', async ($, on) => {
  const tab = herdr(on, NARROW)
  // the old shape: three panes in Claude's own tab, no `tab` stored
  session(on, IN_HERDR, '/Users/me/lab2', { 'column:w0:p1': { flow: 'w0:p8', shell: 'w0:p9', tools: 'w0:pA' } })
  for (const pane of ['w0:p8', 'w0:p9', 'w0:pA']) {
    tab.panes.set(pane, 20)
    tab.tabs.set(pane, 'w0:t1')
  }

  await $.session.start(START)
  expect(tab.ran.filter(args => args[1] === 'split' || args[1] === 'create' || args[1] === 'close')).toEqual([])

  expect((await $.command.run(typed('activity'))).text).toBe(OPEN)
  expect(tab.closes().sort()).toEqual(['w0:p8', 'w0:p9', 'w0:pA'])
  expect(tab.activity()).toHaveLength(6)
  // the old panes live in Claude's own session, so they are checked and closed there
  const inMain = tab.ran.filter((_, at) => tab.sessions[at] === '')
  expect(inMain.filter(args => args[1] === 'close').map(args => args[2]).sort()).toEqual(['w0:p8', 'w0:p9', 'w0:pA'])
  expect(inMain.filter(args => args[1] !== 'get' && args[1] !== 'close')).toEqual([])
})

test('/activity with the Activity window closed keeps an old column beside Claude', async ($, on) => {
  const tab = herdr(on, NARROW)
  tab.stop()
  session(on, IN_HERDR, '/Users/me/lab2', { 'column:w0:p1': { flow: 'w0:p8', shell: 'w0:p9', tools: 'w0:pA' } })
  for (const pane of ['w0:p8', 'w0:p9', 'w0:pA']) tab.panes.set(pane, 20)
  await $.session.start(START)

  const text = (await $.command.run(typed('activity'))).text
  expect(text).toMatch(/^The Activity window is not open/)
  expect(tab.closes()).toEqual([])
})

test('after the activity server restarts, a stored tab is forgotten, never closed: its ids may be another session\'s', async ($, on) => {
  const tab = herdr(on, NARROW)
  session(on, IN_HERDR)
  await $.session.start(START)
  expect(tab.activity().sort()).toEqual(SIX)

  tab.restart()
  // leaving now closes nothing: the stored tab id belongs to the old server
  await $.session.end({ reason: 'prompt_input_exit', sessionId: 's1', resume: RESUME })
  expect(tab.tabCloses()).toEqual([])
})

test('a reload after the activity server restarts builds a new tab and closes none', async ($, on) => {
  const tab = herdr(on, NARROW)
  session(on, IN_HERDR)
  await $.session.start(START)

  tab.restart()
  await $.session.start(START)
  expect(tab.tabCloses()).toEqual([])
  expect(tab.splits()).toHaveLength(10)

  // the new tab is this server's: leaving closes it
  await $.session.end({ reason: 'prompt_input_exit', sessionId: 's1', resume: RESUME })
  expect(tab.tabCloses()).toEqual(['w0:t3'])
})

test('with the Activity window closed, says how to open it and keeps Claude\'s pane whole', async ($, on) => {
  const tab = herdr(on, NARROW)
  tab.stop()
  const seen = session(on, IN_HERDR)

  await $.session.start(START)

  expect(seen.opened).toEqual([])
  expect(seen.toasts).toEqual(['The Activity window is not open: run `herdr session attach activity` in a second terminal window, then /activity.'])
})

test('an old column beside Claude with all its panes gone is replaced at start, not left blocking', async ($, on) => {
  const tab = herdr(on, NARROW)
  session(on, IN_HERDR, '/Users/me/lab2', { 'column:w0:p1': { flow: 'w0:p8', shell: 'w0:p9', tools: 'w0:pA' } })

  await $.session.start(START)

  expect(tab.activity().sort()).toEqual(SIX)
})

test('keeps the same column when the mod reloads', async ($, on) => {
  const tab = herdr(on, NARROW)
  session(on, IN_HERDR)

  await $.session.start(START)
  await $.session.start(START)

  expect(tab.splits()).toHaveLength(5)
  expect(tab.panes.size).toBe(7)
})

test('/activity brings back a viewer that was quit, leaving the shell as it is', async ($, on) => {
  const tab = herdr(on, NARROW)
  session(on, IN_HERDR)
  await $.session.start(START)

  // q in the tools viewer: its pane closes and the shell takes its rows.
  tab.quit('w0:p5', 'w0:p4')
  expect((await $.command.run(typed('activity'))).text).toBe(OPEN)
  expect(tab.splits().at(-1)?.slice(2, 4)).toEqual(['--pane', 'w0:p4'])
  expect([tab.panes.get('w0:p4'), tab.panes.get('w0:p8')]).toEqual([43, 7])
  expect(tab.runs().at(-1)?.slice(2, 3)).toEqual(['w0:p8'])

  // And the data flow viewer: made below the shell, then swapped above it.
  tab.quit('w0:p3', 'w0:p4')
  await $.command.run(typed('activity'))
  expect(tab.ran.filter(args => args[1] === 'swap')).toEqual([['pane', 'swap', '--source-pane', 'w0:p4', '--target-pane', 'w0:p9']])
  expect([tab.panes.get('w0:p9'), tab.panes.get('w0:p4')]).toEqual([11, 43])
  expect(tab.runs().at(-1)?.slice(2, 3)).toEqual(['w0:p9'])
  expect(tab.closes()).toEqual([])
})

test('makes the whole column again when its shell is gone, closing what was left of it', async ($, on) => {
  const tab = herdr(on, NARROW)
  session(on, IN_HERDR)
  await $.session.start(START)

  tab.panes.delete('w0:p4')
  await $.command.run(typed('activity'))

  expect(tab.tabCloses()).toEqual(['w0:t2'])
  expect(tab.splits()).toHaveLength(10)
  expect(tab.activity()).toHaveLength(6)
  expect(tab.activity()).not.toContain('w0:p2')
})

test('closes the column when Claude exits, and keeps it through a /clear', async ($, on) => {
  const tab = herdr(on, NARROW)
  session(on, IN_HERDR)
  await $.session.start(START)

  await $.session.end({ reason: 'clear', sessionId: 's1', resume: RESUME })
  expect(tab.tabCloses()).toEqual([])

  await $.session.end({ reason: 'prompt_input_exit', sessionId: 's2', resume: RESUME })
  expect(tab.tabCloses()).toEqual(['w0:t2'])
  expect([...tab.panes.keys()]).toEqual(['w0:p1'])
})

test('outside herdr, opens the Activity pane inside Claude as before', async ($, on) => {
  const tab = herdr(on, NARROW)
  const seen = session(on, { TMPDIR: '/tmp/t/' })

  await $.session.start(START)

  expect(seen.opened).toEqual(['activity'])
  expect(tab.ran).toEqual([])
  expect(seen.written).toEqual([])
})

test('opens the column however narrow Claude\'s pane is: it no longer shares Claude\'s tab', async ($, on) => {
  const tab = herdr(on, NARROW)
  tab.widths.set('w0:p1', 60)
  const seen = session(on, IN_HERDR)

  await $.session.start(START)

  expect(seen.opened).toEqual([])
  expect(tab.activity()).toHaveLength(6)
})

test('falls back to the Activity pane, saying why, when herdr refuses the split', async ($, on) => {
  const tab = herdr(on, NARROW)
  tab.failing.add('split')
  const seen = session(on, IN_HERDR)

  await $.session.start(START)

  expect(seen.opened).toEqual(['activity'])
  expect(seen.toasts[0]).toMatch(/^The herdr column could not be opened \(herdr pane split: split refused\)/)
  expect(tab.tabCloses()).toEqual(['w0:t2'])
})

test('the feed lives in a folder only this user can read, under ~/.claude whatever TMPDIR says', async ($, on) => {
  const tab = herdr(on, NARROW)
  const seen = session(on, IN_HERDR)

  await $.session.start(START)

  expect(tab.installs).toEqual([['-d', '-m', '700', '/Users/me/.claude/activity']])
  expect(seen.written.at(-1)?.path).toBe('/Users/me/.claude/activity/w0-p1.json')
})

// A 245-column, 61-row window: the strip takes 40 % (98), the column the rest (147).
const WIDE = { width: 245 }
const gitRuns = (tab: ReturnType<typeof herdr>) => tab.runs().filter(args => /viewer\/git_/.test(args[3] ?? ''))

test('git strip: the strip keeps 40 % of the tab, the column the rest, rows as before', async ($, on) => {
  const tab = herdr(on, WIDE)
  session(on, IN_HERDR)

  await $.session.start(START)

  // Claude's pane is not touched
  expect(tab.widths.get('w0:p1')).toBe(245)
  // p2 Files, p3 Data flow, p4 Shell, p5 Tools, p6 Branches, p7 Commits
  expect(['w0:p2', 'w0:p3', 'w0:p4', 'w0:p5', 'w0:p6', 'w0:p7'].map(pane => tab.widths.get(pane))).toEqual([98, 147, 147, 147, 98, 98])
  expect([tab.panes.get('w0:p3'), tab.panes.get('w0:p4'), tab.panes.get('w0:p5')]).toEqual([11, 43, 7])
  // about 40 / 20 / 40 % of 61 rows
  expect([tab.panes.get('w0:p2'), tab.panes.get('w0:p6'), tab.panes.get('w0:p7')]).toEqual([24, 12, 25])
  expect(tab.splits().map(args => args.slice(2, 6))).toEqual([
    ['--pane', 'w0:p2', '--direction', 'right'],
    ['--pane', 'w0:p3', '--direction', 'down'],
    ['--pane', 'w0:p4', '--direction', 'down'],
    ['--pane', 'w0:p2', '--direction', 'down'],
    ['--pane', 'w0:p6', '--direction', 'down'],
  ])

  expect(tab.runs().find(args => args[2] === 'w0:p2')?.[3]).toMatch(/^exec node '.*\/viewer\/git_files\.mjs' '\/Users\/me\/lab2'$/)
  expect(tab.runs().find(args => args[2] === 'w0:p6')?.[3]).toMatch(/^exec node '.*\/viewer\/git_branches\.mjs' '\/Users\/me\/lab2'$/)
  expect(tab.runs().find(args => args[2] === 'w0:p7')?.[3]).toMatch(/^exec node '.*\/viewer\/git_commits\.mjs' '\/Users\/me\/lab2'$/)
  expect(tab.ran.filter(args => args[0] === 'pane' && args[1] === 'rename').map(args => args.slice(2))).toEqual(
    expect.arrayContaining([['w0:p2', 'Files'], ['w0:p6', 'Branches'], ['w0:p7', 'Commits'], ['w0:p4', 'Shell']]),
  )

  // a reload keeps it all
  await $.session.start(START)
  expect(tab.splits()).toHaveLength(5)
})

test('git strip: a narrow tab gets the strip too, at the same share', async ($, on) => {
  const tab = herdr(on, { width: 80 })
  session(on, IN_HERDR)

  await $.session.start(START)

  expect(gitRuns(tab)).toHaveLength(3)
  expect([tab.widths.get('w0:p2'), tab.widths.get('w0:p3')]).toEqual([32, 48])
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
  expect(tab.splits()).toHaveLength(6)

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

test('git strip: /activity rebuilds a column made without the strip, once skipped in a narrow window', async ($, on) => {
  const tab = herdr(on, NARROW)
  session(on, IN_HERDR, '/Users/me/lab2', { 'column:w0:p1': { tab: 'w0:t9', flow: 'w0:p8', shell: 'w0:p9', tools: 'w0:pA' } })
  for (const pane of ['w0:p8', 'w0:p9', 'w0:pA']) {
    tab.panes.set(pane, 20)
    tab.tabs.set(pane, 'w0:t9')
  }

  // a reload keeps it as it is
  await $.session.start(START)
  expect(gitRuns(tab)).toEqual([])

  await $.command.run(typed('activity'))
  expect(gitRuns(tab)).toHaveLength(3)
  expect(tab.tabCloses()).toEqual(['w0:t9'])
})

test('git strip: leaving Claude closes its panes too', async ($, on) => {
  const tab = herdr(on, WIDE)
  session(on, IN_HERDR)
  await $.session.start(START)

  await $.session.end({ reason: 'prompt_input_exit', sessionId: 's2', resume: RESUME })
  expect(tab.tabCloses()).toEqual(['w0:t2'])
  expect([...tab.panes.keys()]).toEqual(['w0:p1'])
})

test('git strip: a build that fails closes every pane it made, the strip\'s too', async ($, on) => {
  const tab = herdr(on, WIDE)
  tab.failing.add('rename')
  session(on, IN_HERDR)

  await $.session.start(START)

  expect(tab.tabCloses()).toEqual(['w0:t2'])
  expect([...tab.panes.keys()]).toEqual(['w0:p1'])
})
