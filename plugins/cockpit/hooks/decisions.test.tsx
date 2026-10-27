import { expect, mock, test } from 'claude-code/testing'

// decisions: guardrails' `decisions` state, read by a state.set observer, drawn in the cockpit pane.
const pane = async ($: any, surface: 'terminal' | 'desktop', bodyColumns = 80) =>
  JSON.stringify(await $.ui.render({ surface, component: 'Pane', requestId: 'cockpit', props: { bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 70 }, view: {} }, viewport: { columns: bodyColumns, rows: 40 } }))
const press = ($: any, key: string) => $.ui.press({ plugin: 'cockpit', surface: 'terminal', requestId: 'cockpit', key })
// Only the owner writes a value: an inline plugin named guardrails writes it, as the real one does.
const guardrails = {
  name: 'guardrails',
  register: (on: any) => {
    on('command.run', { command: 'gr-set' }, async ($: any, e: any) => {
      await $.state.set({ plugin: 'guardrails', key: 'decisions' }, JSON.parse(e.args))
      return { text: '' }
    })
  },
}
const opts = { plugins: [guardrails] }
const set = ($: any, v: object) => $.command.run({ command: 'gr-set', args: JSON.stringify(v), origin: { kind: 'composer' } })

const value = (over: object = {}) => ({
  tokens: 12_000,
  calls: 40,
  llmTokens: 41_000,
  gate: { auto: 20, asked: 5 },
  answers: { auto: 1, asked: 2 },
  models: { picked: 10, kept: 0 },
  offline: false,
  fast: 'tev1:4b',
  strong: 'nimble-v3:9b-mxfp8',
  recent: [{ id: 'k9', kind: 'gate', text: 'Bash → git status', verdict: 'allow', model: 'nimble-v3:9b-mxfp8', confidence: 0.97, at: 1 }],
  ...over,
})

function engine(on: any) {
  mock.clock(on, { now: 1_000_000 })
  on('session.usage', () => ({ value: { context: { percent: 10, tokens: 20_000, window: 200_000 }, rateLimits: [], cost: { usd: 1 } } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
}

test('the summary shows local tokens and counts, details the estimates', opts, async ($, on) => {
  engine(on)
  await set($, value())
  await set($, value({ answers: { auto: 3, asked: 2 }, models: { picked: 10, kept: 4 }, avoided: 60_000 }))
  for (const surface of ['terminal', 'desktop'] as const) {
    const out = await pane($, surface)
    expect(out).toContain('DECISIONS · local')
    expect(out).toContain('local 12k tok · 44 decisions (33 auto · 7 asked)') // 4 kept count in the total only
    expect(out).not.toContain('(est)')
  }
  await press($, 'dm')
  for (const surface of ['terminal', 'desktop'] as const) {
    const out = await pane($, surface)
    expect(out).toContain('saved (est)')
    expect(out).toContain('41k tok')
    expect(out).toContain('round trips avoided (est)')
    expect(out).toContain('60k tok') // three auto answers at 20k context each
    expect(out).toContain('fast tev1:4b · strong nimble-v3:9b-mxfp8')
    expect(out).toContain('4 kept')
    expect(out).toContain('git status')
  }
})

test('offline shows its own state', opts, async ($, on) => {
  engine(on)
  await set($, value({ offline: true }))
  expect(await pane($, 'terminal')).toContain('decision models offline')
})

test('decisions off draws no panel', { ...opts, options: { decisions: false } }, async ($, on) => {
  engine(on)
  await set($, value())
  expect(await pane($, 'terminal')).not.toContain('DECISIONS')
})

test('a check the local model approved counts as local', opts, async ($, on) => {
  engine(on)
  on('tool.check', (_$: any, e: any) => ({ decision: 'allow', reason: e.tool_use_id === 'k1' ? 'guardrails: approved by local decision model (nimble · 0.97)' : undefined }))
  await ($ as any).tool.check({ tool: 'Bash', input: { command: 'git status' }, tool_use_id: 'k1' })
  await ($ as any).tool.check({ tool: 'Bash', input: { command: 'git log' }, tool_use_id: 'k9' })
  expect(await pane($, 'terminal')).toContain('1 local')
  // k9 was allowed beneath guardrails' hook; its decisions row retags it.
  await set($, value())
  const out = await pane($, 'terminal')
  expect(out).toContain('2 local')
  expect(out).toContain('0 allowed')
})
