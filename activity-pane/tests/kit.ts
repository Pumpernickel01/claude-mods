import { mock } from 'claude-code/testing'
import type { On } from 'claude-code'

export const BIN = '/opt/homebrew/bin/herdr'

type Other = (argv: readonly string[]) => string | undefined

// herdr as the mod sees it: panes with heights and widths, split, closed, swapped, renamed
// and run in; the window `width` wide, a right split giving the split pane the share
// `--ratio` names and the new pane the rest. `other` answers any other program,
// its stdout or undefined to fail it.
export function herdr(on: On, { height = 61, width: start = 218, other }: { height?: number; width?: number; other?: Other } = {}) {
  let width = start
  const panes = new Map<string, number>([['w0:p1', height]])
  const widths = new Map<string, number>([['w0:p1', start]])
  // the tab each pane is in, and the workspaces by label: Claude's tab is w0:t1
  const tabs = new Map<string, string>([['w0:p1', 'w0:t1']])
  // the activity session's workspaces by label: none until the mod makes one
  const workspaces = new Map<string, string>()
  // the herdr session each call went to ('' for Claude's own), and the lock folder made and removed
  const sessions: string[] = []
  const locks: string[][] = []
  let isDown = false
  // when the activity server started: its socket's mtime
  let startedAt = 1_000
  const SOCKET = '/Users/me/.config/herdr/sessions/activity/herdr.sock'
  on('fs.stat', (_$, e) =>
    e.path === SOCKET && !isDown ? { value: { kind: 'other', size: 0, mtimeMs: startedAt, isLink: false } } : { error: new Error('ENOENT') },
  )
  let madeTabs = 1
  const ran: string[][] = []
  const failing = new Set<string>()
  const installs: string[][] = []
  let made = 1

  on('process.run', (_$, e) => {
    const answer = (stdout: string, exitCode = 0, stderr = '') => ({
      value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false },
    })
    if (e.argv[0] === 'mkdir' || e.argv[0] === 'rmdir') {
      locks.push([...e.argv])

      return answer('')
    }
    if (e.argv[0] === 'install') {
      installs.push(e.argv.slice(1))

      return answer('')
    }
    if (e.argv[0] !== BIN) {
      const stdout = other?.(e.argv)

      return stdout === undefined ? answer('', 1, 'not in this test') : answer(stdout)
    }

    if (e.argv[1] === 'session' && e.argv[2] === 'list') {
      const sessions = [{ name: 'activity', running: !isDown, socket_path: SOCKET }]

      return answer(JSON.stringify({ sessions }))
    }
    const isActivity = e.argv[1] === '--session'
    const args = e.argv.slice(isActivity ? 3 : 1)
    ran.push(args)
    sessions.push(isActivity ? (e.argv[2] ?? '') : '')
    if (isActivity && isDown) return answer('', 1, '{"error":{"code":"server_not_running"}}')
    const flag = (name: string) => args[args.indexOf(name) + 1] ?? ''
    const verb = args[1] ?? ''

    if (failing.has(verb)) return answer('', 1, `${verb} refused`)
    // A new tab is the size of the window, as herdr makes one for the last client size.
    const newTab = (workspace: string) => {
      madeTabs += 1
      made += 1
      const [tab, pane] = [`w0:t${madeTabs}`, `w0:p${made}`]
      panes.set(pane, height)
      widths.set(pane, width)
      tabs.set(pane, tab)

      return { tab: { tab_id: tab, workspace_id: workspace }, root_pane: { pane_id: pane, tab_id: tab } }
    }
    if (args[0] === 'workspace' && verb === 'list') {
      const list = [...workspaces].map(([label, workspace_id]) => ({ label, workspace_id }))

      return answer(JSON.stringify({ result: { workspaces: list } }))
    }
    if (args[0] === 'workspace' && verb === 'create') {
      const id = `w${workspaces.size}`
      workspaces.set(flag('--label'), id)

      return answer(JSON.stringify({ result: { workspace: { workspace_id: id }, ...newTab(id) } }))
    }
    if (args[0] === 'tab' && verb === 'create') return answer(JSON.stringify({ result: newTab(flag('--workspace')) }))
    if (args[0] === 'tab' && verb === 'close') {
      for (const [pane, tab] of tabs) if (tab === args[2]) {
        panes.delete(pane)
        widths.delete(pane)
        tabs.delete(pane)
      }

      return answer('{}')
    }
    if (args[0] === 'tab') return answer('{}')
    if (verb === 'split') {
      const from = flag('--pane')
      const tall = panes.get(from)
      if (tall === undefined) return answer('', 1, 'pane not found')

      made += 1
      const id = `w0:p${made}`
      const wide = widths.get(from) ?? 0
      if (flag('--direction') === 'down') {
        const kept = Math.round(tall * Number(flag('--ratio')))
        panes.set(from, kept)
        panes.set(id, tall - kept)
        widths.set(id, wide)
        tabs.set(id, tabs.get(from) ?? '')
      } else {
        const kept = Math.round(wide * Number(flag('--ratio')))
        widths.set(from, kept)
        widths.set(id, wide - kept)
        panes.set(id, tall)
        tabs.set(id, tabs.get(from) ?? '')
      }

      return answer(JSON.stringify({ result: { pane: { pane_id: id } } }))
    }
    if (verb === 'layout') {
      const list = [...panes].map(([pane_id, rows]) => ({ pane_id, rect: { width: widths.get(pane_id) ?? 0, height: rows } }))

      return answer(JSON.stringify({ result: { layout: { panes: list } } }))
    }
    if (verb === 'get') return panes.has(args[2] ?? '') ? answer('{}') : answer('', 1, 'pane not found')
    if (verb === 'close') {
      panes.delete(args[2] ?? '')
      widths.delete(args[2] ?? '')

      return answer('{}')
    }
    if (verb === 'swap') {
      const [one, two] = [flag('--source-pane'), flag('--target-pane')]
      const [a, b] = [panes.get(one) ?? 0, panes.get(two) ?? 0]
      panes.set(one, b)
      panes.set(two, a)
    }

    return answer('{}')
  })

  return {
    panes,
    widths,
    tabs,
    workspaces,
    sessions,
    locks,
    // the activity session's server stopped: every call to it fails
    stop: () => {
      isDown = true
    },
    // the activity server stopped and started again: its ids begin anew and may name other panes
    restart: () => {
      isDown = false
      startedAt += 1
    },
    ran,
    failing,
    installs,
    // The window resized: tabs made from now on take the new width.
    widen: (columns: number) => {
      width = columns
    },
    // A viewer quit by hand: herdr hands its rows to the pane beside it.
    quit: (pane: string, into: string) => {
      panes.set(into, (panes.get(into) ?? 0) + (panes.get(pane) ?? 0))
      panes.delete(pane)
    },
    splits: () => ran.filter(args => args[1] === 'split'),
    runs: () => ran.filter(args => args[1] === 'run'),
    closes: () => ran.filter(args => args[0] === 'pane' && args[1] === 'close').map(args => args[2]),
    tabCloses: () => ran.filter(args => args[0] === 'tab' && args[1] === 'close').map(args => args[2]),
    // the panes in the Activity workspace's tabs, Claude's own tab left out
    activity: () => [...panes.keys()].filter(pane => tabs.get(pane) !== 'w0:t1'),
  }
}

export function session(on: On, env: Record<string, string>, root = '/Users/me/lab2', stored: Record<string, unknown> = {}) {
  mock.env(on, env)
  mock.store(on, stored)
  const written: { path: string; text: string }[] = []
  const opened: string[] = []
  const toasts: string[] = []

  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('session.root', () => ({ value: root }))
  on('session.id', () => ({ value: 's1' }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('fs.write', (_$, e) => {
    written.push({ path: e.path, text: e.text })

    return { value: undefined }
  })
  on('ui.open', (_$, e) => {
    opened.push(e.id)

    return { value: { isPlaced: true } }
  })
  on('ui.toast', (_$, e) => {
    toasts.push(String(e.text))

    return { value: undefined }
  })

  return { written, opened, toasts }
}

export const IN_HERDR = { HERDR_ENV: '1', HERDR_PANE_ID: 'w0:p1', HERDR_WORKSPACE_ID: 'w0', HERDR_BIN_PATH: BIN, TMPDIR: '/tmp/t/', HOME: '/Users/me' }
