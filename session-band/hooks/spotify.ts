import type { Song } from '../types'

// Asks Spotify without ever launching it. Numbers leave as whole milliseconds,
// so a locale with a decimal comma cannot change how they read. Position and
// duration are read into variables first: `round (duration of t)` hands round
// an unresolved reference, and Spotify answers -1700.
export const SCRIPT = `
if application "Spotify" is running then
  tell application "Spotify"
    set playerState to player state as text
    try
      set t to current track
      set p to player position
      set d to duration of t
      set fields to {playerState, name of t, artist of t, (round (p * 1000)) as text, (round d) as text}
    on error
      return "stopped"
    end try
  end tell
  set AppleScript's text item delimiters to tab
  return fields as text
else
  return "off"
end if
`

// What each control tells Spotify, from its dictionary.
export const CONTROLS = {
  toggle: 'playpause',
  play: 'play',
  pause: 'pause',
  next: 'next track',
  back: 'previous track',
} as const

export type Control = keyof typeof CONTROLS

const WORDS = new Map<string, Control>([
  ...Object.keys(CONTROLS).map(control => [control, control as Control] as const),
  ['', 'toggle'],
  ['playpause', 'toggle'],
  ['unpause', 'play'],
  ['resume', 'play'],
  ['skip', 'next'],
  ['prev', 'back'],
  ['previous', 'back'],
])

// The control a `/spotify` argument names, or undefined for a word it does not know.
export const controlOf = (args: string) => WORDS.get(args.trim().toLowerCase())

// Tells Spotify one thing, again only when it is already running, then gives
// it a moment so the check that follows reads where it went.
export const controlScript = (control: Control) => `
if application "Spotify" is running then
  tell application "Spotify" to ${CONTROLS[control]}
  delay 0.3
  return "done"
else
  return "off"
end if
`

// The script's answer as a song, or null when nothing is playing or paused.
export const parseSong = (stdout: string, at: number): Song | null => {
  const fields = stdout.replace(/\n+$/, '').split('\t')
  const [state] = fields

  if (fields.length < 5 || (state !== 'playing' && state !== 'paused')) return null

  const durationMs = Number(fields.pop())
  const positionMs = Number(fields.pop())
  const artist = fields.pop() ?? ''
  const title = fields.slice(1).join('\t')

  if (!Number.isFinite(durationMs) || !Number.isFinite(positionMs) || title === '') return null

  return { isPlaying: state === 'playing', title, artist, positionMs, durationMs, at }
}

// Where the song is now: a playing one has moved on since it was read.
export const elapsed = (song: Song, now: number) =>
  Math.min(song.durationMs, song.positionMs + (song.isPlaying ? now - song.at : 0))

const pad = (n: number) => String(n).padStart(2, '0')

// m:ss, or h:mm:ss for both sides when the song runs an hour or more.
export const timeOf = (positionMs: number, durationMs: number) => {
  const withHours = durationMs >= 3_600_000
  const one = (ms: number) => {
    const s = Math.floor(ms / 1000)
    const h = Math.floor(s / 3600)
    const m = Math.floor(s / 60) % 60

    return withHours ? `${h}:${pad(m)}:${pad(s % 60)}` : `${Math.floor(s / 60)}:${pad(s % 60)}`
  }

  return `${one(positionMs)} / ${one(durationMs)}`
}

// The bar's played and unplayed parts, the knob between them.
export const barOf = (positionMs: number, durationMs: number, cells: number) => {
  const knob = durationMs > 0 ? Math.round((positionMs / durationMs) * (cells - 1)) : 0

  return { played: '━'.repeat(knob), rest: '─'.repeat(cells - 1 - knob) }
}

const NONE = /[\p{M}‍︎️]/u
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|\p{Emoji_Presentation}/u

const cellsOfChar = (char: string) => (NONE.test(char) ? 0 : WIDE.test(char) ? 2 : 1)

// Terminal cells a text takes: wide for CJK and emoji, none for marks and joiners.
export const cellsOf = (text: string) => {
  let cells = 0
  for (const char of text) cells += cellsOfChar(char)

  return cells
}

// The text cut to fit `cells`, an ellipsis where it was cut.
const cut = (text: string, cells: number) => {
  if (cellsOf(text) <= cells) return text

  let kept = ''
  let used = 0
  for (const char of text) {
    used += cellsOfChar(char)
    if (used > cells - 1) break
    kept += char
  }

  return `${kept.trimEnd()}…`
}

const MIN_TITLE = 8

// "Title — Artist" in `cells`, the title cut before the artist; undefined when
// there is not room for a readable title.
const labelOf = (title: string, artist: string, cells: number) => {
  const tail = artist === '' ? '' : ` — ${artist}`

  if (cellsOf(title + tail) <= cells) return { title, tail }
  if (tail !== '' && cells - cellsOf(tail) >= MIN_TITLE) return { title: cut(title, cells - cellsOf(tail)), tail }
  if (cells >= MIN_TITLE) return { title: cut(title + tail, cells), tail: '' }

  return undefined
}

// The song's line laid out in at most `cells`: "♫ Title — Artist ━━●── 1:42 / 4:03".
export const lineOf = (song: Song, now: number, cells: number, barCells: number) => {
  const positionMs = elapsed(song, now)
  const time = timeOf(positionMs, song.durationMs)
  const fixed = 2 + 1 + barCells + 1 + cellsOf(time)
  const label = labelOf(song.title, song.artist, cells - fixed)

  if (label === undefined) return undefined

  return {
    ...label,
    ...barOf(positionMs, song.durationMs, barCells),
    time,
    cells: fixed + cellsOf(label.title + label.tail),
  }
}
