import { expect, test } from 'claude-code/testing'

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
