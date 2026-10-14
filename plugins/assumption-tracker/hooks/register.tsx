import type { Register } from 'claude-code'

type Item = { text: string; verdict: 'right' | 'wrong' | undefined }

const PROMPT = (task: string, answer: string) =>
  `List the assumptions the assistant made that the user did not explicitly specify (defaults chosen, ambiguities resolved silently, scope decisions). Max 8, one short sentence each. Reply with only a JSON array of strings, [] if none.\n\n<user_request>\n${task.slice(0, 2000)}\n</user_request>\n<assistant_reply>\n${answer.slice(0, 6000)}\n</assistant_reply>`

const parse = (text: string): string[] => {
  try {
    const arr = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1))
    return Array.isArray(arr) ? arr.filter((s): s is string => typeof s === 'string').slice(0, 8) : []
  } catch {
    return []
  }
}

let items: Item[] = []
let task = ''

const redraw = ($: any) => $.ui.invalidate('ui.render')

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'assumptions', description: 'Review the assumptions Claude made last turn' })
    return next(e)
  })

  on('command.run', { command: 'assumptions' }, async $ => {
    if (items.length === 0) return { text: 'No assumptions recorded for the last turn.' }
    await $.ui.open({ id: 'assumptions', title: 'Assumptions', focus: true, closeOnEscape: true })
    return { text: 'Assumptions opened.' }
  })

  on('prompt.submit', ($, e, next) => {
    if (e.origin.kind !== 'plugin') task = e.text // fix prompts we send must not overwrite the task
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && e.reason === 'answer' && task) {
      void $.model
        .complete({ model: 'haiku', prompt: PROMPT(task, e.answer), maxTokens: 600, effort: 'low', timeoutMs: 20_000 })
        .then(r => {
          items = r.isAnswered ? parse(r.text).map(text => ({ text, verdict: undefined })) : []
          redraw($)
        })
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    if (e.props.hasSurvey || items.length === 0) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    return (
      <Box>
        <Text color="warning">Claude made {items.length} assumption{items.length > 1 ? 's' : ''} </Text>
        <Button key="review" label="Review" hotkey="0" onPress={() => $.ui.open({ id: 'assumptions', title: 'Assumptions', focus: true, closeOnEscape: true })} />
        <Button key="skip" plain dimColor label=" dismiss" onPress={() => { items = []; redraw($) }} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: 'assumptions' }, ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const wrong = items.filter(i => i.verdict === 'wrong')
    const set = (i: number, v: Item['verdict']) => {
      items = items.map((it, j) => (j === i ? { ...it, verdict: v } : it))
      redraw($)
    }
    return (
      <Box flexDirection="column">
        {items.length === 0 && <Text dimColor>Nothing to review.</Text>}
        {items.map((it, i) => (
          <Box key={`r${i}`} flexDirection="column" marginBottom={1}>
            <Text color={it.verdict === 'wrong' ? 'error' : it.verdict === 'right' ? 'success' : undefined}>{i + 1}. {it.text}</Text>
            <Box gap={1}>
              <Button key={`ok${i}`} label="Right" onPress={() => set(i, 'right')} />
              <Button key={`no${i}`} label="Wrong" onPress={() => set(i, 'wrong')} />
            </Box>
          </Box>
        ))}
        {wrong.length > 0 && (
          <Button
            key="send"
            variant="primary"
            label={`Fix ${wrong.length} wrong`}
            onPress={async () => {
              const keep = items.filter(i => i.verdict === 'right').map(i => `- ${i.text}`)
              const text =
                `These assumptions you made were wrong. Fix only the parts that depend on them:\n${wrong.map(i => `- ${i.text}`).join('\n')}` +
                (keep.length ? `\n\nThese were right, keep them:\n${keep.join('\n')}` : '')
              items = []
              await $.ui.close({ id: 'assumptions' })
              void $.prompt.submit({ text })
            }}
          />
        )}
      </Box>
    )
  })
}
