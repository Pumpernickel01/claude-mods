import type { EngineInterface, Register } from 'claude-code'

const THINKING = '● thinking…'

// The band that blinks soft orange above the prompt while Claude waits for the person: it asks
// something, or it has finished. Dark text on it, so it reads on a light or a dark terminal.
const GLOW = '#f6b27a'
const ON_GLOW = '#3c2a1e'
// The whole pane blinks too, lighter, so the text on it stays easy to read: the terminal's own
// background (OSC 11), so the cells behind the text change as well; OSC 111 puts it back.
const TINT = '#fcd9b8'
const PANE_LIT = `\x1b]11;${TINT}\x07`
const PANE_PLAIN = '\x1b]111\x07'
// The terminal device Claude draws on, as `ps` names it (macOS ttys016, Linux pts/3).
const TTY = /^(ttys\d+|pts\/\d+)$/
const BLINK_MS = 700
// After this long the blink holds still, lit, so a band left overnight starts no process a tick.
const BLINK_FOR_MS = 5 * 60_000
type Why = 'asking' | 'finished'
const SAYS: Record<Why, string> = { asking: '● Claude is asking you something', finished: '● Claude has finished' }
// Claude Code's notifications that mean it waits on the person, and why. A permission prompt is
// told here as its dialog shows, so one a hook or auto mode settles first lights nothing.
// shortcut: an approved call that runs long keeps "asking" until it ends; nothing tells a mod when
// the person answered the dialog. Upgrade if an event for that answer appears.
const NOTIFIED: Record<string, Why> = { permission_prompt: 'asking', elicitation_dialog: 'asking', idle_prompt: 'finished' }
// An agent in one of these is still working (a teammate between turns is `idle`, so not here).
const AT_WORK = new Set(['pending', 'running', 'waiting'])

// Whether a background agent the main loop started still works. Its report wakes the main loop
// again, so "finished" waits for the turn that ends with none at work. An agent inside another
// agent, or one a plugin started, reports elsewhere and never wakes the main loop.
async function agentsAtWork($: EngineInterface) {
  const agents = await $.agent.list().catch(() => [])

  return agents.some(agent => AT_WORK.has(agent.status) && agent.parentId === undefined && agent.spawnedBy === undefined)
}

// The one argument worth showing for a tool: its command, file, pattern or target.
const detailOf = (e: object): string => {
  const args = e as Record<string, unknown>
  const picked =
    args.command ?? args.file_path ?? args.notebook_path ?? args.pattern ??
    args.url ?? args.query ?? args.description ?? args.skill ?? ''
  const text = String(picked).replace(/\s+/g, ' ').trim()
  const short =
    picked === args.file_path || picked === args.notebook_path ? (text.split('/').pop() ?? text) : text

  return short.length > 50 ? `${short.slice(0, 49)}…` : short
}

// Why Claude waits for the person, if it does; whether the band is lit now; the blink's stop;
// the terminal device to colour, once found.
// `painted` is the background the terminal has now (undefined: not known), `painting` the chain
// every write waits its turn on, `ticks` how often the blink has turned.
type Watch = {
  why?: Why
  isLit: boolean
  blink?: { cancel: () => void }
  ticks: number
  // the person's returns and the main loop's new turns, counted
  moves: number
  tty?: string
  herdr?: string
  painted?: boolean
  painting?: Promise<void>
}

// Claude's terminal device: the controlling terminal of the process that runs this module's
// commands (`sh`'s parent). None outside a terminal; the band blinks alone then.
async function ttyOf($: EngineInterface) {
  const ran = await $.process.run(['sh', '-c', 'ps -o tty= -p "$PPID"'], { timeoutMs: 2_000 })
  const name = ran.stdout.trim()

  return ran.exitCode === 0 && TTY.test(name) ? `/dev/${name}` : undefined
}

// Brings the pane's background to what the watch says now. Writes wait in one line and each reads
// the state when its turn comes, so a late write never leaves the pane lit after the band stopped.
// One short write each, so it lands whole between Claude's own frames.
// shortcut: a write landing inside one of Claude's escape sequences garbles a few cells until
// they redraw; move to an engine API if one comes for the terminal's background.
function paint($: EngineInterface, watch: Watch) {
  watch.painting = (watch.painting ?? Promise.resolve())
    .then(async () => {
      const tty = watch.tty
      const isLit = watch.why !== undefined && watch.isLit
      if (tty === undefined || isLit === watch.painted) return

      await $.process.run(['sh', '-c', 'printf "%s" "$1" > "$2"', 'sh', isLit ? PANE_LIT : PANE_PLAIN, tty], { timeoutMs: 2_000 })
      watch.painted = isLit
      // herdr repaints only rows whose text changed, so a new background reaches the other rows
      // only on a full repaint; a config reload makes one (seen on herdr 0.9.5)
      if (watch.herdr !== undefined) await $.process.run([watch.herdr, 'server', 'reload-config'], { timeoutMs: 2_000 })
    })
    .catch(() => undefined)

  return watch.painting
}

function attend($: EngineInterface, watch: Watch, reason: Why) {
  watch.why = reason
  watch.isLit = true
  if (watch.blink === undefined) watch.ticks = 0
  watch.blink ??= $.clock.every(BLINK_MS, () => {
    watch.ticks += 1
    // held still, lit, once it has blinked long enough
    if (watch.ticks * BLINK_MS >= BLINK_FOR_MS) {
      watch.blink?.cancel()
      watch.blink = undefined
      watch.isLit = true
    } else watch.isLit = !watch.isLit
    void paint($, watch)
    $.ui.invalidate('ui.render')
  })
  void paint($, watch)
  $.ui.invalidate('ui.render')
}

function settle($: EngineInterface, watch: Watch) {
  if (watch.why === undefined) return
  watch.why = undefined
  watch.blink?.cancel()
  watch.blink = undefined
  void paint($, watch)
  $.ui.invalidate('ui.render')
}

// Blinks "finished" unless an agent still works, or the person or a new turn came in while
// agent.list answered.
async function finishUnlessMoved($: EngineInterface, watch: Watch) {
  const at = watch.moves
  if (!(await agentsAtWork($)) && at === watch.moves) attend($, watch, 'finished')
}

// The newest call still running, or thinking when none is.
function show($: EngineInterface, running: Map<string, string>) {
  const labels = [...running.values()]
  $.ui.status(labels.length === 0 ? THINKING : `● ${labels[labels.length - 1]}`)
}

export const register: Register = on => {
  // The main loop's tool calls still running, newest last, so parallel calls read right.
  const running = new Map<string, string>()
  let tools = 0
  const watch: Watch = { isLit: false, ticks: 0, moves: 0 }

  // The person is back: typing in the prompt box, sending, or a new turn.
  on('prompt.edit', ($, e, next) => {
    watch.moves += 1
    settle($, watch)

    return next(e)
  })
  on('prompt.submit', ($, e, next) => {
    watch.moves += 1
    settle($, watch)

    return next(e)
  })

  on('classic.Notification', async ($, e, next) => {
    const reason = NOTIFIED[e.notification_type]
    if (reason === 'asking') attend($, watch, reason)
    else if (reason === 'finished') await finishUnlessMoved($, watch)

    return next(e)
  })

  // Finds the terminal, and puts its background back in case an earlier load left it lit.
  on('session.start', async ($, e, next) => {
    watch.tty = e.isInteractive ? await ttyOf($).catch(() => undefined) : undefined
    const [isHerdr, herdrBin] = await Promise.all([$.env.get('HERDR_ENV'), $.env.get('HERDR_BIN_PATH')])
    watch.herdr = isHerdr === '1' ? herdrBin || 'herdr' : undefined
    watch.painted = undefined
    await paint($, watch)

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    settle($, watch)
    await paint($, watch)

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    const why = watch.why
    if (why === undefined || e.props.hasSurvey) return next(e)

    const { Box, Text } = $.ui.resolve(e)

    return watch.isLit ? (
      <Box backgroundColor={GLOW} paddingX={1}>
        <Text color={ON_GLOW} weight="bold">{SAYS[why]}</Text>
      </Box>
    ) : (
      <Box paddingX={1}>
        <Text weight="bold">{SAYS[why]}</Text>
      </Box>
    )
  })

  on('turn.start', ($, e, next) => {
    if (e.agentId === undefined) {
      watch.moves += 1
      settle($, watch)
      running.clear()
      tools = 0
      show($, running)
    }

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined) {
      return next(e)
    }

    const id = e.tool_use_id ?? `${String(e.tool)}-${tools}`
    const detail = detailOf(e)
    tools += 1
    running.set(id, detail === '' ? String(e.tool) : `${String(e.tool)}: ${detail}`)
    show($, running)
    // a question to the person waits inside the call
    if (e.tool === 'AskUserQuestion') attend($, watch, 'asking')

    try {
      return await next(e)
    } finally {
      running.delete(id)
      show($, running)
      // the call is done, so any question or permission prompt in it was answered
      settle($, watch)
    }
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      running.clear()
      // Nothing to say while idle: the band above the prompt has the time and cost.
      $.ui.status(undefined)
      // a turn the person stopped (Esc) needs no call back: they are here
      if (e.isAborted) settle($, watch)
      // An agent still at work leaves the band as it is: a question it asks stays lit.
      else await finishUnlessMoved($, watch)
    }

    return next(e)
  })
}
