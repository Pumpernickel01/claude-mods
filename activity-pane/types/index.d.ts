export type CallState = 'running' | 'done' | 'failed' | 'denied'

export type ActivityCall = {
  id: string
  tool: string
  detail: string
  isSubagent: boolean
  state: CallState
  ms?: number
}

// How much went one way: tokens for a model request, characters for the rest.
export type Amount = { n: number; unit: 'tok' | 'B' }

// One transfer in the data flow log: who sent what where.
export type Flow = {
  id: string
  at: number
  from: string
  to: string
  // A destination on the local network, or on this machine.
  tag?: 'LAN' | 'local'
  what: string
  up?: Amount
  down?: Amount
  detail: string
  isFailed?: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'activity-pane': { calls: ActivityCall[]; flows: Flow[] }
  }
}
