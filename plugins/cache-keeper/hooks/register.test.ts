import { expect, mock, test } from 'claude-code/testing'

test('keepwarm answers', async ($, on) => {
  mock.clock(on)
  const r = await ($.command as any).run({ command: 'keepwarm', args: '' , origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  expect(r.text).toBeDefined()
})
