import { expect, test } from 'claude-code/testing'

const key = 'const k = "AKIAABCDEFGHIJKLMNOP"'

test('secretSentry off lets a key through', { options: { secretSentry: false } }, async ($, on) => {
  on('tool.call', { tool: 'Write' }, () => ({ result: {}, text: 'ok' }) as never)
  const r = await $.tool.call({ tool: 'Write', file_path: 'a.ts', content: key })
  expect(r.deny).toBeUndefined()
})
