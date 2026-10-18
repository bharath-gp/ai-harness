import { expect, test } from 'claude-code/testing'

const rl = [
  { kind: 'five_hour', percentUsed: 42, resetsAt: '2030-01-01T05:00:00Z' },
  { kind: 'seven_day', percentUsed: 18, resetsAt: '2030-01-04T04:00:00Z' },
]

test('calm usage limits show as short percentages', async ($, on) => {
  on('clock.now', () => ({ value: Date.parse('2030-01-01T03:00:00Z') }) as never)
  on('session.measure', () => ({ changed: ['rateLimits'] }) as never)
  await ($ as any).session.measure({ context: { percent: 1, tokens: 1, window: 10 }, rateLimits: rl, changed: ['rateLimits'] })
  for (const surface of ['terminal', 'desktop']) {
    const out = JSON.stringify(await $.ui.render({ surface, component: 'AbovePrompt', props: { bodyColumns: 80, hasSurvey: false }, viewport: { columns: 80, rows: 30 } } as never))
    expect(out).toContain('5h 42%')
    expect(out).toContain('7d 18%')
  }
})
