// The last main answer, as written; null before the first one.
export type Answer = string | null

// The line being read, split at the word being said; null when nothing is read.
export type Spoken = { before: string; word: string; after: string } | null

declare module 'claude-code' {
  interface PluginState {
    'read-aloud': { answer: Answer; isSpeaking: boolean; spoken: Spoken }
  }
}
