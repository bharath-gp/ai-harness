import { expect, test } from 'claude-code/testing'

test('lets safe commands through', async ($, on) => {
  on('tool.call', { tool: 'Bash' }, () => ({ result: {}, text: 'ran' }) as never)
  const r = await $.tool.call({ tool: 'Bash', command: 'git status' })
  expect(r.deny).toBeUndefined()
})
