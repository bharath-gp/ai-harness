import { expect, test } from 'claude-code/testing'

const line = (id: string, n: number) => JSON.stringify({ message: { id, usage: { input_tokens: n, output_tokens: n, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } })

test('token meter sums past sessions once per message id and shows the session total', async ($, on) => {
  on('session.start', () => ({ cwd: '/a/b' }) as never)
  on('session.model', () => ({ value: 'sonnet' }) as never)
  on('clock.now', () => ({ value: 1 }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('clock.every', () => ({ value: undefined }) as never)
  on('session.cwd', () => ({ value: '/a/b' }) as never)
  on('env.get', (_$: any, e: any) => ({ value: e.name === 'HOME' ? '/home' : undefined }) as never)
  on('session.usage', () => ({ value: { context: { percent: 1, tokens: 1, window: 10 }, rateLimits: [], cost: { usd: 1.5 } } }) as never)
  on('fs.exists', () => ({ value: true }) as never)
  on('fs.list', () => ({ value: [{ name: 's.jsonl', kind: 'file', size: 1, mtimeMs: 1, isLink: false }] }) as never)
  on('fs.read', () => ({ value: [line('m1', 100), line('m1', 100), line('m2', 50)].join('\n') }) as never)
  await ($.session as any).start({ cwd: '/a/b' })
  await new Promise(r => setTimeout(r, 20))
  const out = JSON.stringify(await $.ui.render({ surface: 'terminal', component: 'AbovePrompt', props: { bodyColumns: 80, hasSurvey: false }, viewport: { columns: 80, rows: 30 } } as never))
  expect(out).toContain('0 tok')
})
