import { expect, test } from 'claude-code/testing'

import { IN_HERDR, herdr, session } from './kit'

const START = { cwd: '/Users/me/lab2', surface: 'terminal', isInteractive: true } as const

test('opens no scout or maker tab, only the column', async ($, on) => {
  const tab = herdr(on)
  session(on, IN_HERDR)

  await $.session.start(START)

  expect(tab.ran.filter(args => args[0] === 'tab' || args[0] === 'agent')).toEqual([])
})

test('a session left over from the removed worker feature (CLAUDE_MODS_ROLE) opens no column', async ($, on) => {
  const tab = herdr(on)
  const seen = session(on, { ...IN_HERDR, CLAUDE_MODS_ROLE: 'scout' })

  await $.session.start(START)

  expect(tab.ran).toEqual([])
  expect(seen.opened).toEqual([])
})
