import { expect, mock, test } from 'claude-code/testing'
import type { On, ProcessRunResult, ProcessSpawnChunk } from 'claude-code'

const HOME = '/Users/me'
const DIR = `${HOME}/Library/Application Support/claude-gesture-vscode`
const SESSIONS = `${DIR}/sessions.json`
const ROOT = '/Users/me/KTU/lab2'
const START = { cwd: ROOT, surface: 'terminal', isInteractive: true } as const
// Each settle waits out the helper's stream, which never ends on its own, so these run slow.
const SLOW = { timeoutMs: 30_000 }
const RESUME = { id: 's1', isResumable: true } as never

const typed = (args: string) =>
  ({ command: 'gesture', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } }) as const

const ran = (exitCode: number): { value: ProcessRunResult } => ({
  value: { exitCode, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
})

// One helper the plugin started: what it is told to say, and how it ends.
type Life = { argv: readonly string[]; say: (text: string) => void; exit: (code: number) => void }

// The world beneath the mod: a folder of files, the session, the commands it
// runs (`code` answering as `codeExit` says) and the helpers it starts.
function world(on: On, options: { files?: Record<string, string>; codeExit?: (argv: readonly string[]) => number } = {}) {
  const clock = mock.clock(on, { now: 1_000 })
  mock.env(on, { HOME })
  const files = new Map(Object.entries(options.files ?? {}))
  const runs: (readonly string[])[] = []
  const lives: Life[] = []
  const statuses: (string | undefined)[] = []
  const toasts: string[] = []
  const commands: string[] = []

  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('session.id', () => ({ value: 's1' }))
  on('session.root', () => ({ value: ROOT }))
  on('command.register', (_$, e) => {
    commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('ui.status', (_$, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('fs.read', (_$, e) => {
    const text = files.get(e.path)
    return text === undefined ? { deny: `ENOENT ${e.path}` } : { value: text }
  })
  on('fs.write', (_$, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  // The helper is built, newer than its source.
  on('fs.stat', (_$, e) => ({
    value: { kind: 'file', size: 1, isLink: false, mtimeMs: e.path.endsWith('/bin/gesture-watch') ? 2 : 1 },
  }))
  on('process.run', (_$, e) => {
    runs.push(e.argv)
    return ran(options.codeExit?.(e.argv) ?? 0)
  })
  on('process.spawn', async function* (_$, e) {
    const pieces: ProcessSpawnChunk[] = []
    let code: number | undefined
    let wake = () => {}
    lives.push({
      argv: e.argv,
      say: text => {
        pieces.push({ stream: 'stdout', text })
        wake()
      },
      exit: exitCode => {
        code = exitCode
        wake()
      },
    })
    for (;;) {
      const piece = pieces.shift()
      if (piece !== undefined) {
        yield piece
        continue
      }
      if (code !== undefined) return { value: { code, signal: null } }
      await new Promise<void>(resolve => {
        wake = resolve
      })
    }
  })

  return { clock, files, runs, lives, statuses, toasts, commands }
}

const opened = (runs: readonly (readonly string[])[]) => runs.filter(argv => argv[0]?.endsWith('code'))

test('starts the camera helper with the session and opens the folder when a finger points up', SLOW, async ($, on) => {
  const w = world(on)

  await $.session.start(START)
  await w.clock.settle()

  expect(w.commands).toEqual(['gesture'])
  expect(w.lives).toHaveLength(1)
  expect(w.lives[0]?.argv.slice(1)).toEqual(['--lock', `${DIR}/leader.lock`, '--mode', `${DIR}/mode`])
  expect(w.lives[0]?.argv[0]).toMatch(/\/bin\/gesture-watch$/)
  expect(JSON.parse(w.files.get(SESSIONS) ?? '{}')).toEqual({ s1: { root: ROOT, at: 1_000 } })

  // Pieces end wherever the helper's writes did, not at lines.
  w.lives[0]?.say('stand')
  w.lives[0]?.say('by\nleader\ncamera on\npoi')
  await w.clock.settle()
  expect(opened(w.runs)).toEqual([])

  w.lives[0]?.say('nt\n')
  await w.clock.settle()
  expect(opened(w.runs)).toEqual([['code', ROOT]])
  expect((await $.command.run(typed(''))).text).toBe(`Watching: point one finger up at the camera to open ${ROOT} in VS Code.`)
})

test('opens the folder of the session that began a turn last, not the one holding the camera', SLOW, async ($, on) => {
  const other = { s2: { root: '/Users/me/thesis', at: 5_000 } }
  const w = world(on, { files: { [SESSIONS]: JSON.stringify(other) } })

  await $.session.start(START)
  await w.clock.settle()
  w.lives[0]?.say('standby\nleader\ncamera on\npoint\n')
  await w.clock.settle()
  expect(opened(w.runs)).toEqual([['code', '/Users/me/thesis']])

  // A turn here makes this session the latest.
  await w.clock.advance(10_000)
  await $.turn.start({ text: 'next step', turnId: 't1' })
  await w.clock.settle()
  w.lives[0]?.say('point\n')
  await w.clock.settle()
  expect(opened(w.runs).at(-1)).toEqual(['code', ROOT])

  // Ended, it is forgotten, and the other session's folder is the one again.
  await $.session.end({ reason: 'prompt_input_exit', sessionId: 's1', resume: RESUME })
  expect(JSON.parse(w.files.get(SESSIONS) ?? '{}')).toEqual(other)
})

test('a session started with -p never starts the camera', SLOW, async ($, on) => {
  const w = world(on)

  await $.session.start({ cwd: ROOT, surface: null, isInteractive: false })
  await $.turn.start({ text: 'one shot', turnId: 't1' })
  await w.clock.settle()

  expect(w.lives).toEqual([])
  expect(w.commands).toEqual([])
  expect(w.files.size).toBe(0)
})

test('says when macOS is asking for the camera, until the camera is on', SLOW, async ($, on) => {
  const w = world(on)

  await $.session.start(START)
  await w.clock.settle()
  w.lives[0]?.say('standby\nleader\nasking\n')
  await w.clock.settle()
  expect(w.statuses.at(-1)).toBe(
    '👆 gesture-vscode: macOS is asking whether your terminal may use the camera; answer its dialog',
  )

  w.lives[0]?.say('camera on\n')
  await w.clock.settle()
  expect(w.statuses.at(-1)).toBeUndefined()
})

test('waits while another session has the camera', SLOW, async ($, on) => {
  const w = world(on)

  await $.session.start(START)
  await w.clock.settle()
  w.lives[0]?.say('standby\n')
  await w.clock.settle()

  expect((await $.command.run(typed('status'))).text).toBe(
    'Another Claude Code session has the camera; this one takes over when that one ends.',
  )
})

test('says how to allow the camera when access is denied, and starts again on /gesture on', SLOW, async ($, on) => {
  const w = world(on)

  await $.session.start(START)
  await w.clock.settle()
  w.lives[0]?.say('standby\nleader\ndenied\n')
  w.lives[0]?.exit(3)
  await w.clock.settle()

  expect(w.statuses.at(-1)).toMatch(/^👆 gesture-vscode: camera access denied: allow your terminal app under System Settings/)
  await w.clock.advance(120_000)
  expect(w.lives).toHaveLength(1)

  expect((await $.command.run(typed('on'))).text).toBe(
    'Gesture watch on: point one finger up at the camera to open the folder in VS Code.',
  )
  await w.clock.settle()
  expect(w.lives).toHaveLength(2)
  expect(w.statuses.at(-1)).toBeUndefined()
  expect(w.files.get(`${DIR}/mode`)).toBe('on\n')
})

test('restarts a helper that stops, waiting longer each time, then gives up', SLOW, async ($, on) => {
  const w = world(on)

  await $.session.start(START)
  await w.clock.settle()
  for (const [i, wait] of [2_000, 10_000, 60_000].entries()) {
    w.lives[i]?.exit(1)
    await w.clock.settle()
    await w.clock.advance(wait - 1)
    expect(w.lives).toHaveLength(i + 1)
    await w.clock.advance(1)
    expect(w.lives).toHaveLength(i + 2)
  }

  w.lives[3]?.exit(1)
  await w.clock.settle()
  await w.clock.advance(600_000)
  expect(w.lives).toHaveLength(4)
  expect(w.statuses.at(-1)).toBe('👆 gesture-vscode: the camera helper keeps stopping (exit 1)')
})

test('/gesture off writes the mode the helper reads, and status says so', SLOW, async ($, on) => {
  const w = world(on)

  await $.session.start(START)
  await w.clock.settle()

  expect((await $.command.run(typed('off'))).text).toBe('Gesture watch off: the camera is let go. /gesture on turns it back on.')
  expect(w.files.get(`${DIR}/mode`)).toBe('off\n')
  expect((await $.command.run(typed(''))).text).toBe('Gesture watch is off. /gesture on turns it on.')
  expect((await $.command.run(typed('wave'))).text).toBe('/gesture does not know "wave": use on, off or status.')
})

test('falls back to the code command inside VS Code, and says so when neither opens the folder', SLOW, async ($, on) => {
  let isAppThere = true
  const w = world(on, { codeExit: argv => (argv[0] === 'code' ? 127 : isAppThere ? 0 : 1) })

  await $.session.start(START)
  await w.clock.settle()
  w.lives[0]?.say('standby\nleader\ncamera on\npoint\n')
  await w.clock.settle()
  expect(opened(w.runs)).toEqual([
    ['code', ROOT],
    ['/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code', ROOT],
  ])
  expect(w.toasts).toEqual([])

  isAppThere = false
  w.lives[0]?.say('point\n')
  await w.clock.settle()
  expect(w.toasts).toEqual([`gesture-vscode: VS Code did not open ${ROOT}; is its "code" command installed?`])
})
