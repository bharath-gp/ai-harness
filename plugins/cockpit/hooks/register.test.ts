import { expect, test } from 'claude-code/testing'

test('cacheKeeper off leaves /keepwarm unhandled', { options: { cacheKeeper: false } }, async ($, on) => {
  on('command.run', () => ({ text: 'engine' }) as never)
  const r = await ($.command as any).run({ command: 'keepwarm', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  expect(r.text).toBe('engine')
})

test('cockpitPane opens the pane for /cockpit', async ($, on) => {
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  const r = await ($.command as any).run({ command: 'cockpit', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  expect(r.text).toBe('Cockpit pane opened.')
})

test('cockpitPane off leaves /cockpit unhandled', { options: { cockpitPane: false } }, async ($, on) => {
  on('command.run', () => ({ text: 'engine' }) as never)
  const r = await ($.command as any).run({ command: 'cockpit', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  expect(r.text).toBe('engine')
})
