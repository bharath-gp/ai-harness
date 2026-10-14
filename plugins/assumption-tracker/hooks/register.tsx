import type { Register } from 'claude-code'

import { band, paneHeader } from './band'
import { textCard } from './kit'
import { below, P } from './ui'


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

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || items.length === 0) return next(e)
    const reviewed = items.filter(i => i.verdict).length
    return band($.ui.resolve(e), e, await below(next, e), {
      title: `Claude made ${items.length} assumption${items.length > 1 ? 's' : ''}`,
      tone: 'warn',
      detail: `${reviewed}/${items.length} reviewed`,
      pct: (reviewed / items.length) * 100,
      buttons: [
        { key: 'review', label: 'Review', hotkey: '0', onPress: () => $.ui.open({ id: 'assumptions', title: 'Assumptions', focus: true, closeOnEscape: true }) },
        { key: 'skip', label: 'Dismiss', plain: true, onPress: () => { items = []; redraw($) } },
      ],
    })
  })

  on('ui.render', { component: 'Pane', requestId: 'assumptions' }, ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const wrong = items.filter(i => i.verdict === 'wrong')
    const set = (i: number, v: Item['verdict']) => {
      items = items.map((it, j) => (j === i ? { ...it, verdict: v } : it))
      redraw($)
    }
    const reviewed = items.filter(i => i.verdict).length
    return (
      <Box flexDirection="column" gap={1}>
        {paneHeader(ui, e, { title: 'Assumptions', sub: `${reviewed}/${items.length} reviewed · ${wrong.length} wrong`, pct: items.length ? (reviewed / items.length) * 100 : 0, tone: 'warn' })}
        {items.length === 0 && <Text color="#8b8f98">Nothing to review.</Text>}
        {items.map((it, i) => {
          const color = it.verdict === 'wrong' ? P.err : it.verdict === 'right' ? P.ok : P.warn // yellow until reviewed
          return textCard(ui, {
            key: `r${i}`,
            color,
            text: it.text,
            children: (
              <Box flexDirection="row" gap={1}>
                <Button key={`ok${i}`} label="Right" variant={it.verdict === 'right' ? 'primary' : 'secondary'} onPress={() => set(i, 'right')} />
                <Button key={`no${i}`} label="Wrong" variant={it.verdict === 'wrong' ? 'primary' : 'secondary'} onPress={() => set(i, 'wrong')} />
              </Box>
            ),
          })
        })}
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
