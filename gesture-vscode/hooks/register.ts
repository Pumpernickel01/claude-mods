import type { EngineInterface, Register } from 'claude-code'

import { latestRoot, lineReader, modeOf, parseSessions, withSeen, without } from './sessions'

// The helper's exit codes that a restart cannot mend.
const DENIED = 3
const NO_CAMERA = 4
// Waits before each restart of a helper that stopped; past the last, it stays stopped.
const RESTART_MS = [2_000, 10_000, 60_000]
// A helper that ran this long before it stopped was working: its failures count afresh.
const HEALTHY_MS = 60_000
const CODE = ['code', '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code']
const ALLOW_CAMERA = 'allow your terminal app under System Settings → Privacy & Security → Camera, then /gesture on'

// This session's helper, as it last said: waiting for another session's to
// end, or watching (the camera then on, or off and why).
type Helper = {
  role: 'stopped' | 'starting' | 'waiting' | 'watching'
  camera: string
  failures: number
  problem?: string
  isOpening: boolean
}

const dirOf = async ($: EngineInterface) =>
  `${(await $.env.get('HOME')) ?? ''}/Library/Application Support/claude-gesture-vscode`

const readText = (path: string, $: EngineInterface) => $.fs.read(path).catch(() => undefined)

// Work left running past its hook; a module unloaded meanwhile rejects it, and that is fine.
const detach = (work: Promise<unknown>) => {
  work.catch(() => undefined)
}

// Notes that this session is at work in its folder now.
async function markSeen($: EngineInterface) {
  const [dir, id, root, at] = await Promise.all([dirOf($), $.session.id(), $.session.root(), $.clock.now()])
  const file = `${dir}/sessions.json`
  const sessions = parseSessions(await readText(file, $))

  await $.fs.write(file, `${JSON.stringify(withSeen(sessions, id, { root, at }))}\n`)
}

async function forget($: EngineInterface, id: string) {
  const file = `${await dirOf($)}/sessions.json`
  const sessions = parseSessions(await readText(file, $))

  if (id in sessions) await $.fs.write(file, `${JSON.stringify(without(sessions, id))}\n`)
}

// Opens the folder of the session that began a turn last; VS Code brings
// forward the window that already has it, or opens one.
async function openFolder($: EngineInterface, helper: Helper) {
  if (helper.isOpening) return

  helper.isOpening = true
  try {
    const sessions = parseSessions(await readText(`${await dirOf($)}/sessions.json`, $))
    const root = latestRoot(sessions) ?? (await $.session.root())
    for (const code of CODE) {
      const ran = await $.process.run([code, root], { timeoutMs: 15_000 }).catch(() => undefined)
      if (ran?.exitCode === 0) return
    }
    $.ui.toast(`gesture-vscode: VS Code did not open ${root}; is its "code" command installed?`)
  } finally {
    helper.isOpening = false
  }
}

// The built helper, built now when missing or older than its source.
async function helperPath($: EngineInterface) {
  const root = $.plugin.root
  const bin = `${root}/bin/gesture-watch`
  const source = `${root}/native/main.swift`
  const [built, written] = await Promise.all([
    $.fs.stat(bin).catch(() => undefined),
    $.fs.stat(source).catch(() => undefined),
  ])
  if (built !== undefined && (written === undefined || built.mtimeMs >= written.mtimeMs)) return bin
  if (written === undefined) return undefined

  $.ui.toast('gesture-vscode: building the camera helper, once…')
  const scratch = `${bin}.${await $.clock.now()}.tmp`
  const plist = `${root}/native/Info.plist`
  await $.process.run(['mkdir', '-p', `${root}/bin`]).catch(() => undefined)
  const compiled = await $.process
    .run(
      ['swiftc', '-O', '-swift-version', '5', source, '-o', scratch,
        '-Xlinker', '-sectcreate', '-Xlinker', '__TEXT', '-Xlinker', '__info_plist', '-Xlinker', plist],
      { timeoutMs: 300_000 },
    )
    .catch(() => undefined)
  if (compiled?.exitCode !== 0) {
    $.ui.log(`gesture-vscode: swiftc failed: ${compiled?.stderr ?? 'it did not start'}`, { to: 'debug' })
    return undefined
  }
  const moved = await $.process.run(['mv', '-f', scratch, bin]).catch(() => undefined)

  return moved?.exitCode === 0 ? bin : undefined
}

function stop($: EngineInterface, helper: Helper, problem: string) {
  helper.role = 'stopped'
  helper.problem = problem
  $.ui.status(`👆 gesture-vscode: ${problem}`)
}

function heard($: EngineInterface, helper: Helper, line: string) {
  if (line === 'standby') helper.role = 'waiting'
  else if (line === 'leader') helper.role = 'watching'
  else if (line === 'asking') $.ui.status('👆 gesture-vscode: macOS is asking whether your terminal may use the camera; answer its dialog')
  else if (line.startsWith('camera ')) {
    // The camera is answered for: any word about asking for it is done.
    $.ui.status(undefined)
    helper.camera = line.slice('camera '.length)
  } else if (line === 'point') detach(openFolder($, helper))
}

// Runs the helper for as long as the session lasts, restarting it when it stops.
async function run($: EngineInterface, helper: Helper, bin: string, dir: string) {
  const startedAt = await $.clock.now()
  const read = lineReader()
  let code: number | null = null
  try {
    const child = $.process.spawn({ argv: [bin, '--lock', `${dir}/leader.lock`, '--mode', `${dir}/mode`] })
    for await (const { stream, text } of child) {
      if (stream === 'stderr') $.ui.log(`gesture-vscode: ${text.trimEnd()}`, { to: 'debug' })
      else for (const line of read(text)) heard($, helper, line)
    }
    code = (await child.result).code
  } catch (error) {
    $.ui.log(`gesture-vscode: the camera helper failed: ${String(error)}`, { to: 'debug' })
  }

  if (code === DENIED) return stop($, helper, `camera access denied: ${ALLOW_CAMERA}`)
  if (code === NO_CAMERA) return stop($, helper, 'no camera found')

  const ranMs = (await $.clock.now()) - startedAt
  helper.failures = ranMs >= HEALTHY_MS ? 1 : helper.failures + 1
  const wait = RESTART_MS[helper.failures - 1]
  if (wait === undefined) return stop($, helper, `the camera helper keeps stopping (exit ${code ?? 'signal'})`)

  helper.role = 'starting'
  $.clock.after(wait, () => detach(run($, helper, bin, dir)))
}

async function launch($: EngineInterface, helper: Helper) {
  if (helper.role !== 'stopped') return

  helper.role = 'starting'
  helper.problem = undefined
  $.ui.status(undefined)
  const [bin, dir] = await Promise.all([helperPath($), dirOf($)])
  if (bin === undefined) return stop($, helper, 'the camera helper could not be built (is swiftc installed?)')

  detach(run($, helper, bin, dir))
}

async function statusOf($: EngineInterface, helper: Helper) {
  const dir = await dirOf($)
  if (modeOf(await readText(`${dir}/mode`, $)) === 'off') return 'Gesture watch is off. /gesture on turns it on.'
  if (helper.role === 'stopped') return `Gesture watch is not running: ${helper.problem ?? 'it has not started'}.`
  if (helper.role === 'starting') return 'Gesture watch is starting.'
  if (helper.role === 'waiting') return 'Another Claude Code session has the camera; this one takes over when that one ends.'
  if (helper.camera !== 'on') return `This session has the camera, paused while the screen is ${helper.camera.replace(/^off /, '')}.`

  const root = latestRoot(parseSessions(await readText(`${dir}/sessions.json`, $))) ?? (await $.session.root())
  return `Watching: point one finger up at the camera to open ${root} in VS Code.`
}

export const register: Register = on => {
  const helper: Helper = { role: 'stopped', camera: '', failures: 0, isOpening: false }
  // Only a session someone works in at the prompt watches; a -p run does not.
  let isInteractive = false

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    isInteractive = e.isInteractive
    if (!isInteractive) return started

    await $.command.register({
      name: 'gesture',
      description: 'Point one finger up at the camera to open this session’s folder in VS Code: on, off or status',
      argumentHint: '[on|off|status]',
      immediate: true,
    })
    // Seen first, so the shared folder is there before the helper locks in it.
    detach(
      markSeen($)
        .catch(() => undefined)
        .then(() => launch($, helper)),
    )

    return started
  })

  on('turn.start', ($, e, next) => {
    if (isInteractive && e.agentId === undefined) detach(markSeen($))

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (isInteractive) await forget($, e.sessionId).catch(() => undefined)

    return next(e)
  })

  on('command.run', { command: 'gesture' }, async ($, e) => {
    const word = e.args.trim().toLowerCase()
    if (word === '' || word === 'status') return { text: await statusOf($, helper) }
    if (word !== 'on' && word !== 'off') return { text: `/gesture does not know "${e.args.trim()}": use on, off or status.` }

    await $.fs.write(`${await dirOf($)}/mode`, `${word}\n`)
    if (word === 'off') {
      $.ui.status(undefined)
      return { text: 'Gesture watch off: the camera is let go. /gesture on turns it back on.' }
    }

    helper.failures = 0
    detach(launch($, helper))
    return { text: 'Gesture watch on: point one finger up at the camera to open the folder in VS Code.' }
  })
}
