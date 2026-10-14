import type { Register } from 'claude-code'

import { item, paneHeader } from './band'
import type { Tone } from './ui'

type Critique = {
  verdict: 'strong' | 'mixed' | 'weak'
  summary: string
  strengths: string[]
  flaws: { issue: string; fix: string }[]
}

const MODELS = ['session', 'opus', 'sonnet', 'haiku'] as const

const PROMPT = (answer: string) =>
  `Critique the assistant reply below. Reply with only JSON: {"verdict":"strong|mixed|weak","summary":"one sentence","strengths":["..."],"flaws":[{"issue":"...","fix":"one-line instruction to repair it"}]}. Be specific; at most 4 strengths and 5 flaws.\n\n<reply>\n${answer.slice(0, 12000)}\n</reply>`

const parse = (text: string): Critique | undefined => {
  try {
    const c = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))
    return Array.isArray(c.flaws) && Array.isArray(c.strengths) ? c : undefined
  } catch {
    return undefined
  }
}

let result: Critique | undefined
let status = 'No critique yet. Run /critique.'
let model: (typeof MODELS)[number] = 'session'
let auto = false
let lastAnswer = ''

const run = async ($: any, answer: string) => {
  if (!answer) {
    status = 'Nothing to critique yet.'
    return
  }
  status = 'Critiquing…'
  $.ui.invalidate('ui.render')
  const m = model === 'session' ? await $.session.model() : model
  const r = await $.model.complete({ model: m, prompt: PROMPT(answer), maxTokens: 1500, timeoutMs: 60_000 })
  result = r.isAnswered ? parse(r.text) : undefined
  status = result ? '' : `Critique failed${r.isAnswered ? ' (unparseable reply)' : `: ${r.reason}`}`
  $.ui.invalidate('ui.render')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'critique', description: 'Critique the last answer: /critique [auto|opus|sonnet|haiku|session]' })
    return next(e)
  })

  on('command.run', { command: 'critique' }, async ($, e) => {
    const arg = (e.args ?? "").trim()
    if (arg === 'auto') {
      auto = !auto
      return { text: `Auto-critique ${auto ? 'on' : 'off'}.` }
    }
    if ((MODELS as readonly string[]).includes(arg)) model = arg as typeof model
    await $.ui.open({ id: 'critique', title: 'Critique' })
    void run($, lastAnswer)
    return { text: `Critiquing with ${model}.` }
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && e.reason === 'answer') {
      lastAnswer = e.answer
      if (auto) {
        await $.ui.open({ id: 'critique', title: 'Critique' })
        void run($, e.answer)
      }
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: 'critique' }, ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const tone: Tone = result?.verdict === 'strong' ? 'ok' : result?.verdict === 'weak' ? 'err' : 'warn'
    const score = result ? { strong: 90, mixed: 55, weak: 20 }[result.verdict] : undefined
    return (
      <Box flexDirection="column" gap={1}>
        {paneHeader(ui, e, { title: 'Critique', sub: status || `${result?.flaws.length ?? 0} flaws · model: ${model}`, pct: score, tone: result ? tone : 'purple' })}
        <Box flexDirection="row" gap={1}>
          <Button key="rerun" label="Rerun" variant="primary" onPress={() => void run($, lastAnswer)} />
          <Button key="auto" label={`Auto ${auto ? 'on' : 'off'}`} onPress={() => { auto = !auto; $.ui.invalidate('ui.render') }} />
          <Button key="model" label={`Model: ${model}`} onPress={() => { model = MODELS[(MODELS.indexOf(model) + 1) % MODELS.length]; $.ui.invalidate('ui.render') }} />
        </Box>
        {result && (
          <>
            {item(ui, e, { key: 'verdict', tone, title: result.summary, chip: result.verdict })}
            {result.strengths.map((s, i) => item(ui, e, { key: `s${i}`, tone: 'ok', title: s }))}
            {result.flaws.map((f, i) => (
              <Box key={`f${i}`} flexDirection="column">
                {item(ui, e, { key: `fc${i}`, tone: 'err', title: f.issue, sub: `fix: ${f.fix}` })}
                <Button key={`fix${i}`} label="Make this fix" onPress={() => void $.prompt.submit({ text: `Fix this issue in your last answer: ${f.issue}. ${f.fix}` })} />
              </Box>
            ))}
          </>
        )}
      </Box>
    )
  })
}
