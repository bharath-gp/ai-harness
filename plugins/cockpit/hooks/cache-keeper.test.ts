import { expect, mock, test } from 'claude-code/testing'

test('keepwarm answers', async ($, on) => {
  mock.clock(on)
  const r = await ($.command as any).run({ command: 'keepwarm', args: '' , origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  expect(r.text).toBeDefined()
})

// A cold cache asks instead of blocking: "Continue here" lets the prompt through, "New session" clears and drops it.
let clock: any
let asked = 0
async function coldSend(answer: string, $: any, on: any) {
  clock = mock.clock(on, { now: 1_000_000 }) // lastTouch 0 means "never touched"
  on('session.usage', () => ({ value: { context: { percent: 40, tokens: 80_000, window: 200_000 }, rateLimits: [] } }) as never)
  on('session.model', () => ({ value: 'claude-sonnet-5-5' }) as never)
  on('turn.complete', () => ({ text: '' }) as never)
  on('model.complete', () => ({ value: { isAnswered: false, reason: 'test' } }) as never)
  on('prompt.submit', (_$: any, e: any) => ({ text: e.text }) as never)
  on('tool.call', { tool: 'AskUserQuestion' }, (_$: any, e: any) => (asked++, { result: { questions: e.questions, answers: { [e.questions[0].question]: answer } }, text: answer }) as never)
  await $.turn.complete({ reason: 'answer', answer: 'hi' }) // touches the cache
  await clock.advance(61 * 60_000)
  return $.prompt.submit({ text: 'next', origin: { kind: 'composer' } })
}

test('cold cache + "New session" drops the prompt', async ($, on) => {
  let cleared = false
  on('command.run', { command: 'clear' }, () => { cleared = true; return { text: '' } as never })
  const r = await coldSend('New session', $, on)
  expect(r.drop).toContain('new session')
  await clock.advance(1)
  expect(cleared).toBe(true)
})

test('cold cache + "Continue here" sends the prompt', async ($, on) => {
  const r = await coldSend('Continue here', $, on)
  expect(asked).toBeGreaterThan(0)
  expect(r.drop).toBeUndefined()
})
