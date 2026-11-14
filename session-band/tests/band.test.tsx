import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  plugin: 'session-band',
  surface: 'terminal',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 9 },
    view: {},
  },
} as const

test('draws no row while nothing plays: the folder, time, context and cost live elsewhere', async ($, on) => {
  on('ui.render', () => ({ type: 'Text', children: ['the row below'] }))

  const ui = await $.ui.mount(BAND)

  expect(await ui.find({ type: 'Text', text: 'the row below' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /context|min/ })).toBeUndefined()
})

test('gives way to a survey', async ($, on) => {
  on('ui.render', () => ({ type: 'Text', children: ['the survey'] }))

  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, hasSurvey: true } })

  expect(await ui.find({ type: 'Text', text: 'the survey' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'lab2' })).toBeUndefined()
})
