import { expect, test } from 'claude-code/testing'

test('blocks a key in a source file, allows it in .env and clean text', async ($, on) => {
  on('tool.call', { tool: 'Write' }, () => ({ result: {}, text: 'ok' }) as never)

  const bad = await $.tool.call({ tool: 'Write', file_path: 'a.ts', content: 'const k = "AKIAABCDEFGHIJKLMNOP"' })
  expect(bad.deny).toContain('AWS access key')

  const env = await $.tool.call({ tool: 'Write', file_path: '.env', content: 'K=AKIAABCDEFGHIJKLMNOP' })
  expect(env.deny).toBeUndefined()

  const clean = await $.tool.call({ tool: 'Write', file_path: 'a.ts', content: 'const k = process.env.K' })
  expect(clean.deny).toBeUndefined()
})
