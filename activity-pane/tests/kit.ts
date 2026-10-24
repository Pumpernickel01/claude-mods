import { mock } from 'claude-code/testing'
import type { On } from 'claude-code'

export const BIN = '/opt/homebrew/bin/herdr'

type Other = (argv: readonly string[]) => string | undefined

// herdr as the mod sees it: panes with heights, split, closed, swapped, renamed
// and run in; Claude's pane `width` wide. `other` answers any other program,
// its stdout or undefined to fail it.
export function herdr(on: On, { height = 61, width = 218, other }: { height?: number; width?: number; other?: Other } = {}) {
  const panes = new Map<string, number>([['w0:p1', height]])
  const ran: string[][] = []
  const failing = new Set<string>()
  let made = 1

  on('process.run', (_$, e) => {
    const answer = (stdout: string, exitCode = 0, stderr = '') => ({
      value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false },
    })
    if (e.argv[0] !== BIN) {
      const stdout = other?.(e.argv)

      return stdout === undefined ? answer('', 1, 'not in this test') : answer(stdout)
    }

    const args = e.argv.slice(1)
    ran.push(args)
    const flag = (name: string) => args[args.indexOf(name) + 1] ?? ''
    const verb = args[1] ?? ''

    if (failing.has(verb)) return answer('', 1, `${verb} refused`)
    if (verb === 'split') {
      const from = flag('--pane')
      const tall = panes.get(from)
      if (tall === undefined) return answer('', 1, 'pane not found')

      made += 1
      const id = `w0:p${made}`
      if (flag('--direction') === 'down') {
        const kept = Math.round(tall * Number(flag('--ratio')))
        panes.set(from, kept)
        panes.set(id, tall - kept)
      } else {
        panes.set(id, tall)
      }

      return answer(JSON.stringify({ result: { pane: { pane_id: id } } }))
    }
    if (verb === 'layout') {
      const split = panes.size > 1
      const list = [...panes].map(([pane_id, rows]) => ({
        pane_id,
        rect: { width: pane_id === 'w0:p1' && !split ? width : Math.floor(width / 2), height: rows },
      }))

      return answer(JSON.stringify({ result: { layout: { panes: list } } }))
    }
    if (verb === 'get') return panes.has(args[2] ?? '') ? answer('{}') : answer('', 1, 'pane not found')
    if (verb === 'close') {
      panes.delete(args[2] ?? '')

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
    ran,
    failing,
    // A viewer quit by hand: herdr hands its rows to the pane beside it.
    quit: (pane: string, into: string) => {
      panes.set(into, (panes.get(into) ?? 0) + (panes.get(pane) ?? 0))
      panes.delete(pane)
    },
    splits: () => ran.filter(args => args[1] === 'split'),
    runs: () => ran.filter(args => args[1] === 'run'),
    closes: () => ran.filter(args => args[1] === 'close').map(args => args[2]),
  }
}

export function session(on: On, env: Record<string, string>) {
  mock.env(on, env)
  mock.store(on)
  const written: { path: string; text: string }[] = []
  const opened: string[] = []
  const toasts: string[] = []

  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('session.root', () => ({ value: '/Users/me/lab2' }))
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

export const IN_HERDR = { HERDR_ENV: '1', HERDR_PANE_ID: 'w0:p1', HERDR_BIN_PATH: BIN, TMPDIR: '/tmp/t/' }
