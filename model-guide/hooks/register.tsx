import type { Register } from 'claude-code'

// Which model for which work, and the effort rule, from "Models and effort" in ~/.claude/CLAUDE.md: name, short, full.
const MODELS = [
  ['Fable 5.2', 'planning', 'planning'],
  ['Opus 5.5', 'review, debugging', 'review, debugging, security'],
  ['Sonnet 5.5', 'coding', 'coding, web research'],
  ['Haiku 5.5', 'searching', 'searching, quick lookups'],
  ['Effort', 'high, xhigh when hard', 'high by default; /effort xhigh for a hard bug, a design decision or a security review'],
] as const

export const register: Register = on => {
  // The reminder sits last, right above the prompt, under every other mod's row.
  on('ui.render', { component: 'AbovePromptList' }, ($, e, next) => {
    const mine = e.props.rows.filter(row => row.plugin === 'model-guide')
    const rest = e.props.rows.filter(row => row.plugin !== 'model-guide')

    return next({ ...e, props: { ...e.props, rows: [...rest, ...mine] } })
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    const { Box, Button, Text } = $.ui.resolve(e)
    const isOpen = (await $.store.get('open')) === true
    // Kept across sessions, so the list stays the way it was left.
    const toggle = async () => {
      await $.store.set('open', !isOpen)
      $.ui.invalidate('ui.render')
    }

    if (!isOpen) {
      return (
        <Button key="models" plain onPress={toggle}>
          {MODELS.map(([name, short], i) => (
            <Text key={name}>
              {i > 0 && <Text dimColor> · </Text>}
              <Text weight="bold">{name.split(' ')[0]}</Text>
              <Text dimColor> {short}</Text>
            </Text>
          ))}
        </Button>
      )
    }

    return (
      <Box flexDirection="column">
        {MODELS.map(([name, , full]) => (
          <Button key={name} plain onPress={toggle}>
            <Text weight="bold">{name}</Text>
            <Text dimColor> / {full}</Text>
          </Button>
        ))}
      </Box>
    )
  })
}
