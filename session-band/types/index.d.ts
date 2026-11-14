export type Song = {
  isPlaying: boolean
  title: string
  artist: string
  positionMs: number
  durationMs: number
  // When positionMs was true, on the session clock.
  at: number
}

declare module 'claude-code' {
  interface PluginState {
    'session-band': { song: Song | null }
  }
}
