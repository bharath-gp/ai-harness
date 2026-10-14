import type { Register } from 'claude-code'

const PROMPT = (answer: string) =>
  `Given the assistant's last reply below, suggest exactly 3 short, concrete next prompts the user would plausibly send next (max 12 words each, imperative). Reply with only a JSON array of 3 strings.\n\n<reply>\n${answer.slice(0, 6000)}\n</reply>`

const parse = (text: string): string[] => {
  try {
    const arr = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1))
    return Array.isArray(arr) ? arr.filter((s): s is string => typeof s === 'string').slice(0, 3) : []
  } catch {
    return []
  }
}

export const register: Register = on => {
  let steps: string[] = []

  on('prompt.submit', ($, e, next) => {
    steps = []
    $.ui.invalidate('ui.render')
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && e.reason === 'answer') {
      void $.model
        .complete({ model: 'haiku', prompt: PROMPT(e.answer), maxTokens: 200, effort: 'low', timeoutMs: 15_000 })
        .then(r => {
          steps = r.isAnswered ? parse(r.text) : []
          $.ui.invalidate('ui.render')
        })
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    if (e.props.hasSurvey || steps.length === 0) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Text dimColor>Next:</Text>
        {steps.map((s, i) => (
          <Button key={`s${i}`} plain hotkey={String(i + 1)} onPress={() => $.prompt.fill({ text: s })}>
            {s}
          </Button>
        ))}
        <Button key="x" plain dimColor label="dismiss" onPress={() => { steps = []; $.ui.invalidate('ui.render') }} />
      </Box>
    )
  })
}
