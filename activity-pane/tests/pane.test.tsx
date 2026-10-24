import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'activity-pane',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'activity',
  props: {
    title: 'Activity',
    isFocused: false,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

test('lists each tool call as it runs, then its outcome and duration', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  on('tool.call', async (_$, e) => {
    await clock.sleep(1_500)

    return e.tool === 'Bash'
      ? { deny: 'not in this lab' }
      : { result: { type: 'text', file: { filePath: '/lab2/notes.md', content: '', numLines: 0, startLine: 1, totalLines: 0 } } }
  })

  const pending = Promise.all([
    $.tool.call({ tool: 'Read', tool_use_id: 'r1', file_path: '/lab2/notes.md' }),
    $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'kubectl get pods' }),
  ])
  await clock.settle()

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /^…$/ })).toBeDefined()

  await clock.advance(1_500)
  await pending

  expect(await ui.find({ type: 'Text', text: '2 tool calls' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^✓ Read 1\.5s notes\.md$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^⊘ Bash 1\.5s kubectl get pods$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^…$/ })).toBeUndefined()
})
