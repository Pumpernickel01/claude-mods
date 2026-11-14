import type { EngineInterface, Register } from 'claude-code'

const THINKING = '● thinking…'

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

// The newest call still running, or thinking when none is.
function show($: EngineInterface, running: Map<string, string>) {
  const labels = [...running.values()]
  $.ui.status(labels.length === 0 ? THINKING : `● ${labels[labels.length - 1]}`)
}

export const register: Register = on => {
  // The main loop's tool calls still running, newest last, so parallel calls read right.
  const running = new Map<string, string>()
  let tools = 0

  on('turn.start', ($, e, next) => {
    if (e.agentId === undefined) {
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

    try {
      return await next(e)
    } finally {
      running.delete(id)
      show($, running)
    }
  })

  on('turn.complete', ($, e, next) => {
    if (e.agentId === undefined) {
      running.clear()
      // Nothing to say while idle: the band above the prompt has the time and cost.
      $.ui.status(undefined)
    }

    return next(e)
  })
}
