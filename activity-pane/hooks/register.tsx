import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ActivityCall, CallState, Flow } from '../types'
import { flowsOfStep, flowsOfTool, hostOfRemote, inputOf } from './flows'
import type { Draft } from './flows'
import {
  FLOW_ROWS,
  GIT_RATIOS,
  GIT_SHARE,
  TOOLS_ROWS,
  feedDirOf,
  feedPathOf,
  paneIdOf,
  rectOf,
  ratioKeeping,
  ratioLeaving,
  ratioText,
  ratiosOf,
  shellCommand,
  socketOf,
  tabOf,
  viewerCommand,
  workspaceOf,
  SESSION,
  WORKSPACE,
} from './herdr'
import type { Column, GitPanes } from './herdr'

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
// `session` is the herdr session the column lives in; none means Claude's own (the old column beside it).
type Herdr = { bin: string; pane: string; root: string; feed: string; session?: string }

const inMain = (herdr: Herdr): Herdr => ({ ...herdr, session: undefined })

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
  const [isHerdr, pane, bin, home] = await Promise.all([
    $.env.get('HERDR_ENV'),
    $.env.get('HERDR_PANE_ID'),
    $.env.get('HERDR_BIN_PATH'),
    $.env.get('HOME'),
  ])
  if (isHerdr !== '1' || pane === undefined || pane === '' || !home) return undefined

  return { bin: bin || 'herdr', pane, root, feed: feedPathOf(home, pane), session: SESSION }
}

// The feed's folder, readable by this user alone, before anything is written to it.
async function privateDir($: EngineInterface, herdr: Herdr) {
  const ran = await $.process.run(['install', '-d', '-m', '700', feedDirOf(herdr.feed)], { timeoutMs: 5_000 })
  if (ran.exitCode !== 0) throw new Error(`install -d: ${ran.stderr.trim() || `exit ${ran.exitCode}`}`)
}

async function herdrRun($: EngineInterface, herdr: Herdr, args: string[]) {
  const at = herdr.session === undefined ? [] : ['--session', herdr.session]
  const ran = await $.process.run([herdr.bin, ...at, ...args], { timeoutMs: 5_000 })
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

const GIT_KEYS = ['files', 'branches', 'commits'] as const
const GIT_LABEL = { files: 'Files', branches: 'Branches', commits: 'Commits' }

// A git viewer reads the repository itself (no feed file): the folder Claude runs in.
async function startGit($: EngineInterface, herdr: Herdr, pane: string, key: keyof GitPanes) {
  await herdrRun($, herdr, ['pane', 'rename', pane, GIT_LABEL[key]])
  await herdrRun($, herdr, ['pane', 'run', pane, viewerCommand($.plugin.root, `git_${key}`, herdr.root)])
}

const columnKey = (herdr: Herdr) => `column:${herdr.pane}`

const folderOf = (root: string) => root.split('/').filter(Boolean).pop() ?? 'Claude'

// A tab for this session in the activity session's workspace, named after its folder. When the
// session has no workspace, the one made for it brings the first tab. Only that new workspace takes
// focus, so the window shows it; later tabs leave the window on the tab it shows.
async function newTab($: EngineInterface, herdr: Herdr) {
  const label = folderOf(herdr.root)
  const found = await locked($, herdr, async () => {
    const there = workspaceOf(await herdrRun($, herdr, ['workspace', 'list']))

    return there ?? tabOf(await herdrRun($, herdr, ['workspace', 'create', '--label', WORKSPACE, '--cwd', herdr.root, '--focus']))
  })
  if (typeof found === 'string') {
    return tabOf(await herdrRun($, herdr, ['tab', 'create', '--workspace', found, '--label', label, '--cwd', herdr.root, '--no-focus']))
  }

  await herdrRun($, herdr, ['tab', 'rename', found.tab, label]).catch(async error => {
    await closeTab($, herdr, found.tab)
    throw error
  })

  return found
}

// Runs `work` holding a lock folder, so Claude sessions starting together (a hot reload starts
// them all) make one workspace between them. A lock older than its 5 s wait is taken over.
async function locked<T>($: EngineInterface, herdr: Herdr, work: () => Promise<T>) {
  const lock = `${feedDirOf(herdr.feed)}/workspace.lock`
  const take = async () => (await $.process.run(['mkdir', lock], { timeoutMs: 2_000 })).exitCode === 0
  let isHeld = false
  for (let tries = 0; tries < 25 && !isHeld; tries += 1) {
    isHeld = await take()
    if (!isHeld) await $.clock.sleep(200)
  }
  // left by a session that died holding it: take it over
  if (!isHeld) {
    await $.process.run(['rmdir', lock], { timeoutMs: 2_000 })
    await take()
  }
  try {
    return await work()
  } finally {
    await $.process.run(['rmdir', lock], { timeoutMs: 2_000 }).catch(() => undefined)
  }
}

const closeTab = ($: EngineInterface, herdr: Herdr, tab: string) =>
  herdrRun($, herdr, ['tab', 'close', tab]).then(() => undefined, () => undefined)

// Makes a tab in the activity session and splits its pane right for the column, leaving it the
// git strip's Files; the column's pane down twice (data flow, shell, tools) and the strip's down
// twice (Files, Branches, Commits). A failure closes the whole tab.
async function build($: EngineInterface, herdr: Herdr): Promise<Column> {
  const { tab, pane: root } = await newTab($, herdr)
  try {
    const ratios = ratiosOf((await sizeOf($, herdr, root)).height)
    const flow = await split($, herdr, root, 'right', GIT_SHARE)
    const shell = await split($, herdr, flow, 'down', ratios.flow)
    const tools = await split($, herdr, shell, 'down', ratios.tools)
    const branches = await split($, herdr, root, 'down', GIT_RATIOS.files)
    const commits = await split($, herdr, branches, 'down', GIT_RATIOS.branches)
    const git: GitPanes = { files: root, branches, commits }

    await herdrRun($, herdr, ['pane', 'rename', shell, 'Shell'])
    await herdrRun($, herdr, ['pane', 'run', shell, shellCommand($.plugin.root, herdr.feed)])
    await Promise.all([
      startViewer($, herdr, flow, 'flow'),
      startViewer($, herdr, tools, 'tools'),
      ...GIT_KEYS.map(key => startGit($, herdr, git[key], key)),
    ])

    return { tab, flow, shell, tools, git }
  } catch (error) {
    await closeTab($, herdr, tab)
    throw error
  }
}

// When the activity server started: its socket's mtime, set when it binds and never after. A tab
// column stamped by another start belongs to a server that is gone, and its ids may name other panes now.
async function serverOf($: EngineInterface, herdr: Herdr) {
  const socket = socketOf(await herdrRun($, inMain(herdr), ['session', 'list', '--json']), herdr.session ?? '')
  if (socket === undefined) throw new Error(`server_not_running: herdr session ${herdr.session ?? ''}`)

  return (await $.fs.stat(socket)).mtimeMs
}

// Closes a column: its tab, or the panes of one left beside Claude, in Claude's session, by the old mod.
const closeColumn = ($: EngineInterface, herdr: Herdr, column: Column) =>
  column.tab !== undefined
    ? closeTab($, herdr, column.tab)
    : Promise.all([column.flow, column.shell, column.tools, ...Object.values(column.git ?? {})].map(pane => close($, inMain(herdr), pane)))

// Makes again the git panes that are gone while some are left; all gone, they were closed on
// purpose and stay so. Each is split down from a neighbour that is there (Files, which sits
// on top, is swapped above it).
async function repairGit($: EngineInterface, herdr: Herdr, git: GitPanes) {
  const alive = await Promise.all(GIT_KEYS.map(key => isAlive($, herdr, git[key])))
  if (alive.every(Boolean) || !alive.some(Boolean)) return git

  const now = { ...git }
  for (const [at, key] of GIT_KEYS.entries()) {
    if (alive[at]) continue

    const anchor = key === 'files' ? (alive[1] ? now.branches : now.commits) : key === 'branches' ? now.files : now.branches
    now[key] = await split($, herdr, anchor, 'down', 0.5)
    if (key === 'files') await herdrRun($, herdr, ['pane', 'swap', '--source-pane', anchor, '--target-pane', now[key]])
    alive[at] = true
    await startGit($, herdr, now[key], key)
  }

  return now
}

// Opens the column in the activity session, or makes again what is gone of it. A shell
// still there is kept whatever else is missing: it may be running something. Two kinds are built
// again only when /activity asks, their shell closed then: a column the old mod left beside Claude,
// and one made without the git strip.
async function openColumn($: EngineInterface, herdr: Herdr, isAsked: boolean) {
  const known = (await $.store.get(columnKey(herdr))) as Column | undefined
  const isBeside = known !== undefined && known.tab === undefined
  const [hasFlow, hasShell, hasTools] =
    known === undefined
      ? [false, false, false]
      : await Promise.all([known.flow, known.shell, known.tools].map(pane => isAlive($, isBeside ? inMain(herdr) : herdr, pane)))
  // an old column with nothing left of it is replaced at once
  if (isBeside && !isAsked && (hasFlow || hasShell || hasTools)) return known
  const server = await serverOf($, herdr)
  // a column from an earlier activity server went with it: nothing of it to keep or close
  // (one made before stamps existed counts as this server's: it is stamped below)
  if (known?.tab !== undefined && known.server !== undefined && known.server !== server) {
    await $.store.delete(columnKey(herdr))

    return openColumn($, herdr, isAsked)
  }

  let column: Column
  // a column built without the git strip (once skipped in a narrow window) is built again when asked
  const isStripless = known?.git === undefined && isAsked
  if (known !== undefined && hasShell && !isBeside && !isStripless) {
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
    if (known.git !== undefined) column.git = await repairGit($, herdr, known.git)
  } else {
    // built before the old one closes, so a failure leaves the old one there
    column = await build($, herdr)
    if (known !== undefined) await closeColumn($, herdr, known)
  }

  column.server = server
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

// The column in herdr's Activity workspace; elsewhere, or when herdr refuses, the pane inside Claude.
async function openHere($: EngineInterface, live: Live, isAsked: boolean) {
  const herdr = live.herdr
  if (herdr === undefined) {
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'Activity pane opened.' }
  }

  try {
    await openColumn($, herdr, isAsked)
    feed($, live)

    return { text: `Activity panels open in the herdr session "${SESSION}".` }
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error)
    // the Activity window is closed: say how to open it, and keep Claude's pane whole
    if (why.includes('server_not_running')) {
      return { text: `The Activity window is not open: run \`herdr session attach ${SESSION}\` in a second terminal window, then /activity.`, isFallback: true }
    }

    await $.ui.open({ id: PANE, title: TITLE })

    return { text: `The herdr column could not be opened (${why}); the Activity pane is open instead.`, isFallback: true }
  }
}

export const register: Register = on => {
  const live: Live = { api: 'api.anthropic.com', isDirty: false, count: 0 }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'activity',
      description: 'Open the activity panels in the herdr session "activity" (a second window), or the Activity pane elsewhere',
    })
    // Kept for scout/maker tabs the removed worker feature left running (CLAUDE_MODS_ROLE is
    // set in them): a hot reload re-runs this hook there, and they must not grow columns.
    // Delete these two lines once no such tab is left.
    if (await $.env.get('CLAUDE_MODS_ROLE')) return next(e)
    live.api = await apiOf($)
    live.herdr = e.isInteractive ? await herdrOf($, await $.session.root()) : undefined
    // no private folder for the feed, no column: the Activity pane inside Claude instead
    if (live.herdr !== undefined) await privateDir($, live.herdr).catch(() => (live.herdr = undefined))

    const opened = await openHere($, live, false)
    if (opened.isFallback === true) $.ui.toast(opened.text)

    return next(e)
  })

  on('command.run', { command: 'activity' }, async $ => ({ text: (await openHere($, live, true)).text }))

  on('session.end', async ($, e, next) => {
    const herdr = live.herdr
    if (herdr !== undefined && EXITS.has(e.reason)) {
      const known = (await $.store.get(columnKey(herdr))) as Column | undefined
      // a tab is closed only on the server that made it; another start has reused its ids
      const isOurs = known?.tab === undefined || known.server === undefined || (await serverOf($, herdr).catch(() => undefined)) === known.server
      if (known !== undefined) {
        if (isOurs) await closeColumn($, herdr, known)
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
