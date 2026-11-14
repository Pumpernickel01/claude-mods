import { expect, mock, test } from 'claude-code/testing'

test('says what runs now, and clears when the turn ends', async ($, on) => {
  const clock = mock.clock(on)
  const lines: (string | undefined)[] = []
  on('ui.status', (_$, e) => {
    lines.push(e.text)

    return { value: undefined }
  })
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', async () => {
    await clock.sleep(100)

    return { result: { stdout: '', stderr: '', interrupted: false } }
  })

  await $.turn.start({ text: 'check the pods', turnId: 't1' })
  const ran = $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'kubectl get pods -A' })
  await clock.settle()
  expect(lines.at(-1)).toBe('● Bash: kubectl get pods -A')

  await clock.advance(100)
  await ran
  expect(lines.at(-1)).toBe('● thinking…')

  await $.turn.complete({ turnId: 't1', answer: 'done', durationMs: 42_400, isAborted: false, reason: 'answer' })
  expect(lines.at(-1)).toBeUndefined()
  expect(lines).toHaveLength(4)
})

test('leaves a subagent\'s tool calls out', async ($, on) => {
  const lines: (string | undefined)[] = []
  on('ui.status', (_$, e) => {
    lines.push(e.text)

    return { value: undefined }
  })
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false } }))

  // A subagent's call, as the engine raises it with the loop's id beside the tool's arguments.
  const fromSubagent = { tool: 'Bash', tool_use_id: 'b2', command: 'ls', agentId: 'helper' } as const
  await $.tool.call(fromSubagent)

  expect(lines).toEqual([])
})
