import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { isLithuanian, speakable } from './speakable'

const answer = atom({ plugin: 'read-aloud', key: 'answer' } as const, null)
const isSpeaking = atom({ plugin: 'read-aloud', key: 'isSpeaking' } as const, false)

// The utterance under way, if any: calling `stop` ends it.
type Voice = { stop?: () => Promise<void> }

// Starts reading the last answer, or stops the reading under way.
async function toggle($: EngineInterface, voice: Voice): Promise<'started' | 'stopped' | 'nothing'> {
  if (voice.stop !== undefined) {
    await voice.stop()

    return 'stopped'
  }

  const text = await read($, answer)
  if (text === null) return 'nothing'

  // `say` reads standard input, so no length limit and no shell quoting.
  // shortcut: Lithuanian is read by the macOS voice Ona, which must be installed; make the voice an option when someone needs another.
  const argv = isLithuanian(text) ? ['say', '-v', 'Ona'] : ['say']
  const child = $.process.spawn({ argv, input: speakable(text) })
  const ended = async () => {
    if (voice.stop !== stop) return
    voice.stop = undefined
    await update($, isSpeaking, () => false)
  }
  const stop = async () => {
    // Closing the stream is what kills `say`.
    void child.return({ code: null, signal: 'SIGTERM' }).catch(() => {})
    await ended()
  }
  voice.stop = stop
  await update($, isSpeaking, () => true)

  void (async () => {
    try {
      for await (const _piece of child) {
        // `say` writes nothing; the loop ends when it has finished speaking.
      }
    } catch {
      // No `say` on this machine, or it failed: the button goes back to Play.
    }
    await ended()
  })()

  return 'started'
}

export const register: Register = on => {
  const voice: Voice = {}

  on('session.start', async ($, e, next) => {
    // A reload ends the voice but keeps the state: nothing is speaking now.
    await update($, isSpeaking, () => false)
    await $.command.register({
      name: 'read',
      description: 'Reads the last answer out loud; again to stop',
      immediate: true,
    })

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    // The main loop's answers only, not a subagent's report.
    if (e.agentId === undefined && e.reason === 'answer' && e.answer.trim() !== '') {
      await update($, answer, () => e.answer)
    }

    return next(e)
  })

  on('command.run', { command: 'read' }, async $ => {
    const did = await toggle($, voice)
    if (did === 'nothing') return { text: 'There is no answer to read yet.' }

    return { text: did === 'started' ? 'Reading the last answer. /read again to stop.' : 'Stopped reading.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, answer)) === null) {
      return next(e)
    }

    const { Box, Button } = $.ui.resolve(e)
    const speaking = await read($, isSpeaking)

    return (
      <Box>
        <Button key="read" label={speaking ? '■ Stop reading' : '▶ Read aloud'} onPress={() => toggle($, voice)} />
      </Box>
    )
  })
}
