import { expect, test } from 'claude-code/testing'
import { choice, mock } from './dm-mock'

const ENGINE = { plugin: 'engine', tier: 'core' }
// The engine's own spawn records the model it was given.
function setup(on: any, conf = 0.95) {
  const m = mock(on, () => ({ model: choice('haiku', conf) }))
  const models: (string | undefined)[] = []
  on('agent.spawn', (_$: any, e: any) => { models.push(e.model); return { model: e.model ?? 'inherit', agentId: 'a1' } })
  return { ...m, models }
}
const spawn = ($: any, extra: object = {}) =>
  $.agent.spawn({ tool_use_id: 'tu1', prompt: 'List every file that imports formatPrice.', description: 'Find usages', subagentType: 'general-purpose', provider: ENGINE, fork: false, background: false, parentModel: 'opus', ...extra })
const settle = () => new Promise(res => setTimeout(res, 30))

test('an unset model on a built-in is picked', async ($, on) => {
  const m = setup(on)
  await spawn($)
  expect(m.models).toEqual(['haiku'])
  expect(Object.keys(m.asked[0].body.questions.model.criteria)).toEqual(['haiku', 'sonnet', 'opus'])
  await settle()
  expect(m.stats().models.picked).toBe(1)
  expect(m.stats().recent[0]).toMatchObject({ kind: 'model', verdict: 'haiku' })
})

test('a preset model, a fork, Explore, a teammate and a plugin agent are untouched', async ($, on) => {
  const m = setup(on)
  await spawn($, { model: 'opus' })
  await spawn($, { fork: true, subagentType: 'fork' })
  await spawn($, { subagentType: 'Explore' })
  await spawn($, { isTeammate: true })
  await spawn($, { subagentType: 'toolbox:writer', provider: { plugin: 'toolbox', tier: 'user' } })
  expect(m.models).toEqual(['opus', undefined, undefined, undefined, undefined])
  expect(m.asked).toEqual([])
})

test('an unsure model keeps the spawn as it was', async ($, on) => {
  const m = setup(on, 0.4)
  await spawn($)
  expect(m.models).toEqual([undefined])
  await settle()
  expect(m.stats().models.kept).toBe(1)
})

test('subagentModels sets the choices', { options: { subagentModels: 'haiku, sonnet' } }, async ($, on) => {
  const m = setup(on)
  await spawn($)
  expect(Object.keys(m.asked[0].body.questions.model.criteria)).toEqual(['haiku', 'sonnet'])
})

test('modelPicker off leaves spawns alone', { options: { modelPicker: false } }, async ($, on) => {
  const m = setup(on)
  await spawn($)
  expect(m.models).toEqual([undefined])
  expect(m.asked).toEqual([])
})

// prompt-coach's model row
function coach(on: any, conf = 0.91) {
  const m = mock(on, (_model, body) => (body.questions.model ? { model: choice('sonnet', conf) } : {}))
  const ran: { command: string; args?: string }[] = []
  on('model.complete', () => ({ value: { isAnswered: true, text: 'Better prompt', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }))
  on('command.run', { command: 'model' }, (_$: any, e: any) => { ran.push({ command: e.command, args: e.args }); return { text: '' } })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.model', () => ({ value: 'opus' }))
  on('session.id', () => ({ value: 's1' }))
  on('prompt.submit', (_$: any, e: any) => ({ text: e.text }))
  return { ...m, ran }
}
const pane = async ($: any, surface: string) =>
  JSON.stringify(await $.ui.render({ surface, component: 'Pane', requestId: 'coach', props: { bodyColumns: 60 }, viewport: { columns: 60, rows: 30 } }))
const first = ($: any) => $.prompt.submit({ text: 'Rename the helper in utils.ts', origin: { kind: 'composer' }, wait: false })

test('the coach pane offers a model, and Switch runs /model', async ($, on) => {
  const c = coach(on)
  await first($)
  await settle()
  for (const surface of ['terminal', 'desktop']) {
    const tree = await pane($, surface)
    expect(tree).toContain('Model: sonnet · 0.91 · tev1')
    expect(tree).toContain('Switch')
  }
  await ($ as any).ui.press({ plugin: 'guardrails', surface: 'terminal', component: 'Pane', requestId: 'coach', key: 'switch' })
  expect(c.ran).toEqual([{ command: 'model', args: 'sonnet' }])
  expect(await pane($, 'desktop')).toContain('Switched to sonnet')
})

test('no model row when unsure or offline', async ($, on) => {
  coach(on, 0.5)
  await first($)
  await settle()
  expect(await pane($, 'terminal')).not.toContain('Model:')
})

test('no model row with modelPicker off', { options: { modelPicker: false } }, async ($, on) => {
  const c = coach(on)
  await first($)
  await settle()
  expect(await pane($, 'terminal')).not.toContain('Model:')
  expect(c.asked).toEqual([])
})
