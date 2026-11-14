// Which sessions were last at work, in one small JSON file every session
// shares: session id → its project folder and when it last began a turn.
export type Seen = { root: string; at: number }
export type Sessions = Record<string, Seen>

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

const isSeen = (value: unknown): value is Seen =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Seen).root === 'string' &&
  typeof (value as Seen).at === 'number'

// The file's sessions; a missing or damaged file is no sessions.
export const parseSessions = (text: string | undefined): Sessions => {
  if (text === undefined) return {}

  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return {}
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}

  return Object.fromEntries(Object.entries(value).filter(([, seen]) => isSeen(seen))) as Sessions
}

// The sessions with this one at work now, and any idle for a week let go.
export const withSeen = (sessions: Sessions, id: string, seen: Seen): Sessions => ({
  ...Object.fromEntries(Object.entries(sessions).filter(([other, s]) => other !== id && seen.at - s.at < WEEK_MS)),
  [id]: seen,
})

export const without = (sessions: Sessions, id: string): Sessions =>
  Object.fromEntries(Object.entries(sessions).filter(([other]) => other !== id))

// The folder of the session that began a turn last.
export const latestRoot = (sessions: Sessions): string | undefined => {
  let latest: Seen | undefined
  for (const seen of Object.values(sessions)) {
    if (latest === undefined || seen.at > latest.at) latest = seen
  }

  return latest?.root
}

// Whole lines out of a stream's pieces, which end wherever the writer's write did.
export const lineReader = () => {
  let rest = ''

  return (text: string): string[] => {
    const lines = (rest + text).split('\n')
    rest = lines.pop() ?? ''

    return lines.map(line => line.trim()).filter(line => line !== '')
  }
}

export type Mode = 'on' | 'off'

// The mode file's word; anything but "off" is on.
export const modeOf = (text: string | undefined): Mode => (text?.trim() === 'off' ? 'off' : 'on')
