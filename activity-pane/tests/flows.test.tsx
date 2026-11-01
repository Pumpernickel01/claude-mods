import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { Flow } from '../types'
import { IN_HERDR, herdr, session } from './kit'

const START = { cwd: '/Users/me/lab2', surface: 'terminal', isInteractive: true } as const

// A session in herdr whose tools answer as the engine would, and whose git
// knows where origin points. `flows()` reads them from the column's feed.
function setUp(on: On) {
  const clock = mock.clock(on, { now: 0 })
  herdr(on, { other: argv => (argv.join(' ') === 'git remote get-url origin' ? 'git@github.com:me/thesis.git\n' : undefined) })
  const seen = session(on, IN_HERDR)
  on('tool.call', (_$, e) => {
    if (e.tool === 'Bash' && String((e as { command?: unknown }).command).startsWith('rm ')) return { deny: 'not here' }

    return { result: { ok: true }, text: 'x'.repeat(8_200) }
  })

  return {
    clock,
    flows: async (): Promise<Flow[]> => {
      // Recording runs beside the call it records: let it land first.
      await clock.settle()
      const last = seen.written.at(-1)

      return last === undefined ? [] : (JSON.parse(last.text) as { flows: Flow[] }).flows
    },
  }
}

const bash = (command: string, id: string) => ({ tool: 'Bash', tool_use_id: id, command, description: '' }) as const

test('a web fetch goes to the URL’s host, with what came back', async ($, on) => {
  const { flows } = setUp(on)
  await $.session.start(START)

  await $.tool.call({ tool: 'WebFetch', tool_use_id: 'w1', url: 'https://herdr.dev/llms.txt', prompt: 'how to split' })

  expect(await flows()).toMatchObject([
    { from: 'WebFetch', to: 'herdr.dev', what: 'GET /llms.txt', down: { n: 8_200, unit: 'B' }, detail: 'https://herdr.dev/llms.txt' },
  ])
})

test('a web fetch with userinfo goes to the real host, never tagged local by it', async ($, on) => {
  const { flows } = setUp(on)
  await $.session.start(START)

  await $.tool.call({ tool: 'WebFetch', tool_use_id: 'w2', url: 'http://127.0.0.1@evil.example/x?y=1', prompt: '' })

  expect((await flows()).map(flow => [flow.to, flow.tag, flow.what])).toEqual([['evil.example', undefined, 'GET /x?y=1']])
})

test('a name that only looks like a local or private address gets no tag', async ($, on) => {
  const { flows } = setUp(on)
  await $.session.start(START)

  await $.tool.call(bash('curl https://127.evil.example/ https://10.example.org/ http://10.0.0.5/ http://127.0.0.1:8080/', 'b8'))

  expect((await flows()).map(flow => [flow.to, flow.tag])).toEqual([
    ['127.evil.example', undefined],
    ['10.example.org', undefined],
    ['10.0.0.5', 'LAN'],
    ['127.0.0.1', 'local'],
  ])
})

test('a shell command reaching more than five places says how many are not listed', async ($, on) => {
  const { flows } = setUp(on)
  await $.session.start(START)

  const hosts = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(name => `https://${name}.example/`)
  await $.tool.call(bash(`curl ${hosts.join(' ')}`, 'b9'))

  expect((await flows()).map(flow => flow.to)).toEqual(['a.example', 'b.example', 'c.example', 'd.example', 'e.example', '+2 more destinations'])
})

test('an MCP call names its server, what it sent and what came back', async ($, on) => {
  const { flows } = setUp(on)
  await $.session.start(START)

  await $.tool.call({ tool: 'mcp__claude_ai_Gmail__search_threads', tool_use_id: 'm1', query: 'thesis deadline' } as never)

  expect(await flows()).toMatchObject([
    {
      from: 'MCP',
      to: 'Gmail via claude.ai',
      what: 'search_threads',
      up: { n: '{"query":"thesis deadline"}'.length, unit: 'B' },
      down: { n: 8_200, unit: 'B' },
      detail: '{"query":"thesis deadline"}',
    },
  ])
})

test('a shell command gets a line for each place it reaches, the local network marked', async ($, on) => {
  const { flows } = setUp(on)
  await $.session.start(START)

  await $.tool.call(bash('curl -X POST http://192.168.4.1/led && ssh pi@raspberrypi.local uptime', 'b1'))
  await $.tool.call(bash('git push origin main', 'b2'))
  await $.tool.call(bash(`osascript -e 'tell application "Spotify" to playpause'`, 'b3'))
  await $.tool.call(bash('ping -c 2 localhost', 'b4'))
  const list = await flows()

  expect(list.map(flow => [flow.to, flow.tag, flow.what])).toEqual([
    ['192.168.4.1', 'LAN', 'curl'],
    ['raspberrypi.local', 'LAN', 'ssh'],
    ['github.com', undefined, 'git push'],
    ['Spotify', 'local', 'Apple Events'],
    ['localhost', 'local', 'ping'],
  ])
  expect(list[0]?.detail).toBe('curl -X POST http://192.168.4.1/led && ssh pi@raspberrypi.local uptime')
})

test('a URL with an @ after its authority, an empty port or a variable in the host names no host at all', async ($, on) => {
  const { flows } = setUp(on)
  await $.session.start(START)

  await $.tool.call(bash('curl https://user:p@ss@api.example.com/x', 'b1'))
  await $.tool.call(bash('curl https://api.example.com?to=a@evil.com', 'b2'))
  await $.tool.call(bash('curl https://api.example.com$SUFFIX/x', 'b3'))
  await $.tool.call(bash('curl https://TOKEN:x@host$S/ http://localhost:x@evil.com$E/', 'b4'))
  await $.tool.call(bash('curl http://[::1]:8080/x', 'b5'))
  await $.tool.call(bash("curl https://user:p'ss@host/ https://api.example.com:8080/x", 'b6'))
  await $.tool.call(bash("curl https://TOKEN:'pw'@host.example.com/ \"https://api.example.com\"", 'b7'))
  await $.tool.call(bash("curl https://TOKEN:123'x'@host.example.com/ https://TOKEN'x@host.example.com/ https://TOKEN:/pw@host/ https://TOKEN:1234/pw@host/", 'b8'))
  await $.tool.call(bash('curl https://api.example.com:/x', 'b9'))
  await $.tool.call(bash('curl https://u:p@ss/w@host/ https://AbC/xyz@host/ https://user:p@ss/word@host/', 'b10'))
  await $.tool.call(bash("curl 'https://TOKEN:1234;pw@host/' 'https://TOKEN;x@host/'", 'b11'))
  await $.tool.call(bash('curl "https://api.example.com', 'b12'))
  await $.tool.call(bash('curl https://TOKEN:123#x@host/ https://TOKEN:/pw#x@host/', 'b13'))
  await $.tool.call(bash('echo a#b; curl https://api.example.com/ # not https://evil.com', 'b14'))
  await $.tool.call(bash('curl http://nas:5000/ && curl http://localhost:8080/', 'b15'))
  await $.tool.call(bash(`ssh box.example.net "echo it's`, 'b16'))
  await $.tool.call(bash(`FOO=1 sudo scp pi@box.example.net:x "it's`, 'b17'))
  await $.tool.call(bash(`FOO=1 sudo curl -d "it's`, 'b18'))
  const list = await flows()

  // One line per command: b1 and b2 name their host (a query @ does not touch a plain host); b3 (a variable),
  // b4 (a token before a variable host), b6 and b8 (an unbalanced quote makes the whole command unresolved),
  // b10 (a later @ after userinfo or a bare word) and b12 are listed but withheld; b5 is IPv6; b7 reads whole;
  // b9's empty port is a port; b11's quoted ; stays in its word and names host, not the token; b13's # inside a
  // word is no comment; b14's # at a word's start is one; b15's dotless nas is unresolved, localhost itself;
  // b16's unbalanced quote on a net command is still listed
  expect(list.map(flow => flow.to)).toEqual([
    'api.example.com', 'api.example.com', '(unresolved host)', '(unresolved host)', '::1', '(unresolved host)',
    'host.example.com', 'api.example.com', '(unresolved host)', 'api.example.com', '(unresolved host)', 'host', '(unresolved host)',
    '(unresolved host)', 'api.example.com', '(unresolved host)', 'localhost', '(unresolved host)', '(unresolved host)', '(unresolved host)',
  ])
  expect(JSON.stringify(list.map(flow => flow.to))).not.toContain('TOKEN')
  expect(list.map(flow => flow.to).join()).not.toContain('TOKEN')
  expect(list.map(flow => flow.to).join()).not.toContain('@')
})

test('commands that reach nothing, and calls that were denied, make no line', async ($, on) => {
  const { flows } = setUp(on)
  await $.session.start(START)

  await $.tool.call(bash('git commit -m "fix\n\nCo-Authored-By: Claude <noreply@anthropic.com>"', 'b1'))
  await $.tool.call(bash('claude plugin test . && ls -la', 'b2'))
  await $.tool.call(bash('rm -rf build && curl https://example.com', 'b3'))
  await $.tool.call({ tool: 'Read', tool_use_id: 'r1', file_path: '/lab2/notes.md' })

  expect(await flows()).toEqual([])
})

test('each model request goes to the API with the tokens it sent and got back', async ($, on) => {
  const { flows } = setUp(on)
  on('turn.step', async function* (_$, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: 'done',
      toolUses: [],
      serverToolUses: [{ id: 's1', name: 'web_search', input: { query: 'esp32 espnow latency' }, startedAt: 0 }],
      stopReason: 'end_turn',
      usage: { model: e.model, input_tokens: 1_200, cache_read_input_tokens: 60_000, cache_creation_input_tokens: 800, output_tokens: 850 },
    }
  })
  await $.session.start(START)

  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 41 })
  let step = await stream.next()
  while (step.done !== true) step = await stream.next()
  expect(step.value.answer).toBe('done')

  const list = await flows()
  expect(list[0]).toMatchObject({
    from: 'Claude',
    to: 'api.anthropic.com',
    what: 'claude-opus-5-5',
    up: { n: 62_000, unit: 'tok' },
    down: { n: 850, unit: 'tok' },
  })
  expect(list[0]?.detail).toMatch(/^sent 41 messages/)
  expect(list[1]).toMatchObject({ from: 'Claude', to: 'web search (run by Anthropic)', what: 'esp32 espnow latency' })
})
