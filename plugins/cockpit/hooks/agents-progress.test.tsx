import { expect, test } from 'claude-code/testing'

test('agents pane draws empty', async ($, on) => {
  on('clock.now', () => ({ value: 1000 }) as never)
  for (const surface of ['terminal', 'desktop'] as const) {
    const tree = await ($.ui as any).render({ surface, component: 'Pane', requestId: 'agents', props: { bodyColumns: 60 }, viewport: { columns: 60, rows: 30 } })
    expect(JSON.stringify(tree)).toContain('Subagents')
  }
})
