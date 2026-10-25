import { expect, mock, test } from 'claude-code/testing'

// Behaviour every cockpit mod must keep through a redesign: commands, toasts, tracking and the actions behind buttons.
const usage = (percent = 10, rateLimits: unknown[] = []) =>
  ({ value: { context: { percent, tokens: 100_000, window: 200_000 }, rateLimits, cost: { usd: 1 } } }) as never
const run = ($: any, command: string, args?: string) =>
  $.command.run({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
const above = async ($: any, surface = 'terminal') =>
  JSON.stringify(await $.ui.render({ surface, component: 'AbovePrompt', props: { bodyColumns: 80, hasSurvey: false }, viewport: { columns: 80, rows: 30 } }))
const settle = (ms = 30) => new Promise(r => setTimeout(r, ms))

test('/cache-tax reports cache state and the cold-send cost', async ($, on) => {
  on('session.usage', () => usage())
  on('session.model', () => ({ value: 'claude-sonnet-5-5' }) as never)
  on('clock.now', () => ({ value: 1_000_000 }) as never)
  const r = await run($, 'cache-tax')
  expect(r.text).toContain('cold send')
  expect(r.text).toContain('100000 tok')
})

test('/keepwarm arms, reports, stops and rejects bad input', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  expect((await run($, 'keepwarm', '90m')).text).toContain('armed for 90m')
  expect((await run($, 'keepwarm', 'status')).text).toContain('armed')
  expect((await run($, 'keepwarm', 'off')).text).toBe('keepwarm off.')
  expect((await run($, 'keepwarm', 'soon')).text).toContain('Usage')
})

test('/autohandoff sets and clears the threshold', async ($, on) => {
  expect((await run($, 'autohandoff', '70')).text).toBe('Auto handoff at 70% context.')
  expect((await run($, 'autohandoff', 'off')).text).toBe('Auto handoff off.')
})

test('usage-limits toasts once when a window passes 90%', async ($, on) => {
  const toasts: string[] = []
  on('ui.toast', (_$: any, e: any) => { toasts.push(e.text ?? e.message ?? String(e)); return { value: undefined } as never })
  on('clock.now', () => ({ value: Date.parse('2030-01-01T03:00:00Z') }) as never)
  on('session.measure', () => ({ changed: ['rateLimits'] }) as never)
  const rl = [{ kind: 'five_hour', percentUsed: 92, resetsAt: '2030-01-01T05:00:00Z' }]
  await ($ as any).session.measure({ context: { percent: 1, tokens: 1, window: 10 }, rateLimits: rl, changed: ['rateLimits'] })
  await ($ as any).session.measure({ context: { percent: 1, tokens: 1, window: 10 }, rateLimits: rl, changed: ['rateLimits'] })
  expect(toasts.length).toBe(1)
  expect(await above($)).toContain('Usage limits')
})

test('high context draws the handoff band', async ($, on) => {
  on('session.usage', () => usage(72))
  on('clock.now', () => ({ value: 1_000_000 }) as never)
  on('prompt.submit', () => ({ text: 'hi' }) as never)
  await ($ as any).prompt.submit({ text: 'hi', wait: false, origin: { kind: 'composer' } })
  const out = await above($)
  expect(out).toContain('Context 72%')
  expect(out).toContain('Handoff')
})

test('filetree tracks files Claude reads', async ($, on) => {
  on('session.cwd', () => ({ value: '/tmp/x' }) as never)
  on('fs.list', () => ({ value: [{ name: 'a.ts', kind: 'file', size: 1, mtimeMs: 0 }] }) as never)
  on('fs.stat', () => ({ value: { kind: 'file', size: 1, mtimeMs: 0 } }) as never)
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }) as never)
  on('clock.now', () => ({ value: 1_000_000 }) as never)
  on('session.usage', () => usage())
  on('session.model', () => ({ value: 'claude-sonnet-5-5' }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('ui.panes', () => ({ value: [] }) as never)
  on('session.start', () => ({ cwd: '/tmp/x' }) as never)
  on('tool.call', { tool: 'Read' }, () => ({ result: {} }) as never)
  await ($ as any).session.start({ cwd: '/tmp/x' })
  await ($ as any).tool.call({ tool: 'Read', file_path: '/tmp/x/a.ts' })
  await settle()
  expect(await above($)).toContain('1 file')
})

test('next-steps clear when a new prompt is sent', async ($, on) => {
  on('session.model', () => ({ value: 'claude-sonnet-5-5' }) as never)
  on('model.complete', () => ({ value: { isAnswered: true, text: '["Run the tests"]', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }) as never)
  on('session.usage', () => usage())
  on('clock.now', () => ({ value: 1_000_000 }) as never)
  on('turn.complete', () => ({ text: '' }) as never)
  on('prompt.submit', () => ({ text: 'hi' }) as never)
  await ($ as any).turn.complete({ answer: 'done', reason: 'answer', durationMs: 1, turnId: 't', isAborted: false })
  await settle()
  expect(await above($)).toContain('Run the tests')
  await ($ as any).prompt.submit({ text: 'next', wait: false, origin: { kind: 'composer' } })
  expect(await above($)).not.toContain('Run the tests')
})
