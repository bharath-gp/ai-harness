import { band } from './band'
import { below } from './ui'


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

let steps: string[] = []

export function nextStepsPromptSubmit($: any, e: any, next: any) {
  steps = []
  $.ui.invalidate('ui.render')
  return next(e)
}

export async function nextStepsTurnComplete($: any, e: any, next: any) {
  if (e.agentId === undefined && e.reason === 'answer') {
    void $.model
      .complete({ model: 'haiku', prompt: PROMPT(e.answer), maxTokens: 200, effort: 'low', timeoutMs: 15_000 })
      .then(r => {
        steps = r.isAnswered ? parse(r.text) : []
        $.ui.invalidate('ui.render')
      })
  }
  return next(e)
}

export async function nextStepsUiRenderAbovePrompt($: any, e: any, next: any) {
  if (e.props.hasSurvey || steps.length === 0) return next(e)
  return band($.ui.resolve(e), e, await below(next, e), {
    title: 'Next steps',
    tone: 'info',
    detail: 'click one to put it in the prompt',
    rows: steps.map((s, i) => ({ key: `s${i}`, label: s, hotkey: String(i + 1), onPress: () => $.prompt.fill({ text: s }) })),
    buttons: [{ key: 'x', label: 'Dismiss', plain: true, onPress: () => { steps = []; $.ui.invalidate('ui.render') } }],
  })
}
