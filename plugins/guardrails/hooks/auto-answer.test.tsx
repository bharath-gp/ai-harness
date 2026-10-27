import { expect, test } from 'claude-code/testing'
import { STRONG, choice, mock } from './dm-mock'

const noul = (v: number) => ({ type: 'noul', noul: v })
const Q = { question: 'Which package manager should I use?', header: 'Pkg manager', multiSelect: false, options: [{ label: 'pnpm', description: 'pnpm-lock.yaml is checked in' }, { label: 'npm', description: '' }, { label: 'yarn', description: '' }] }

// The dialog (core) answers 'dialog'; prompts the band sends land in `sent`.
function setup(on: any, answerable = 0.95, pick = 0.97) {
  const m = mock(on, () => ({ answerable: noul(answerable), pick: choice('a', pick) }))
  const sent: string[] = []
  let dialogs = 0
  on('tool.call', { tool: 'AskUserQuestion' }, () => { dialogs += 1; return { result: { questions: [], answers: {} }, text: 'dialog' } })
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 50_000, window: 200_000 }, rateLimits: [] } }))
  on('prompt.submit', (_$: any, e: any) => { if (e.origin?.kind === 'plugin') sent.push(e.text); return { text: e.text } })
  return { ...m, sent, dialogs: () => dialogs }
}
const ask = ($: any, questions: object[] = [Q]) => $.tool.call({ tool: 'AskUserQuestion', questions, tool_use_id: 'tu1' })
const settle = () => new Promise(res => setTimeout(res, 30))
const above = async ($: any, surface: string) =>
  JSON.stringify(await $.ui.render({ surface, component: 'AbovePrompt', props: { bodyColumns: 80, hasSurvey: false }, viewport: { columns: 80, rows: 30 } }))
const press = async ($: any, key: string) => (await above($, 'terminal'), $.ui.press({ plugin: 'guardrails', surface: 'terminal', component: 'AbovePrompt', key }))

test('a confident answer is returned with a band, no dialog', async ($, on) => {
  const m = setup(on)
  const r = await ask($)
  expect(r.result.answers).toEqual({ [Q.question]: 'pnpm' })
  expect(r.context[0]).toContain('local decision model')
  expect(m.dialogs()).toBe(0)
  expect(m.asked[0].body.state).toMatchObject({ question: Q.question, header: 'Pkg manager' })
  expect(m.asked[0].body.questions.pick.criteria.a).toBe('pnpm: pnpm-lock.yaml is checked in')
  await settle()
  for (const surface of ['terminal', 'desktop']) {
    const tree = await above($, surface)
    expect(tree).toContain('Answered for you')
    expect(tree).toContain('Pkg manager: pnpm')
  }
  expect(m.stats().answers.auto).toBe(1)
  expect(m.stats().recent[0]).toMatchObject({ kind: 'answer', verdict: 'auto' })
})

test('avoided adds the context tokens per auto answer', async ($, on) => {
  const m = setup(on)
  await ask($)
  await ask($)
  await settle()
  expect(m.stats().avoided).toBe(100_000)
})

test('a preference question goes to the dialog', async ($, on) => {
  const m = setup(on, 0.1, 0.3)
  const r = await ask($)
  expect(r.text).toBe('dialog')
  expect(m.asked.map(a => a.model).at(-1)).toBe(STRONG) // escalated before giving up
  await settle()
  expect(m.stats().answers).toMatchObject({ auto: 0, asked: 1 })
  expect(await above($, 'terminal')).not.toContain('Answered for you')
})

test('multiSelect and free-text questions are not answered', async ($, on) => {
  const m = setup(on)
  expect((await ask($, [{ ...Q, multiSelect: true }])).text).toBe('dialog')
  expect((await ask($, [{ ...Q, kind: 'text', options: [] }])).text).toBe('dialog')
  expect(m.asked).toEqual([])
})

test('Override picks another option as the user', async ($, on) => {
  const m = setup(on)
  await ask($)
  await settle()
  await press($, 'override')
  for (const surface of ['terminal', 'desktop']) {
    const tree = JSON.stringify(await ($ as any).ui.render({ surface, component: 'AbovePrompt', props: { bodyColumns: 80, hasSurvey: false }, viewport: { columns: 80, rows: 30 } }))
    expect(tree).toContain('npm')
    expect(tree).toContain('Ask me instead')
  }
  await press($, 'o0')
  expect(m.sent).toEqual([`About your question "${Q.question}": I choose "npm" instead of "pnpm".`])
  expect(await above($, 'terminal')).not.toContain('Answered for you')
})

test('Ask me instead asks Claude to put the questions to the user', async ($, on) => {
  const m = setup(on)
  await ask($)
  await settle()
  await press($, 'override')
  await press($, 'again')
  expect(m.sent[0]).toContain('Ask me instead')
})

test('autoAnswer off leaves the dialog alone', { options: { autoAnswer: false } }, async ($, on) => {
  const m = setup(on)
  expect((await ask($)).text).toBe('dialog')
  expect(m.asked).toEqual([])
})

test('a confirmation of a risky step goes to the dialog', async ($, on) => {
  const m = setup(on)
  const r = await ask($, [{ ...Q, question: 'Ready to proceed?', options: [{ label: 'Push to main', description: '' }, { label: 'Wait', description: '' }] }])
  expect(r.text).toBe('dialog')
  expect(m.asked).toEqual([])
})
