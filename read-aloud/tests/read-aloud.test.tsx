import { expect, test } from 'claude-code/testing'

import { isLithuanian, speakable } from '../hooks/speakable'

const BAND = {
  plugin: 'read-aloud',
  surface: 'terminal',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 9 }, view: {} },
} as const

const turn = (answer: string, agentId?: string) =>
  ({ turnId: 't1', answer, durationMs: 1, isAborted: false, reason: 'answer', ...(agentId ? { agentId } : {}) }) as const

test('markdown is read as plain sentences', () => {
  const said = speakable('## Done\n\n- Fixed **the bug** in `~/src/a.ts`\n\n| Piece | Count | Where |\n|---|---|---|\n| **Skills** | 3 | `skills/` |\n\n```ts\nlet x = 1\n```\nSee [docs](https://x.y).')

  expect(said).toBe('Done.\nFixed the bug in home folder, src slash a.ts.\nSkills.\nCount: 3.\nWhere: skills.\nCode block skipped.\nSee docs.')
})

test('play reads the last main answer with say, stop ends it', async ($, on) => {
  const spoken: (string | undefined)[] = []
  on('turn.complete', () => ({ text: '' }))
  let killed = 0
  on('process.spawn', async function* (_$, e, next) {
    spoken.push(`${e.argv.join(' ')}: ${e.input}`)
    // Speaking until the engine kills the child.
    await new Promise<void>(done => next.signal.addEventListener('abort', () => done()))
    killed += 1

    return { value: { code: 0, signal: null } }
  })

  // Nothing answered yet: no row.
  let ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Button' })).toBeUndefined()
  await ui.unmount()

  await $.turn.complete(turn('**Hello** there'))
  await $.turn.complete(turn('a subagent report', 'agent-1'))

  ui = await $.ui.mount(BAND)
  expect((await ui.find({ type: 'Button' }))?.text).toBe('▶ Read aloud')
  await ui.press({ key: 'read' })
  expect(spoken).toEqual(['say: Hello there'])
  expect((await ui.find({ type: 'Button' }))?.text).toBe('■ Stop reading')

  await ui.press({ key: 'read' })
  expect((await ui.find({ type: 'Button' }))?.text).toBe('▶ Read aloud')
  expect(killed).toBe(1)
  await ui.unmount()
})

test('a Lithuanian answer is read by the Lithuanian voice, in Lithuanian words', async ($, on) => {
  const spoken: string[] = []
  on('turn.complete', () => ({ text: '' }))
  on('process.spawn', async function* (_$, e, next) {
    spoken.push(`${e.argv.join(' ')}: ${e.input}`)
    await new Promise<void>(done => next.signal.addEventListener('abort', () => done()))

    return { value: { code: 0, signal: null } }
  })

  await $.turn.complete(turn('**Štai atsakymas:** užduotis įvykdyta.\n\n```sh\nls\n```'))
  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'read' })
  expect(spoken).toEqual(['say -v Ona: Štai atsakymas: užduotis įvykdyta.\nKodo blokas praleistas.'])

  await ui.press({ key: 'read' })
  await ui.unmount()
})

test('an English answer that names a Lithuanian folder stays English', () => {
  const path = '/Users/me/Studijos/Trečias semestras/Tinklų infrastruktūros sauga Vardenis Pavardėnas/lab2'

  expect(isLithuanian(`The report is in \`${path}\`. Nothing else changed.`)).toBe(false)
  expect(isLithuanian(`The report is in ${path} and nothing else changed in this lab today.`)).toBe(false)
  expect(isLithuanian('Ataskaita paruošta. Liko įkelti failą į Moodle ir patikrinti šaltinių sąrašą.')).toBe(true)
})
