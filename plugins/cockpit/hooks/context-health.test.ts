import { expect, mock, test } from 'claude-code/testing'

test('tool.call refresh is throttled to once per 2s', async ($, on) => {
  let calls = 0
  on('session.usage', () => {
    calls++
    return { value: { context: { percent: 10, tokens: 1, window: 10 }, rateLimits: [] } } as never
  })
  let t = 1_000_000
  on('clock.now', () => ({ value: t }) as never)
  on('tool.call', () => ({ result: {} }) as never)
  const fire =() => ($.tool as any).call({ toolName: 'Read', input: {} })
  await fire()
  await fire()
  expect(calls).toBe(1)
  t += 2001
  await fire()
  expect(calls).toBe(2)
})

test('handoff turn that wrote no file does not clear the context', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  let cleared = false
  on('session.usage', () => ({ value: { context: { percent: 10, tokens: 1, window: 10 }, rateLimits: [] } }) as never)
  on('prompt.submit', (_$: any, e: any) => ({ text: e.text }) as never)
  on('turn.complete', () => ({ text: '' }) as never)
  on('command.run', { command: 'clear' }, () => { cleared = true; return { text: '' } as never })
  on('fs.exists', () => ({ value: false }) as never)
  await ($.command as any).run({ command: 'ctx-handoff', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  await clock.advance(1)
  await ($.turn as any).complete({ reason: 'answer', answer: 'handoff written' })
  expect(cleared).toBe(false)
})
