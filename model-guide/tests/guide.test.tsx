import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  plugin: 'model-guide',
  surface: 'terminal',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 9 }, view: {} },
} as const

test('one line names the four models; a click opens the full list and another folds it', async ($, on) => {
  mock.store(on)
  const ui = await $.ui.mount(BAND)

  expect((await ui.find({ key: 'models' }))?.text).toBe('Fable planning · Opus review, debugging · Sonnet coding · Haiku searching')

  await ui.press({ key: 'models' })
  expect(await ui.find({ key: 'models' })).toBeUndefined()
  expect((await ui.find({ key: 'Opus 5.5' }))?.text).toBe('Opus 5.5 / review, debugging, security')
  expect((await ui.find({ key: 'Haiku 5.5' }))?.text).toBe('Haiku 5.5 / searching, quick lookups')

  await ui.press({ key: 'Fable 5.2' })
  expect(await ui.find({ key: 'models' })).toBeDefined()
})

test('the list is still open in the next session', async ($, on) => {
  mock.store(on, { open: true })
  const ui = await $.ui.mount(BAND)

  expect(await ui.find({ key: 'Sonnet 5.5' })).toBeDefined()
})

test('gives way to a survey', async ($, on) => {
  mock.store(on)
  on('ui.render', () => ({ type: 'Text', children: ['the survey'] }))
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, hasSurvey: true } })

  expect(await ui.find({ key: 'models' })).toBeUndefined()
})
