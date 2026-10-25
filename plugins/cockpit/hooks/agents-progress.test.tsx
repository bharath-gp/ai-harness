import { expect, mock, test } from 'claude-code/testing'

const pane = ($: any, surface: string, bodyColumns: number, placement = 'dock') =>
  $.ui.render({ surface, component: 'Pane', requestId: 'cockpit', props: { bodyColumns, placement, scroll: { offset: 0, bodyRows: 70 }, view: {} }, viewport: { columns: bodyColumns, rows: 40 } })
const spawn = (n: number, subagentType: string, description: string) => ({ prompt: description, description, subagentType, tool_use_id: `tu${n}`, provider: { plugin: 'engine', tier: 'core' }, background: true, fork: false })
const usage = { value: { context: { percent: 1, tokens: 1, window: 200000 }, rateLimits: [] } } as never

test('cockpit pane draws on every surface and width', async ($, on) => {
  mock.clock(on)
  on('session.usage', () => usage)
  for (const surface of ['terminal', 'desktop', 'mobile'] as const)
    for (const cols of [24, 40, 60, 86, 120]) expect(JSON.stringify(await pane($, surface, cols))).toContain('· main')
})

test('agents show as cards while running and finish on their turn.complete', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  on('session.usage', () => usage)
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a1' }) as never)
  on('turn.complete', () => ({ text: '' }) as never)
  await ($ as any).agent.spawn(spawn(1, 'Explore', 'Map the hooks'))
  let out = JSON.stringify(await pane($, 'terminal', 80))
  expect(out).toContain('Map the hooks')
  expect(out).toContain('1 running')
  await ($ as any).turn.complete({ agentId: 'a1', answer: 'found 3', reason: 'answer', durationMs: 5000, turnId: 't', isAborted: false })
  out = JSON.stringify(await pane($, 'terminal', 80))
  expect(out).toContain('0 running')
})

test('more agents than fit switch to swimlanes; inline the pane is a short summary', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  on('session.usage', () => usage)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `m${++n}` }) as never)
  for (const d of ['one', 'two', 'three', 'four', 'five']) await ($ as any).agent.spawn(spawn(n + 10, 'general-purpose', `task ${d}`))
  expect(JSON.stringify(await pane($, 'terminal', 80))).toContain('━')
  const mini = (await pane($, 'terminal', 80, 'inline')) as { children?: unknown[] }
  expect((mini.children ?? []).filter(Boolean).length <= 8).toBe(true)
  expect(JSON.stringify(mini)).toContain('+2 more agents')
})

test('TaskCreate/TaskUpdate drive the main progress', async ($, on) => {
  on('clock.now', () => ({ value: 1_000_000 }) as never)
  on('session.usage', () => usage)
  on('tool.call', { tool: 'TaskCreate' }, () => ({ result: { task: { id: '1', subject: 'Write code' } } }) as never)
  on('tool.call', { tool: 'TaskUpdate' }, () => ({ result: {} }) as never)
  await ($.tool as any).call({ tool: 'TaskCreate', subject: 'Write code', description: 'd', activeForm: 'Writing code' })
  await ($.tool as any).call({ tool: 'TaskUpdate', taskId: '1', status: 'in_progress' })
  const tree = await ($.ui as any).render({ surface: 'terminal', component: 'AbovePrompt', props: { bodyColumns: 80, hasSurvey: false }, viewport: { columns: 80, rows: 30 } })
  expect(JSON.stringify(tree)).toContain('Writing code')
  expect(JSON.stringify(await pane($, 'terminal', 80))).toContain('Writing code')
})
