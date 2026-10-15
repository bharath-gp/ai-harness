import { expect, test } from 'claude-code/testing'

const render = ($: any, surface: string, component: string, requestId?: string) =>
  $.ui.render({ surface, component, requestId, props: { bodyColumns: 80, hasSurvey: false }, viewport: { columns: 80, rows: 30 } })
const usage = { value: { context: { percent: 42, tokens: 84000, window: 200000 }, rateLimits: [{ kind: 'five_hour', percentUsed: 12 }] } } as never

test('context-health band shows fill and rate limits', async ($, on) => {
  on('session.usage', () => usage)
  on('clock.now', () => ({ value: 1_000_000 }) as never)
  on('prompt.submit', () => ({ text: 'hi' }) as never)
  await ($ as any).prompt.submit({ text: 'hi', wait: false, origin: { kind: 'composer' } })
  for (const surface of ['terminal', 'desktop']) expect(JSON.stringify(await render($, surface, 'AbovePrompt'))).toContain('Context 42%')
})

test('next-steps band shows suggestions after a turn', async ($, on) => {
  on('session.model', () => ({ value: 'claude-sonnet-5-5' }) as never)
  on('model.complete', () => ({ value: { isAnswered: true, text: '["Run the tests","Open a PR"]', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }) as never)
  on('session.usage', () => usage)
  on('clock.now', () => ({ value: 1_000_000 }) as never)
  on('turn.complete', () => ({ text: '' }) as never)
  await ($ as any).turn.complete({ answer: 'done', reason: 'answer', durationMs: 1, turnId: 't', isAborted: false })
  await new Promise(r => setTimeout(r, 50))
  for (const surface of ['terminal', 'desktop']) expect(JSON.stringify(await render($, surface, 'AbovePrompt'))).toContain('Run the tests')
})

test('filetree pane draws', async ($, on) => {
  on('session.cwd', () => ({ value: '/tmp/x' }) as never)
  on('fs.list', () => ({ value: [{ name: 'src', kind: 'dir', size: 0, mtimeMs: 0 }, { name: 'a.ts', kind: 'file', size: 1, mtimeMs: 0 }] }) as never)
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }) as never)
  on('clock.now', () => ({ value: 1_000_000 }) as never)
  on('session.usage', () => usage)
  on('session.model', () => ({ value: 'claude-sonnet-5-5' }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', () => ({ cwd: '/tmp/x' }) as never)
  await ($ as any).session.start({ cwd: '/tmp/x' })
  await new Promise(r => setTimeout(r, 50))
  for (const surface of ['terminal', 'desktop']) expect(JSON.stringify(await render($, surface, 'Pane', 'filetree'))).toContain('a.ts')
})

test('context-health band shows turn, cost and dismiss', async ($, on) => {
  let usd = 1
  on('session.usage', () => ({ value: { context: { percent: 42, tokens: 84000, window: 200000 }, rateLimits: [], cost: { usd } } }) as never)
  on('clock.now', () => ({ value: 1_000_000 }) as never)
  on('turn.start', () => ({ turnId: 't' }) as never)
  on('prompt.submit', () => ({ text: 'hi' }) as never)
  await ($ as any).turn.start({ turnId: 't' })
  usd = 1.5
  await ($ as any).prompt.submit({ text: 'hi', wait: false, origin: { kind: 'composer' } })
  const out = JSON.stringify(await render($, 'terminal', 'AbovePrompt'))
  expect(out).toContain('turn 1')
  expect(out).toContain('×')
})
