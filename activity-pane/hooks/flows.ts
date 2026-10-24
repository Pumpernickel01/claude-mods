import type { Amount, Flow } from '../types'

// A flow before it has a time and an id.
export type Draft = Omit<Flow, 'id' | 'at'>

// Where a shell command points: a host, or a git remote still to be looked up.
export type Target = { host: string; what: string } | { remote: string; what: string }

const LOCAL = [/^localhost$/i, /^127\./, /^0\.0\.0\.0$/, /^::1$/]
const LAN = [/^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./, /\.local$/i]

export const tagOf = (host: string): Flow['tag'] =>
  LOCAL.some(r => r.test(host)) ? 'local' : LAN.some(r => r.test(host)) ? 'LAN' : undefined

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()

const sizeOf = (value: unknown) => {
  try {
    return typeof value === 'string' ? value.length : (JSON.stringify(value)?.length ?? 0)
  } catch {
    return 0
  }
}

const chars = (n: number): Amount => ({ n, unit: 'B' })

// The fields of a tool call that are the engine's, not the tool's input.
const META = new Set(['tool', 'tool_use_id', 'consent', 'agentId', 'agent', 'requestMeta'])

export const inputOf = (e: object) =>
  Object.fromEntries(Object.entries(e).filter(([key]) => !META.has(key)))

// "mcp__claude_ai_Gmail__search_threads": the server, how to name it, the tool.
export const mcpOf = (tool: string) => {
  const parts = /^mcp__(.+?)__(.+)$/.exec(tool)
  if (parts === null) return undefined

  const [, server = '', name = ''] = parts
  if (server.startsWith('claude_ai_')) {
    return { to: `${server.slice('claude_ai_'.length).replace(/_/g, ' ')} via claude.ai`, tool: name }
  }
  if (server.startsWith('plugin_')) {
    const rest = server.slice('plugin_'.length)
    const cut = rest.indexOf('_')

    return { to: cut === -1 ? rest : rest.slice(cut + 1), tool: name }
  }

  return { to: server, tool: name }
}

const URL_HOST = /\b(?:https?|wss?|ftp|mqtts?|coap|rtsp|tcp|udp):\/\/(?:[^\s/@'"]+@)?(\[[^\]]+\]|[^\s/:'"?#]+)(?::(\d+))?/gi
const SCP_HOST = /\b[\w.-]+@([\w.-]+):/g
const IPV4 = /(?<![\d.])((?:\d{1,3}\.){3}\d{1,3})(?::(\d+))?(?![\d.])/g
const APP = /tell application "([^"]+)"/g
const NET = new Set([
  'ssh', 'sftp', 'mosh', 'telnet', 'nc', 'ncat', 'netcat', 'socat', 'ping', 'ping6', 'traceroute',
  'mtr', 'nmap', 'dig', 'nslookup', 'host', 'ftp', 'curl', 'wget', 'http', 'https', 'xh', 'scp', 'rsync',
])
const GIT_REMOTE = new Set(['push', 'pull', 'fetch', 'clone', 'ls-remote'])
const PREFIX = new Set(['sudo', 'time', 'exec', 'command', 'nohup', 'env'])

const isIpv4 = (text: string) => text.split('.').every(octet => Number(octet) <= 255)

const unquote = (token: string) => token.replace(/^['"]|['"]$/g, '')

// Each host a shell command reaches, once, with the program that reaches it.
export const targetsOf = (command: string): Target[] => {
  const found = new Map<string, Target>()
  const add = (target: Target) => {
    const key = 'host' in target ? target.host : `remote:${target.remote}`
    if (!found.has(key) && found.size < 5) found.set(key, target)
  }

  for (const [, app = ''] of command.matchAll(APP)) add({ host: app, what: 'Apple Events' })

  for (const segment of command.split(/\s*(?:&&|\|\||[;|\n])\s*/)) {
    const tokens = segment.trim().split(/\s+/).map(unquote)
    while (tokens.length > 0 && (PREFIX.has(tokens[0] ?? '') || /^\w+=/.test(tokens[0] ?? ''))) tokens.shift()

    const program = (tokens[0] ?? '').split('/').pop() ?? ''
    const sub = tokens[1] ?? ''
    const what = program === 'git' ? `git ${sub}` : program
    const before = found.size

    for (const [, host = ''] of segment.matchAll(URL_HOST)) add({ host: host.replace(/^\[|\]$/g, ''), what })
    if (NET.has(program) || program === 'git') {
      for (const [, host = ''] of segment.matchAll(SCP_HOST)) add({ host, what })
    }
    for (const [, ip = ''] of segment.matchAll(IPV4)) if (isIpv4(ip)) add({ host: ip, what })

    if (program === 'git' && GIT_REMOTE.has(sub) && found.size === before) {
      const remote = tokens.slice(2).find(token => !token.startsWith('-'))
      if (sub !== 'clone') add({ remote: remote ?? 'origin', what })
    } else if (NET.has(program) && found.size === before) {
      const host = tokens
        .slice(1)
        .map(token => token.replace(/^[^@\s]+@/, ''))
        .find(token => !token.startsWith('-') && /^[\w.-]+$/.test(token) && !/^\d+$/.test(token))
      if (host !== undefined) add({ host, what })
    }
  }

  return [...found.values()]
}

// A host from a git remote's URL: "git@github.com:me/x.git", "https://github.com/me/x".
export const hostOfRemote = (url: string) =>
  /^[\w.-]+@([\w.-]+):/.exec(url)?.[1] ?? /^\w+:\/\/(?:[^@/]+@)?([^/:]+)/.exec(url)?.[1]

type Ran = { text?: string; result?: unknown; isError?: boolean }

// The transfers a finished tool call made, `remote` targets left for the caller.
export const flowsOfTool = (tool: string, input: Record<string, unknown>, ran: Ran) => {
  const received = chars(ran.text?.length ?? sizeOf(ran.result))
  const isFailed = ran.isError === true ? true : undefined
  const mcp = mcpOf(tool)

  if (mcp !== undefined) {
    const args = JSON.stringify(input)
    const draft: Draft = { from: 'MCP', to: mcp.to, what: mcp.tool, up: chars(args.length), down: received, detail: oneLine(args), isFailed }

    return { drafts: [draft], remotes: [] }
  }

  if (tool === 'WebFetch' && typeof input.url === 'string') {
    const parsed = /^\w+:\/\/([^/:?#]+)[^/?#]*([^\s]*)/.exec(input.url)
    const host = parsed?.[1] ?? input.url
    const draft: Draft = { from: 'WebFetch', to: host, tag: tagOf(host), what: `GET ${parsed?.[2] || '/'}`, down: received, detail: input.url, isFailed }

    return { drafts: [draft], remotes: [] }
  }

  if (tool === 'WebSearch' && typeof input.query === 'string') {
    const draft: Draft = { from: 'WebSearch', to: 'web search (run by Anthropic)', what: oneLine(input.query), down: received, detail: input.query, isFailed }

    return { drafts: [draft], remotes: [] }
  }

  if (tool === 'Bash' && typeof input.command === 'string') {
    const detail = oneLine(input.command)
    const targets = targetsOf(input.command)
    const drafts: Draft[] = []
    const remotes: { remote: string; what: string; detail: string; isFailed?: true }[] = []

    for (const target of targets) {
      if ('remote' in target) remotes.push({ ...target, detail, isFailed })
      else {
        const tag = target.what === 'Apple Events' ? 'local' : tagOf(target.host)
        drafts.push({ from: 'Bash', to: target.host, tag, what: target.what, detail, isFailed })
      }
    }

    return { drafts, remotes }
  }

  return { drafts: [], remotes: [] }
}

type Usage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

type Step = { model: string; messageCount: number; agentId?: string }
type ServerUse = { name: string; input: unknown }

// One model request: the conversation up, the answer down, and the tools the
// API ran on its side while answering.
export const flowsOfStep = (step: Step, usage: Usage | null, serverUses: readonly ServerUse[], api: string) => {
  const from = step.agentId === undefined ? 'Claude' : 'Subagent'
  const request: Draft = {
    from,
    to: api,
    what: step.model,
    ...(usage === null
      ? {}
      : {
          up: { n: usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens, unit: 'tok' as const },
          down: { n: usage.output_tokens, unit: 'tok' as const },
        }),
    detail: `sent ${step.messageCount} messages: the conversation so far, with the files and tool output in it`,
  }
  const served = serverUses.map((use): Draft => {
    const query = (use.input as { query?: unknown } | null)?.query

    return {
      from,
      to: `${use.name.replace(/_/g, ' ')} (run by Anthropic)`,
      what: typeof query === 'string' ? oneLine(query) : use.name,
      detail: oneLine(sizeOf(use.input) > 0 ? JSON.stringify(use.input) : use.name),
    }
  })

  return [request, ...served]
}
