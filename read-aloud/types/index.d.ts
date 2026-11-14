// The last main answer, as written; null before the first one.
export type Answer = string | null

declare module 'claude-code' {
  interface PluginState {
    'read-aloud': { answer: Answer; isSpeaking: boolean }
  }
}

