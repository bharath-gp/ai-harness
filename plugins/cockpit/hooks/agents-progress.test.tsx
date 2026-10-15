import { expect, test } from 'claude-code/testing'

test('agents pane draws empty', async ($, on) => {
  on('clock.now', () => ({ value: 1000 }) as never)
  for (const surface of ['terminal', 'desktop'] as const) {
    const tree = await ($.ui as any).render({ surface, component: 'Pane', requestId: 'agents', props: { bodyColumns: 60 }, viewport: { columns: 60, rows: 30 } })
    expect(JSON.stringify(tree)).toContain('Subagents')
  }
})

test('TaskCreate/TaskUpdate drive the main progress band', async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }) as never)
  on('session.usage', () => ({ value: { context: { percent: 1, tokens: 1, window: 200000 }, rateLimits: [] } }) as never)
  on('tool.call', { tool: 'TaskCreate' }, () => ({ result: { task: { id: '1', subject: 'Write code' } } }) as never)
  on('tool.call', { tool: 'TaskUpdate' }, () => ({ result: {} }) as never)
  await ($.tool as any).call({ tool: 'TaskCreate', subject: 'Write code', description: 'd', activeForm: 'Writing code' })
  await ($.tool as any).call({ tool: 'TaskUpdate', taskId: '1', status: 'in_progress' })
  const tree = await ($.ui as any).render({ surface: 'terminal', component: 'AbovePrompt', props: { bodyColumns: 80, hasSurvey: false }, viewport: { columns: 80, rows: 30 } })
  expect(JSON.stringify(tree)).toContain('Writing code')
})
