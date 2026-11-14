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

// `/spotify <args>` as the person types it at the prompt.
const typed = (args: string) => ({
  command: 'spotify',
  args,
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 100 },
}) as const

type Track = { title: string; artist: string; durationMs: number }

const QUEUE: Track[] = [
  { title: 'Midnight City', artist: 'M83', durationMs: 243_000 },
  { title: 'Wait', artist: 'M83', durationMs: 341_000 },
  { title: 'Outro', artist: 'M83', durationMs: 247_000 },
]

// Spotify with a queue, as the band's scripts see it: it answers the check,
// takes the controls, and a playing song moves on with the clock.
function jukebox(on: On, clock: MockClock, options: { isRunning?: boolean; state?: 'playing' | 'paused' } = {}) {
  const player = {
    isRunning: options.isRunning ?? true,
    state: options.state ?? 'playing',
    index: 0,
    positionMs: 102_000,
    at: clock.now(),
    told: [] as string[],
  }
  const track = () => QUEUE[player.index] as Track
  const position = () =>
    Math.min(track().durationMs, player.positionMs + (player.state === 'playing' ? clock.now() - player.at : 0))
  const hold = () => {
    player.positionMs = position()
    player.at = clock.now()
  }
  const start = (index: number) => {
    player.index = (index + QUEUE.length) % QUEUE.length
    player.positionMs = 0
    player.at = clock.now()
  }

  on('process.run', (_$, e) => {
    if (e.argv[0] !== 'osascript') {
      return { deny: 'only osascript runs in this test' }
    }
    const ran = (stdout: string) => ({
      value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    })

    if (!player.isRunning) return ran('off\n')

    const told = /tell application "Spotify" to (.+)$/m.exec(e.argv[2] ?? '')?.[1]
    if (told !== undefined) {
      player.told.push(told)
      hold()
      if (told === 'playpause') player.state = player.state === 'playing' ? 'paused' : 'playing'
      if (told === 'play') player.state = 'playing'
      if (told === 'pause') player.state = 'paused'
      if (told === 'next track') start(player.index + 1)
      if (told === 'previous track') start(player.index - 1)

      return ran('done\n')
    }

    const { title, artist, durationMs } = track()

    return ran(`${player.state}\t${title}\t${artist}\t${position()}\t${durationMs}\n`)
  })

  return player
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

test('pauses and plays again from the band’s ⏯, the time holding still while paused', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  usage(on)
  const player = jukebox(on, clock)

  await $.session.start(START)
  await clock.settle()
  const ui = await $.ui.mount(BAND)

  await ui.press({ key: 'toggle' })
  expect(player.told).toEqual(['playpause'])
  expect((await ui.find({ key: 'music' }))?.text).toMatch(/^⏸ Midnight City — M83 [━●─]+ 1:42 \/ 4:03$/)

  await clock.advance(10_000)
  expect((await ui.find({ key: 'music' }))?.text).toMatch(/ 1:42 \/ 4:03$/)

  await ui.press({ key: 'toggle' })
  expect((await ui.find({ key: 'music' }))?.text).toMatch(/^♫ Midnight City — M83 /)

  await clock.advance(3_000)
  expect((await ui.find({ key: 'music' }))?.text).toMatch(/ 1:45 \/ 4:03$/)
})

test('skips to the next song from ⏭ and goes back from ⏮', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  usage(on)
  const player = jukebox(on, clock)

  await $.session.start(START)
  await clock.settle()
  const ui = await $.ui.mount(BAND)

  await ui.press({ key: 'next' })
  expect((await ui.find({ key: 'music' }))?.text).toMatch(/^♫ Wait — M83 [━●─]+ 0:00 \/ 5:41$/)

  await ui.press({ key: 'back' })
  expect((await ui.find({ key: 'music' }))?.text).toMatch(/^♫ Midnight City — M83 [━●─]+ 0:00 \/ 4:03$/)
  expect(player.told).toEqual(['next track', 'previous track'])
})

test('/spotify pauses, plays, skips and goes back, saying what plays now', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  usage(on)
  const player = jukebox(on, clock)

  await $.session.start(START)
  await clock.settle()

  const say = async (args: string) => (await $.command.run(typed(args))).text

  expect(await say('pause')).toBe('⏸ Paused Midnight City — M83')
  expect(await say('play')).toBe('♫ Playing Midnight City — M83')
  expect(await say('next')).toBe('♫ Playing Wait — M83')
  expect(await say('back')).toBe('♫ Playing Midnight City — M83')
  expect(await say('')).toBe('⏸ Paused Midnight City — M83')
  expect(await say('unpause')).toBe('♫ Playing Midnight City — M83')
  expect(await say('skip')).toBe('♫ Playing Wait — M83')
  expect(await say(' Prev ')).toBe('♫ Playing Midnight City — M83')
  expect(player.told).toEqual(['pause', 'play', 'next track', 'previous track', 'playpause', 'play', 'next track', 'previous track'])
})

test('/spotify shows the change on the band too', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  usage(on)
  jukebox(on, clock)

  await $.session.start(START)
  await clock.settle()
  const ui = await $.ui.mount(BAND)

  await $.command.run(typed('next'))
  expect((await ui.find({ key: 'music' }))?.text).toMatch(/^♫ Wait — M83 /)
})

test('/spotify says so when Spotify is not running, and launches nothing', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  usage(on)
  const player = jukebox(on, clock, { isRunning: false })

  await $.session.start(START)
  await clock.settle()

  expect((await $.command.run(typed('play'))).text).toBe('Spotify is not running.')
  expect(player.told).toEqual([])
})

test('/spotify names a word it does not know and tells Spotify nothing', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  usage(on)
  const player = jukebox(on, clock)

  await $.session.start(START)
  await clock.settle()

  expect((await $.command.run(typed('louder'))).text).toMatch(/does not know "louder"/)
  expect(player.told).toEqual([])
})
