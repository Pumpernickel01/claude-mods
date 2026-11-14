import { expect, mock, test } from 'claude-code/testing'
import type { MockClock } from 'claude-code/testing'
import type { On } from 'claude-code'

const BAND = {
  plugin: 'session-band',
  surface: 'terminal',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 9 },
    view: {},
  },
} as const

const START = { cwd: '/Users/me/KTU/lab2', surface: 'terminal', isInteractive: true } as const

type Track = { title: string; artist: string; positionMs: number; durationMs: number }
type Player =
  | { state: 'playing' | 'paused'; track: Track }
  | { state: 'off' | 'stopped' }
  | { state: 'broken'; stderr: string }

// Spotify as the band's script sees it: a playing song moves on with the clock.
function spotify(on: On, clock: MockClock, player: () => Player) {
  const seen = { runs: 0 }
  let since = clock.now()
  let last: Player | undefined

  on('process.run', (_$, e) => {
    if (e.argv[0] !== 'osascript') {
      return { deny: 'only osascript runs in this test' }
    }
    seen.runs += 1

    const now = player()
    const keyOf = (one: Player) => ('track' in one ? `${one.state}:${one.track.title}` : one.state)
    if (last === undefined || keyOf(now) !== keyOf(last)) {
      since = clock.now()
      last = now
    }
    const ran = (stdout: string, exitCode = 0, stderr = '') => ({
      value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false },
    })

    if (now.state === 'broken') return ran('', 1, now.stderr)
    if (!('track' in now)) return ran(`${now.state}\n`)

    const moved = now.state === 'playing' ? clock.now() - since : 0
    const { title, artist, positionMs, durationMs } = now.track

    return ran(`${now.state}\t${title}\t${artist}\t${positionMs + moved}\t${durationMs}\n`)
  })

  return seen
}

function usage(on: On) {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.root', () => ({ value: '/Users/me/KTU/lab2' }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { window: 200_000, tokens: 62_000, percent: 31 },
      rateLimits: [],
      cost: { usd: 1.84 },
    },
  }))
}

const MIDNIGHT_CITY: Track = { title: 'Midnight City', artist: 'M83', positionMs: 102_000, durationMs: 243_000 }

// The bar's knob sits as far along as the song is.
const knobAt = (text: string) => {
  const bar = /([━]*)●([─]*)/.exec(text)
  if (bar === null) throw new Error(`no bar in "${text}"`)
  const [, played = '', left = ''] = bar

  return played.length / (played.length + left.length)
}

test('shows the playing song on the right edge, with a bar and the time', async ($, on) => {
  const clock = mock.clock(on, { now: 42 * 60_000 })
  usage(on)
  spotify(on, clock, () => ({ state: 'playing', track: MIDNIGHT_CITY }))

  await $.session.start(START)
  await clock.settle()
  const ui = await $.ui.mount(BAND)
  const music = await ui.find({ key: 'music' })
  const gap = await ui.find({ key: 'gap' })
  const controls = await ui.find({ key: 'controls' })

  expect(music?.text).toMatch(/^♫ Midnight City — M83 [━●─]+ 1:42 \/ 4:03$/)
  expect(Math.abs(knobAt(music?.text ?? '') - 102 / 243)).toBeLessThan(0.1)
  expect(await ui.find({ type: 'Text', text: /lab2|context|\$/ })).toBeUndefined()
  expect(controls?.text).toBe(' ⏮ ⏯ ⏭')
  expect([...(gap?.text ?? ''), ...(music?.text ?? ''), ...(controls?.text ?? '')]).toHaveLength(100)
})

test('counts the time on between its checks of Spotify', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  usage(on)
  spotify(on, clock, () => ({ state: 'playing', track: MIDNIGHT_CITY }))

  await $.session.start(START)
  const ui = await $.ui.mount(BAND)
  await clock.advance(3_000)

  expect((await ui.find({ key: 'music' }))?.text).toMatch(/ 1:45 \/ 4:03$/)

  await clock.advance(9_000)

  expect((await ui.find({ key: 'music' }))?.text).toMatch(/ 1:54 \/ 4:03$/)
})

test('holds a paused song still, marked with ⏸', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  usage(on)
  spotify(on, clock, () => ({ state: 'paused', track: MIDNIGHT_CITY }))

  await $.session.start(START)
  const ui = await $.ui.mount(BAND)
  await clock.advance(12_000)
  // Drawn again between two checks, as at the end of a turn.
  await ui.redraw()

  expect((await ui.find({ key: 'music' }))?.text).toMatch(/^⏸ Midnight City — M83 [━●─]+ 1:42 \/ 4:03$/)
})

test('picks up a song started after the band was drawn, and drops it when Spotify quits', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  usage(on)
  let player: Player = { state: 'off' }
  spotify(on, clock, () => player)

  await $.session.start(START)
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ key: 'music' })).toBeUndefined()

  player = { state: 'playing', track: MIDNIGHT_CITY }
  await clock.advance(6_000)
  expect((await ui.find({ key: 'music' }))?.text).toMatch(/^♫ Midnight City — M83 /)

  player = { state: 'off' }
  await clock.advance(6_000)
  expect(await ui.find({ key: 'music' })).toBeUndefined()
})

for (const [name, player] of [
  ['Spotify is closed', { state: 'off' }],
  ['nothing is loaded in Spotify', { state: 'stopped' }],
  ['macOS refuses the script', { state: 'broken', stderr: 'Not authorized to send Apple events to Spotify. (-1743)' }],
] as const) {
  test(`draws no row when ${name}`, async ($, on) => {
    const clock = mock.clock(on, { now: 42 * 60_000 })
    usage(on)
    spotify(on, clock, () => player)

    await $.session.start(START)
    await clock.settle()
    const ui = await $.ui.mount(BAND)

    expect(await ui.find({ key: 'music' })).toBeUndefined()
    expect(await ui.find({ type: 'Text' })).toBeUndefined()
  })
}

test('cuts a long title first, keeping the bar and the time, on a narrow window', async ($, on) => {
  const clock = mock.clock(on, { now: 42 * 60_000 })
  usage(on)
  spotify(on, clock, () => ({
    state: 'playing',
    track: { ...MIDNIGHT_CITY, title: 'Midnight City (Eric Prydz Private Remix) [Extended Version]' },
  }))

  await $.session.start(START)
  await clock.settle()
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 60 } })
  const music = (await ui.find({ key: 'music' }))?.text ?? ''
  const gap = (await ui.find({ key: 'gap' }))?.text ?? ''
  const controls = (await ui.find({ key: 'controls' }))?.text ?? ''

  expect(music).toMatch(/^♫ Midnight City.*… — M83 [━●─]+ 1:42 \/ 4:03$/)
  expect([...gap, ...music, ...controls]).toHaveLength(60)
})

test('draws no row when the window is too narrow for the song', async ($, on) => {
  const clock = mock.clock(on, { now: 42 * 60_000 })
  usage(on)
  spotify(on, clock, () => ({ state: 'playing', track: MIDNIGHT_CITY }))

  await $.session.start(START)
  await clock.settle()
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 28 } })

  expect(await ui.find({ key: 'music' })).toBeUndefined()
})

test('writes hours for an episode over an hour long', async ($, on) => {
  const clock = mock.clock(on, { now: 42 * 60_000 })
  usage(on)
  spotify(on, clock, () => ({
    state: 'playing',
    track: { title: 'Episode 212', artist: 'Darknet Diaries', positionMs: 65_000, durationMs: 3_725_000 },
  }))

  await $.session.start(START)
  await clock.settle()
  const ui = await $.ui.mount(BAND)

  expect((await ui.find({ key: 'music' }))?.text).toMatch(/ 0:01:05 \/ 1:02:05$/)
})
