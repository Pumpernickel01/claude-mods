import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Song } from '../types'
import { SCRIPT, controlOf, controlScript, elapsed, lineOf, parseSong } from './spotify'
import type { Control } from './spotify'

const SPOTIFY_MS = 5_000
const TICK_MS = 1_000
const BAR_CELLS = 12
const SPOTIFY_GREEN = '#1db954'
// " ⏮ ⏯ ⏭" after the song's line.
const CONTROL_CELLS = 6

const song = atom({ plugin: 'session-band', key: 'song' } as const, null)

// What Spotify last answered, and the question under way, if any. `hasSong`
// starts true so the first answer replaces whatever a reload left behind.
type Heard = { checking?: Promise<void>; hasSong: boolean; isPlaying: boolean }

function check($: EngineInterface, heard: Heard) {
  heard.checking ??= ask($, heard).finally(() => {
    heard.checking = undefined
  })

  return heard.checking
}

async function ask($: EngineInterface, heard: Heard) {
  const at = await $.clock.now()
  let playing: Song | null = null
  try {
    const ran = await $.process.run(['osascript', '-e', SCRIPT], { timeoutMs: 3_000 })
    playing = ran.exitCode === 0 ? parseSong(ran.stdout, at) : null
  } catch {
    // Spotify could not be asked (no permission yet, a timeout): show nothing.
  }

  heard.isPlaying = playing?.isPlaying ?? false
  if (playing !== null || heard.hasSong) {
    heard.hasSong = playing !== null
    await update($, song, () => playing)
  }
}

// Tells Spotify one thing, then asks it again so the band shows where it went.
async function control($: EngineInterface, heard: Heard, which: Control) {
  let outcome: 'done' | 'off' | 'failed' = 'failed'
  try {
    const ran = await $.process.run(['osascript', '-e', controlScript(which)], { timeoutMs: 3_000 })
    const said = ran.stdout.trim()
    if (ran.exitCode === 0 && (said === 'done' || said === 'off')) outcome = said
  } catch {
    // Not allowed to tell Spotify, or it did not answer in time.
  }

  // A check under way may have read Spotify before the control: let it land, then ask afresh.
  await heard.checking
  await check($, heard)

  return outcome
}

const titleOf = (playing: Song) => (playing.artist === '' ? playing.title : `${playing.title} — ${playing.artist}`)

export const register: Register = on => {
  const heard: Heard = { hasSong: true, isPlaying: false }

  on('session.start', async ($, e, next) => {
    void check($, heard)
    $.clock.every(SPOTIFY_MS, () => check($, heard))
    // Between checks a playing song's time counts on here, a redraw a second.
    $.clock.every(TICK_MS, async () => {
      if (!heard.isPlaying) return

      const now = await $.clock.now()
      await update($, song, playing => (playing?.isPlaying ? { ...playing, positionMs: elapsed(playing, now), at: now } : playing))
    })

    // Immediate, so music can be paused or skipped while a turn runs.
    await $.command.register({
      name: 'spotify',
      description: 'Controls Spotify: pause, play, next or back; with nothing after it, plays or pauses',
      argumentHint: '[pause|play|next|back]',
      immediate: true,
    })

    return next(e)
  })

  on('command.run', { command: 'spotify' }, async ($, e) => {
    const which = controlOf(e.args)
    if (which === undefined) {
      return { text: `/spotify does not know "${e.args.trim()}": use pause, play, next or back, or nothing to play or pause.` }
    }

    const outcome = await control($, heard, which)
    if (outcome === 'off') return { text: 'Spotify is not running.' }
    if (outcome === 'failed') return { text: 'Spotify could not be reached.' }

    const playing = await read($, song)
    if (playing === null) return { text: 'Nothing is loaded in Spotify.' }

    return { text: `${playing.isPlaying ? '♫ Playing' : '⏸ Paused'} ${titleOf(playing)}` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    const playing = await read($, song)
    // Nothing loaded in Spotify: no row at all.
    if (playing === null) {
      return next(e)
    }

    const { Box, Button, Text } = $.ui.resolve(e)
    const now = await $.clock.now()
    const line = lineOf(playing, now, e.props.bodyColumns - CONTROL_CELLS, BAR_CELLS)
    // Too narrow for even a short title: no row.
    if (line === undefined) {
      return next(e)
    }
    const tint = playing.isPlaying ? SPOTIFY_GREEN : undefined

    return (
      <Box>
        <Box key="gap">
          <Text>{' '.repeat(e.props.bodyColumns - line.cells - CONTROL_CELLS)}</Text>
        </Box>
        <Box key="music">
          <Text wrap="truncate-end" dimColor={!playing.isPlaying}>
            <Text color={tint}>{playing.isPlaying ? '♫' : '⏸'}</Text>{' '}
            <Text weight="bold">{line.title}</Text>
            <Text dimColor>{line.tail}</Text>{' '}
            <Text color={tint}>{line.played}●</Text>
            <Text dimColor>{line.rest}</Text>{' '}
            <Text dimColor>{line.time}</Text>
          </Text>
        </Box>
        <Box key="controls">
          <Text> </Text>
          <Button key="back" label="⏮" plain dimColor={!playing.isPlaying} onPress={() => control($, heard, 'back')} />
          <Text> </Text>
          <Button key="toggle" label="⏯" plain dimColor={!playing.isPlaying} onPress={() => control($, heard, 'toggle')} />
          <Text> </Text>
          <Button key="next" label="⏭" plain dimColor={!playing.isPlaying} onPress={() => control($, heard, 'next')} />
        </Box>
      </Box>
    )
  })
}
