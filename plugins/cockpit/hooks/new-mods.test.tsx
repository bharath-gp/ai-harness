import { expect, mock, test } from 'claude-code/testing'

// The panels ported from claude-flightdeck: architect, permission-gate, loops, turn-receipt, session-log, and /cockpit.
const pane = async ($: any, surface = 'terminal', bodyColumns = 80) =>
  JSON.stringify(await $.ui.render({ surface, component: 'Pane', requestId: 'cockpit', props: { bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 70 }, view: {} }, viewport: { columns: bodyColumns, rows: 40 } }))
const spawn = (n: number, subagentType: string, description: string) => ({ prompt: description, description, subagentType, tool_use_id: `tu${n}`, provider: { plugin: 'engine', tier: 'core' }, background: true, fork: false })
const run = ($: any, command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } })

function engine(on: any) {
  const clock = mock.clock(on, { now: 1_000_000 })
  on('session.usage', () => ({ value: { context: { percent: 10, tokens: 20_000, window: 200_000 }, rateLimits: [], cost: { usd: 1 } } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('turn.start', (_$: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  return clock
}

test('architect: a matching agent type is a consult, its answer the advice', async ($, on) => {
  engine(on)
  on('agent.spawn', () => ({ model: 'claude-fable-5-1', agentId: 'r1' }))
  await ($ as any).turn.start({ text: 'review it', turnId: 'T1' })
  await ($ as any).agent.spawn(spawn(1, 'fable-advisor:fable-advisor', 'final review'))
  expect(await pane($)).toContain('ARCHITECT · advising')
  await ($ as any).turn.complete({ agentId: 'r1', answer: '**Ship it** after the tests pass', reason: 'answer', durationMs: 3000, turnId: 'T1', isAborted: false })
  const out = await pane($)
  expect(out).toContain('ARCHITECT · on call')
  expect(out).toContain('Ship it after the tests pass')
})

test('permission-gate: checks are counted, an ask is settled by its call, credentials are masked', async ($, on) => {
  engine(on)
  // The first check of k2 asks; any later one (newer test kits raise one inside tool.call too) allows.
  const asked = new Set<string>()
  on('tool.check', (_$: any, e: any) => ({ decision: e.tool === 'Bash' && !asked.has(e.tool_use_id) && asked.add(e.tool_use_id) ? 'ask' : 'allow' }))
  on('tool.call', () => ({ result: {} }))
  await ($ as any).tool.check({ tool: 'Read', input: { file_path: '/a/b.ts' }, tool_use_id: 'k1' })
  await ($ as any).tool.check({ tool: 'Bash', input: { command: 'curl -H "Authorization: Bearer abcdefghijklmnop" x' }, tool_use_id: 'k2' })
  expect(await pane($)).toContain('1 pending')
  await ($ as any).tool.call({ tool: 'Bash', command: 'curl x', tool_use_id: 'k2' })
  const out = await pane($)
  expect(out).toContain('GATE · permissions')
  expect(out).toContain('1 you')
  expect(out).not.toContain('pending')
  expect(out).not.toContain('abcdefghijklmnop')
})

test('turn-receipt and session-log: the last turn and the prompt that opened it', async ($, on) => {
  engine(on)
  await ($ as any).turn.start({ text: 'fix the parser', turnId: 'T1' })
  await ($ as any).turn.complete({ answer: 'done', reason: 'answer', durationMs: 7000, turnId: 'T1', isAborted: false })
  const out = await pane($)
  expect(out).toContain('last turn 7s')
  expect(out).toContain('fix the parser')
  expect(out).toContain('session log')
})

test('mods switched off draw no panel', { options: { sessionLog: false, turnReceipt: false } }, async ($, on) => {
  engine(on)
  await ($ as any).turn.start({ text: 'fix the parser', turnId: 'T1' })
  await ($ as any).turn.complete({ answer: 'done', reason: 'answer', durationMs: 7000, turnId: 'T1', isAborted: false })
  const out = await pane($)
  expect(out).not.toContain('session log')
  expect(out).not.toContain('last turn')
})

test('/cockpit opens, closes, resets and sets the layout', async ($, on) => {
  engine(on)
  expect((await run($, 'cockpit')).text).toContain('Cockpit opened')
  expect((await run($, 'cockpit', 'layout wide')).text).toBe('Cockpit layout: wide.')
  expect((await run($, 'cockpit', 'layout sideways')).text).toContain('Usage')
  expect((await run($, 'cockpit', 'reset')).text).toBe('Cockpit reset.')
  expect((await run($, 'cockpit', 'close')).text).toBe('Cockpit closed.')
})

test('/agents-info opens the cockpit pane', async ($, on) => {
  engine(on)
  expect((await run($, 'agents-info')).text).toBe('Agents panel opened.')
})
