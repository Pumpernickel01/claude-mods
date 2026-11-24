import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const BAND = {
  plugin: 'activity-status',
  surface: 'terminal',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 4, bodyColumns: 80 },
} as const
const GLOW = '#f6b27a'
const LIT = '\x1b]11;#fcd9b8\x07'
const PLAIN = '\x1b]111\x07'
const TTY = '/dev/ttys016'
const DONE = { answer: 'done', durationMs: 1_000, isAborted: false, reason: 'answer' } as const

// The colour codes written to the pane's terminal, in order.
let painted: string[] = []
// the herdr config reloads asked for, one after each colour write
let reloads = 0
const HERDR = { HERDR_ENV: '1', HERDR_BIN_PATH: '/opt/homebrew/bin/herdr' }

function engine(on: On, { tools = true } = {}) {
  painted = []
  reloads = 0
  mock.env(on, HERDR)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('process.run', (_$, e) => {
    const answer = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (e.argv[2]?.startsWith('ps ')) return answer('ttys016\n')
    if (e.argv[2]?.startsWith('printf') && e.argv[5] === TTY) painted.push(e.argv[4] ?? '')
    if (e.argv.join(' ') === '/opt/homebrew/bin/herdr server reload-config') reloads += 1

    return answer('')
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('prompt.edit', (_$, e) => ({ text: e.text, cursor: e.cursor }))
  if (tools) on('tool.call', () => ({ result: { answers: {} } }))
  on('classic.Notification', () => ({}))
}

// The band as drawn now: its words and its background, or undefined when it shows nothing.
async function band($: Parameters<Parameters<typeof test>[1]>[0]) {
  const ui = await $.ui.mount(BAND)
  const box = await ui.find({ type: 'Box' })
  await ui.unmount()

  return box === undefined ? undefined : { text: box.text, glow: (box.props as { backgroundColor?: string }).backgroundColor }
}

const START = { cwd: '/Users/me/lab2', surface: 'terminal', isInteractive: true } as const

test('blinks soft orange once Claude has finished, the whole pane too, and stops when the person types', async ($, on) => {
  const clock = mock.clock(on)
  engine(on)
  await $.session.start(START)
  // an earlier load may have left the pane lit
  expect(painted).toEqual([PLAIN])

  await $.turn.start({ text: 'fix it', turnId: 't1' })
  expect(await band($)).toBeUndefined()
  await $.turn.complete({ turnId: 't1', ...DONE })

  expect(await band($)).toEqual({ text: '● Claude has finished', glow: GLOW })
  await clock.advance(700)
  expect(await band($)).toEqual({ text: '● Claude has finished', glow: undefined })
  await clock.advance(700)
  expect((await band($))?.glow).toBe(GLOW)

  await $.prompt.edit({ text: 'n', cursor: 1, origin: { kind: 'composer' } } as never)
  expect(await band($)).toBeUndefined()
  // lit, plain, lit with the band, then plain again once the person typed
  expect(painted).toEqual([PLAIN, LIT, PLAIN, LIT, PLAIN])
  // each followed by a full repaint, so rows with text change colour too
  expect(reloads).toBe(5)

  // nothing more is written once it stopped
  await clock.advance(2_000)
  expect(painted).toHaveLength(5)
})

test('a slow write never leaves the pane lit after the band stopped', async ($, on) => {
  const clock = mock.clock(on)
  const written: string[] = []
  mock.env(on, HERDR)
  on('ui.status', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))
  on('prompt.edit', (_$, e) => ({ text: e.text, cursor: e.cursor }))
  on('process.run', async (_$, e) => {
    const answer = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (e.argv[2]?.startsWith('ps ')) return answer('ttys016\n')
    // the lit colour takes long to write
    if (e.argv[4] === LIT) await clock.sleep(500)
    if (e.argv[2]?.startsWith('printf')) written.push(e.argv[4] ?? '')

    return answer('')
  })
  await $.session.start(START)

  await $.turn.complete({ turnId: 't1', ...DONE })
  await $.prompt.edit({ text: 'n', cursor: 1, origin: { kind: 'composer' } } as never)
  await clock.advance(600)

  expect(written).toEqual([PLAIN, LIT, PLAIN])
})

test('after 5 minutes the blink holds still, lit, and writes no more', async ($, on) => {
  const clock = mock.clock(on)
  engine(on)
  await $.session.start(START)
  await $.turn.complete({ turnId: 't1', ...DONE })

  await clock.advance(5 * 60_000)
  const count = painted.length
  expect(await band($)).toEqual({ text: '● Claude has finished', glow: GLOW })
  expect(painted.at(-1)).toBe(LIT)

  await clock.advance(10_000)
  expect(painted).toHaveLength(count)
})

test('leaving Claude puts the pane\'s background back', async ($, on) => {
  mock.clock(on)
  engine(on)
  await $.session.start(START)
  await $.turn.complete({ turnId: 't1', ...DONE })

  await $.session.end({ reason: 'prompt_input_exit', sessionId: 's1', resume: { id: 's1', isResumable: true } } as never)
  expect(painted.at(-1)).toBe(PLAIN)
})

test('a subagent finishing, or a turn the person stopped, blinks nothing', async ($, on) => {
  mock.clock(on)
  engine(on)

  await $.turn.complete({ turnId: 'a1', agentId: 'sub1', ...DONE } as never)
  await $.turn.complete({ turnId: 't1', ...DONE, isAborted: true, reason: 'aborted' } as never)
  expect(await band($)).toBeUndefined()
})

test('a turn the person stops with Esc stops the band', async ($, on) => {
  mock.clock(on)
  engine(on)

  await $.classic.Notification({ message: 'Claude needs your permission', notification_type: 'permission_prompt' })
  await $.turn.complete({ turnId: 't1', ...DONE, isAborted: true, reason: 'aborted' } as never)
  expect(await band($)).toBeUndefined()
})

test('waiting idle for a while blinks "finished"', async ($, on) => {
  mock.clock(on)
  engine(on)

  await $.classic.Notification({ message: 'Claude is waiting for your input', notification_type: 'idle_prompt' })
  expect((await band($))?.text).toBe('● Claude has finished')
})

test('a permission prompt blinks "asking"; a new turn stops it', async ($, on) => {
  mock.clock(on)
  engine(on)

  await $.classic.Notification({ message: 'Claude needs your permission', notification_type: 'permission_prompt' })
  expect(await band($)).toEqual({ text: '● Claude is asking you something', glow: GLOW })

  await $.turn.start({ text: 'yes', turnId: 't2' })
  expect(await band($)).toBeUndefined()
})

test('a question blinks while it waits, and stops once answered', async ($, on) => {
  mock.clock(on)
  const engineSeen: string[] = []
  engine(on, { tools: false })
  on('tool.call', async () => {
    engineSeen.push((await band($))?.text ?? 'none')

    return { result: { answers: {} } }
  })

  await $.tool.call({ tool: 'AskUserQuestion', tool_use_id: 'q1', questions: [] } as never)
  expect(engineSeen).toEqual(['● Claude is asking you something'])
  expect(await band($)).toBeUndefined()
})
