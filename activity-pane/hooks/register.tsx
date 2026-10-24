import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ActivityCall, CallState, Flow } from '../types'
import { flowsOfStep, flowsOfTool, hostOfRemote, inputOf } from './flows'
import type { Draft } from './flows'
import {
  FLOW_ROWS,
  MIN_COLUMNS,
  TOOLS_ROWS,
  feedPathOf,
  paneIdOf,
  rectOf,
  ratioKeeping,
  ratioLeaving,
  ratioText,
  ratiosOf,
  shellCommand,
  viewerCommand,
} from './herdr'
import type { Column } from './herdr'

const PANE = 'activity'
const TITLE = 'Activity'
const KEEP = 500
const calls = atom({ plugin: 'activity-pane', key: 'calls' } as const, [])
const flows = atom({ plugin: 'activity-pane', key: 'flows' } as const, [])

// Catppuccin Mocha, herdr's default theme, so the pane matches the workspace around it.
const MOCHA = {
  blue: '#89b4fa',
  mauve: '#cba6f7',
  green: '#a6e3a1',
  yellow: '#f9e2af',
  peach: '#fab387',
  red: '#f38ba8',
  subtext0: '#a6adc8',
  overlay1: '#7f849c',
  overlay0: '#6c7086',
}

const MARK: Record<CallState, string> = { running: '…', done: '✓', failed: '✗', denied: '⊘' }
const COLOR: Record<CallState, string> = {
  running: MOCHA.yellow,
  done: MOCHA.green,
  failed: MOCHA.red,
  denied: MOCHA.peach,
}

// The one argument worth showing for a tool: its command, file, pattern or target.
const detailOf = (e: object): string => {
  const args = e as Record<string, unknown>
  const picked =
    args.command ?? args.file_path ?? args.notebook_path ?? args.pattern ??
    args.url ?? args.query ?? args.description ?? args.skill ?? ''
  const text = String(picked).replace(/\s+/g, ' ').trim()

  return picked === args.file_path || picked === args.notebook_path
    ? (text.split('/').pop() ?? text)
    : text
}

const took = (ms: number) => (ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`)

// The herdr pane Claude runs in, and where the column beside it is fed from.
type Herdr = { bin: string; pane: string; root: string; feed: string }

// What this module keeps between hooks: the column's herdr, the model API's
// name, and the feed write under way, if any.
type Live = { herdr?: Herdr; api: string; isDirty: boolean; writing?: Promise<void>; count: number }

// Session ends that end the process too; a /clear or a resume goes on beside the same column.
const EXITS = new Set(['prompt_input_exit', 'logout', 'other'])

async function apiOf($: EngineInterface) {
  const [base, bedrock, vertex] = await Promise.all([
    $.env.get('ANTHROPIC_BASE_URL'),
    $.env.get('CLAUDE_CODE_USE_BEDROCK'),
    $.env.get('CLAUDE_CODE_USE_VERTEX'),
  ])
  const isOn = (flag: string | undefined) => flag === '1' || flag === 'true'

  if (isOn(bedrock)) return 'Amazon Bedrock'
  if (isOn(vertex)) return 'Google Vertex AI'

  return (base === undefined ? undefined : /^\w+:\/\/([^/:]+)/.exec(base)?.[1]) ?? 'api.anthropic.com'
}

async function herdrOf($: EngineInterface, root: string): Promise<Herdr | undefined> {
  const [isHerdr, pane, bin, tmp, home] = await Promise.all([
    $.env.get('HERDR_ENV'),
    $.env.get('HERDR_PANE_ID'),
    $.env.get('HERDR_BIN_PATH'),
    $.env.get('TMPDIR'),
    $.env.get('HOME'),
  ])
  if (isHerdr !== '1' || pane === undefined || pane === '') return undefined

  // macOS gives each user a private TMPDIR; without one, ~/.claude rather than the shared /tmp
  return { bin: bin || 'herdr', pane, root, feed: feedPathOf(tmp || `${home}/.claude/activity`, pane) }
}

async function herdrRun($: EngineInterface, herdr: Herdr, args: string[]) {
  const ran = await $.process.run([herdr.bin, ...args], { timeoutMs: 5_000 })
  if (ran.exitCode !== 0) {
    throw new Error(`herdr ${args.slice(0, 2).join(' ')}: ${ran.stderr.trim() || `exit ${ran.exitCode}`}`)
  }

  return ran.stdout
}

const isAlive = ($: EngineInterface, herdr: Herdr, pane: string) =>
  herdrRun($, herdr, ['pane', 'get', pane]).then(() => true, () => false)

const close = ($: EngineInterface, herdr: Herdr, pane: string) =>
  herdrRun($, herdr, ['pane', 'close', pane]).then(() => undefined, () => undefined)

async function sizeOf($: EngineInterface, herdr: Herdr, pane: string) {
  return rectOf(await herdrRun($, herdr, ['pane', 'layout', '--pane', pane]), pane) ?? { width: 0, height: 40 }
}

const heightIn = async ($: EngineInterface, herdr: Herdr, pane: string) => (await sizeOf($, herdr, pane)).height

async function split($: EngineInterface, herdr: Herdr, pane: string, direction: 'right' | 'down', ratio: number) {
  const args = ['pane', 'split', '--pane', pane, '--direction', direction, '--ratio', ratioText(ratio), '--cwd', herdr.root, '--no-focus']

  return paneIdOf(await herdrRun($, herdr, args))
}

async function startViewer($: EngineInterface, herdr: Herdr, pane: string, viewer: 'flow' | 'tools') {
  await herdrRun($, herdr, ['pane', 'rename', pane, viewer === 'flow' ? 'Data flow' : 'Tools'])
  await herdrRun($, herdr, ['pane', 'run', pane, viewerCommand($.plugin.root, viewer, herdr.feed)])
}

const columnKey = (herdr: Herdr) => `column:${herdr.pane}`

// Splits Claude's pane right, then that pane down twice: data flow, shell, tools.
async function build($: EngineInterface, herdr: Herdr): Promise<Column> {
  const made: string[] = []
  try {
    const ratios = ratiosOf(await heightIn($, herdr, herdr.pane))
    const flow = await split($, herdr, herdr.pane, 'right', 0.5)
    made.push(flow)
    const shell = await split($, herdr, flow, 'down', ratios.flow)
    made.push(shell)
    const tools = await split($, herdr, shell, 'down', ratios.tools)
    made.push(tools)

    await herdrRun($, herdr, ['pane', 'rename', shell, 'Shell'])
    await herdrRun($, herdr, ['pane', 'run', shell, shellCommand($.plugin.root, herdr.feed)])
    await Promise.all([startViewer($, herdr, flow, 'flow'), startViewer($, herdr, tools, 'tools')])

    return { flow, shell, tools }
  } catch (error) {
    await Promise.all(made.map(pane => close($, herdr, pane)))
    throw error
  }
}

// Opens the column beside Claude, or makes again what is gone of it. A shell
// still there is kept whatever else is missing: it may be running something.
async function openColumn($: EngineInterface, herdr: Herdr) {
  const known = (await $.store.get(columnKey(herdr))) as Column | undefined
  const [hasFlow, hasShell, hasTools] =
    known === undefined
      ? [false, false, false]
      : await Promise.all([known.flow, known.shell, known.tools].map(pane => isAlive($, herdr, pane)))

  let column: Column
  if (known !== undefined && hasShell) {
    column = { ...known }
    if (!hasTools) {
      column.tools = await split($, herdr, column.shell, 'down', ratioLeaving(await heightIn($, herdr, column.shell), TOOLS_ROWS))
      await startViewer($, herdr, column.tools, 'tools')
    }
    if (!hasFlow) {
      // herdr splits only right or down: make it below the shell, then swap it above.
      const flow = await split($, herdr, column.shell, 'down', ratioKeeping(await heightIn($, herdr, column.shell), FLOW_ROWS))
      await herdrRun($, herdr, ['pane', 'swap', '--source-pane', column.shell, '--target-pane', flow])
      await startViewer($, herdr, flow, 'flow')
      column.flow = flow
    }
  } else {
    if (known !== undefined) {
      await Promise.all([hasFlow && close($, herdr, known.flow), hasTools && close($, herdr, known.tools)])
    }
    column = await build($, herdr)
  }

  await $.store.set(columnKey(herdr), column)

  return column
}

// Writes the feed the column's viewers read, once more for any change made meanwhile.
function feed($: EngineInterface, live: Live) {
  const herdr = live.herdr
  if (herdr === undefined) return

  live.isDirty = true
  live.writing ??= (async () => {
    while (live.isDirty) {
      live.isDirty = false
      const [callList, flowList, session] = await Promise.all([read($, calls), read($, flows), $.session.id()])
      // `session` tells the shell pane's Agents views whose agents to show; it changes on a /clear
      await $.fs.write(herdr.feed, JSON.stringify({ calls: callList, flows: flowList, session }))
    }
  })()
    .catch(() => undefined)
    .finally(() => {
      live.writing = undefined
    })
}

async function addFlows($: EngineInterface, live: Live, drafts: readonly Draft[]) {
  if (drafts.length === 0) return

  const at = await $.clock.now()
  const made = drafts.map((draft): Flow => ({ ...draft, id: `${at}-${live.count++}`, at }))
  await update($, flows, list => [...list, ...made].slice(-KEEP))
  feed($, live)
}

async function remoteHost($: EngineInterface, remote: string) {
  try {
    const ran = await $.process.run(['git', 'remote', 'get-url', remote], { timeoutMs: 2_000 })

    return ran.exitCode === 0 ? hostOfRemote(ran.stdout.trim()) : undefined
  } catch {
    return undefined
  }
}

async function recordTool($: EngineInterface, live: Live, tool: string, input: Record<string, unknown>, ran: { text?: string; result?: unknown; isError?: boolean }) {
  const { drafts, remotes } = flowsOfTool(tool, input, ran)
  const fromRemotes = await Promise.all(
    remotes.map(async ({ remote, what, detail, isFailed }): Promise<Draft> => {
      const host = await remoteHost($, remote)

      return { from: 'Bash', to: host ?? `git remote ${remote}`, what, detail, isFailed }
    }),
  )

  await addFlows($, live, [...drafts, ...fromRemotes])
}

// Runs recording work apart from the hook that saw it, so it can never fail the hook.
const aside = (work: () => Promise<unknown>) => {
  void Promise.resolve()
    .then(work)
    .catch(() => undefined)
}

// The column beside Claude in herdr; elsewhere, or when herdr refuses, the pane
// inside Claude. Unasked, a Claude pane too narrow to share keeps the pane inside.
async function openHere($: EngineInterface, live: Live, isAsked: boolean) {
  const herdr = live.herdr
  if (herdr === undefined) {
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'Activity pane opened.' }
  }

  try {
    const hasColumn = (await $.store.get(columnKey(herdr))) !== undefined
    if (!isAsked && !hasColumn && (await sizeOf($, herdr, herdr.pane)).width < MIN_COLUMNS) {
      await $.ui.open({ id: PANE, title: TITLE })

      return { text: 'Activity pane opened; /activity opens the column beside Claude.' }
    }

    await openColumn($, herdr)
    feed($, live)

    return { text: 'Activity column open beside Claude.' }
  } catch (error) {
    await $.ui.open({ id: PANE, title: TITLE })
    const why = error instanceof Error ? error.message : String(error)

    return { text: `The herdr column could not be opened (${why}); the Activity pane is open instead.`, isFallback: true }
  }
}

export const register: Register = on => {
  const live: Live = { api: 'api.anthropic.com', isDirty: false, count: 0 }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'activity',
      description: 'Open the activity column beside Claude in herdr, or the Activity pane elsewhere',
    })
    live.api = await apiOf($)
    live.herdr = e.isInteractive ? await herdrOf($, await $.session.root()) : undefined

    const opened = await openHere($, live, false)
    if (opened.isFallback === true) $.ui.toast(opened.text)

    return next(e)
  })

  on('command.run', { command: 'activity' }, async $ => ({ text: (await openHere($, live, true)).text }))

  on('session.end', async ($, e, next) => {
    const herdr = live.herdr
    if (herdr !== undefined && EXITS.has(e.reason)) {
      const known = (await $.store.get(columnKey(herdr))) as Column | undefined
      if (known !== undefined) {
        await Promise.all([known.flow, known.shell, known.tools].map(pane => close($, herdr, pane)))
        await $.store.delete(columnKey(herdr))
      }
    }

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const startedAt = await $.clock.now()
    const call: ActivityCall = {
      id: e.tool_use_id ?? `${String(e.tool)}-${startedAt}`,
      tool: String(e.tool),
      detail: detailOf(e),
      isSubagent: e.agentId !== undefined,
      state: 'running',
    }
    await update($, calls, list => [...list, call].slice(-KEEP))
    feed($, live)

    let state: CallState = 'failed'
    try {
      const ran = await next(e)
      state = ran.deny !== undefined ? 'denied' : ran.isError === true ? 'failed' : 'done'
      if (ran.deny === undefined) {
        aside(() => recordTool($, live, String(e.tool), inputOf(e), { text: ran.text, result: ran.result, isError: ran.isError }))
      }

      return ran
    } finally {
      const ms = (await $.clock.now()) - startedAt
      await update($, calls, list =>
        list.map(one => (one.id === call.id ? { ...one, state, ms } : one)),
      )
      feed($, live)
    }
  })

  // Each model request: forwarded untouched, recorded once it has settled.
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    aside(() => addFlows($, live, flowsOfStep(e, result.usage, result.serverToolUses ?? [], live.api)))

    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const list = await read($, calls)
    const room = e.props.placement === 'dock' ? Math.max(1, e.props.scroll.bodyRows - 1) : 8
    const failed = list.filter(call => call.state === 'failed').length

    return (
      <Box flexDirection="column">
        <Text color={MOCHA.overlay1}>
          {list.length === 0 ? 'No tool calls yet.' : `${list.length} tool calls`}
          {failed > 0 && <Text color={MOCHA.red}>, {failed} failed</Text>}
        </Text>
        {list.slice(-room).map(call => (
          <Box key={call.id}>
            <Text wrap="truncate-end">
              <Text color={COLOR[call.state]}>{MARK[call.state]}</Text>{' '}
              {call.isSubagent && <Text color={MOCHA.mauve}>↳ </Text>}
              <Text color={MOCHA.blue} weight="bold">{call.tool}</Text>
              {call.ms !== undefined && <Text color={MOCHA.overlay0}> {took(call.ms)}</Text>}
              <Text color={MOCHA.subtext0}> {call.detail}</Text>
            </Text>
          </Box>
        ))}
      </Box>
    )
  })
}
