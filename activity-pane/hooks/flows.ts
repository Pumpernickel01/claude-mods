import type { Amount, Flow } from '../types'

// A flow before it has a time and an id.
export type Draft = Omit<Flow, 'id' | 'at'>

// Where a shell command points: a host, or a git remote still to be looked up.
export type Target = { host: string; what: string } | { remote: string; what: string }

const LAN_V4 = [/^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./]

export const tagOf = (host: string): Flow['tag'] =>
  tagOfName(host.toLowerCase())

// The address ranges apply to dotted IPv4 addresses alone: 127.example.com or 10.example.org is a
// name like any other and gets no tag.
const tagOfName = (name: string): Flow['tag'] => {
  if (name === 'localhost' || name === '::1' || name === '0.0.0.0') return 'local'
  if (name.endsWith('.local')) return 'LAN'
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(name) || !isIpv4(name)) return undefined

  return name.startsWith('127.') ? 'local' : LAN_V4.some(r => r.test(name)) ? 'LAN' : undefined
}

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

// The whole authority (up to / ? # or a quote), one unit: urlHost takes the host out of it, so a regex can
// never backtrack into a password and call it the host.
// a name with labels and an alphabetic last one, or an IPv4: what a host plainly looks like
const HOSTLIKE = /^(?:\d{1,3}(?:\.\d{1,3}){3}|[\w-]+(?:\.[\w-]+)*\.[a-z]+)$/i
const URL_AUTH = /\b(?:https?|wss?|ftp|mqtts?|coap|rtsp|tcp|udp):\/\/([^\s/?#'"]+)(['"][^\s/?#]*)?/gi // 2: cut by a quote

// The host of a URL authority: after the last @, before the port. None when the authority holds a shell or
// template placeholder ($, backtick, braces, backslash) anywhere, when it was cut short (`cut`: a quote with text
// behind it, or an @ later in the same word, as in TOKEN:1234/pw@host), or when, with no @, what follows the host
// is not a port. An empty port (host:/x) is a port: words are read whole, quotes resolved, so nothing is
// cut at a quoted separator or space any more.
const urlHost = (authority: string, cut: boolean) => {
  if (cut || /[${}`\\]/.test(authority)) return undefined
  const at = authority.lastIndexOf('@')
  const hostport = authority.slice(at + 1)
  const bracket = hostport.startsWith('[') ? hostport.indexOf(']') : -1
  const host = bracket > 0 ? hostport.slice(1, bracket) : hostport.split(':')[0] ?? ''
  const rest = bracket > 0 ? hostport.slice(bracket + 1) : hostport.slice(host.length)
  if (host === '') return undefined
  // with no userinfo the host must look like one: a bare token before a port is no host
  if (at <= 0 && ((rest !== '' && !/^:\d*$/.test(rest)) || !(bracket > 0 || host === 'localhost' || HOSTLIKE.test(host)))) return undefined

  return host
}
const SCP_HOST = /\b[\w.-]+@([\w.-]+):/g
const IPV4 = /(?<![\d.])((?:\d{1,3}\.){3}\d{1,3})(?::(\d+))?(?![\d.])/g
const APP = /tell application "([^"]+)"/g
const NET = new Set([
  'ssh', 'sftp', 'mosh', 'telnet', 'nc', 'ncat', 'netcat', 'socat', 'ping', 'ping6', 'traceroute',
  'mtr', 'nmap', 'dig', 'nslookup', 'host', 'ftp', 'curl', 'wget', 'http', 'https', 'xh', 'scp', 'rsync',
])
const parsedUrl = (text: string) => {
  try {
    return new URL(text)
  } catch {
    return undefined
  }
}

// Destination lines one Bash command makes before the "+N more" line.
const SHOWN = 5

const GIT_REMOTE = new Set(['push', 'pull', 'fetch', 'clone', 'ls-remote'])
const PREFIX = new Set(['sudo', 'time', 'exec', 'command', 'nohup', 'env'])

const isIpv4 = (text: string) => text.split('.').every(octet => Number(octet) <= 255)

const UNRESOLVED = '(unresolved host)' // a URL whose host could not be named safely: listed, not guessed

// The command's words, quotes resolved, in segments split at ; | & and newlines as a shell reads them, so a
// quoted separator or space stays inside its word; undefined when the quotes do not balance.
const segmentsOf = (command: string): string[][] | undefined => {
  const segments: string[][] = [[]]
  let word = ''
  let inWord = false
  let quote = ''
  const endWord = () => {
    if (inWord) segments[segments.length - 1]?.push(word)
    word = ''
    inWord = false
  }
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i] ?? ''
    if (quote !== '') {
      if (ch === quote) quote = ''
      else if (ch === '\\' && quote === '"' && i + 1 < command.length) word += command[(i += 1)]
      else word += ch
    } else if (ch === "'" || ch === '"') {
      quote = ch
      inWord = true
    } else if (ch === '#' && !inWord) {
      while (i + 1 < command.length && command[i + 1] !== '\n') i += 1 // a comment, as the shell reads one: at a word's start only
    } else if (ch === '\\' && i + 1 < command.length) {
      word += command[(i += 1)]
      inWord = true
    } else if (/\s/.test(ch)) {
      endWord()
      if (ch === '\n') segments.push([])
    } else if (ch === ';' || ch === '|' || ch === '&') {
      endWord()
      segments.push([])
    } else {
      word += ch
      inWord = true
    }
  }
  if (quote !== '') return undefined
  endWord()

  return segments
}

// (host or undefined) for each URL in one shell word. A later @ in the word fails closed unless the authority
// is plainly a host with no userinfo and either no port (every URL parser ends it at the /) or the @ in the
// query or fragment: api.example.com/x?to=a@b is named, while user:p@ss/w@host, AbC/xyz@host and
// TOKEN:1234/pw@host, a password with a / in it, are not.
const urlHosts = (word: string) =>
  [...word.matchAll(URL_AUTH)].map(m => {
    const [whole, authority = '', quoted = ''] = m
    const tail = word.slice((m.index ?? 0) + whole.length)
    const plain = !authority.includes('@') && HOSTLIKE.test(urlHost(authority, false) ?? '') && (!authority.includes(':') || /^[?#]/.test(tail))

    return urlHost(authority, quoted.length > 1 || (tail.includes('@') && !plain))
  })

// Each host a shell command reaches, once, with the program that reaches it.
export const targetsOf = (command: string): Target[] => {
  const found = new Map<string, Target>()
  const add = (target: Target) => {
    const key = 'host' in target ? target.host : `remote:${target.remote}`
    if (!found.has(key)) found.set(key, target)
  }

  for (const [, app = ''] of command.matchAll(APP)) add({ host: app, what: 'Apple Events' })

  const segments = segmentsOf(command)
  if (segments === undefined) {
    // unbalanced quotes: nothing is read as a host, but a command that looks like a network call is listed
    const programs = command.split(/[\n;|&]+/).map(line => line.trim().split(/\s+/)[0]?.split('/').pop() ?? '')
    const net = programs.find(program => NET.has(program) || program === 'git')
    if (net !== undefined || /:\/\//.test(command) || SCP_HOST.test(command)) add({ host: UNRESOLVED, what: net ?? 'shell' })

    return [...found.values()]
  }
  for (const words of segments) {
    const tokens = [...words]
    while (tokens.length > 0 && (PREFIX.has(tokens[0] ?? '') || /^\w+=/.test(tokens[0] ?? ''))) tokens.shift()

    const program = (tokens[0] ?? '').split('/').pop() ?? ''
    const sub = tokens[1] ?? ''
    const what = program === 'git' ? `git ${sub}` : program
    const before = found.size
    const joined = words.join(' ')
    let unresolved = false

    for (const word of words) {
      for (const host of urlHosts(word)) {
        if (host !== undefined) add({ host, what })
        else unresolved = true
      }
    }
    if (NET.has(program) || program === 'git') {
      for (const [, host = ''] of joined.matchAll(SCP_HOST)) add({ host, what })
    }
    for (const [, ip = ''] of joined.matchAll(IPV4)) if (isIpv4(ip)) add({ host: ip, what })

    if (program === 'git' && GIT_REMOTE.has(sub) && found.size === before) {
      const remote = tokens.slice(2).find(token => !token.startsWith('-'))
      if (sub !== 'clone') add({ remote: remote ?? 'origin', what })
    } else if (NET.has(program) && found.size === before) {
      const host = tokens
        .slice(1)
        .filter(token => !token.includes('://')) // a URL the rule above found no host in: never read as a bare host either
        .map(token => token.replace(/^[^@\s]+@/, ''))
        .find(token => !token.startsWith('-') && /^[\w.-]+$/.test(token) && !/^\d+$/.test(token))
      if (host !== undefined) add({ host, what })
    }
    if (unresolved && NET.has(program) && found.size === before) add({ host: UNRESOLVED, what }) // a network call was made: listed, its host withheld
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
    // URL's parser, not a regex: in http://127.0.0.1@evil.com the host is evil.com, not a local address
    const url = parsedUrl(input.url)
    const host = url?.hostname.replace(/^\[|\]$/g, '') ?? input.url
    const draft: Draft = { from: 'WebFetch', to: host, tag: url ? tagOf(host) : undefined, what: `GET ${url ? url.pathname + url.search : '/'}`, down: received, detail: input.url, isFailed }

    return { drafts: [draft], remotes: [] }
  }

  if (tool === 'WebSearch' && typeof input.query === 'string') {
    const draft: Draft = { from: 'WebSearch', to: 'web search (run by Anthropic)', what: oneLine(input.query), down: received, detail: input.query, isFailed }

    return { drafts: [draft], remotes: [] }
  }

  if (tool === 'Bash' && typeof input.command === 'string') {
    const detail = oneLine(input.command)
    // five lines at most, and one saying how many more, so the list never looks complete when it is not
    const all = targetsOf(input.command)
    const targets = all.slice(0, SHOWN)
    const drafts: Draft[] = []
    const remotes: { remote: string; what: string; detail: string; isFailed?: true }[] = []

    for (const target of targets) {
      if ('remote' in target) remotes.push({ ...target, detail, isFailed })
      else {
        const tag = target.what === 'Apple Events' ? 'local' : tagOf(target.host)
        drafts.push({ from: 'Bash', to: target.host, tag, what: target.what, detail, isFailed })
      }
    }

    if (all.length > SHOWN) {
      drafts.push({ from: 'Bash', to: `+${all.length - SHOWN} more destinations`, what: 'not listed', detail, isFailed })
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
