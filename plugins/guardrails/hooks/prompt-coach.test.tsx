import { expect, test } from 'claude-code/testing'

const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const DRAFT = 'Role: senior engineer.\n\nBefore you start: grill me about ambiguities.'
const PROMPT = 'Build me a dashboard that shows sales numbers per region please'

// Mocks one session; `sid` is the session id, `held` the host's $.state.
function setup(on: any, sid: { id: string } = { id: 's1' }, held = new Map<string, boolean>(), box = '', last = '') {
  const prompts: string[] = []
  const filled: string[] = []
  const sent: string[] = []
  on('model.complete', (_$: any, e: any) => { if (e.prompt.startsWith('Rewrite the user')) prompts.push(e.prompt); return { value: { isAnswered: true, text: DRAFT, usage } } })
  on('command.run', () => ({ value: { text: '' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.model', () => ({ value: 'sonnet' }))
  on('session.id', () => ({ value: sid.id }))
  on('session.messages', () => ({ value: last ? [{ role: 'user', text: last, toolUses: [] }] : [] }))
  on('prompt.read', () => ({ value: { text: box, cursor: 0 } }))
  on('prompt.fill', (_$: any, e: any) => { filled.push(e.text); return { value: { isFilled: true } } })
  on('state.get', (_$: any, e: any) => ({ value: { value: held.get(e.id), version: held.has(e.id) ? 1 : 0 } }))
  on('state.set', (_$: any, e: any) => { held.set(e.id, e.value); return { value: { isSet: true, version: 1 } } })
  on('prompt.submit', (_$: any, e: any) => { if (e.origin?.kind === 'plugin') sent.push(e.text); return { text: e.text } })
  return { prompts, filled, sent, held }
}
const settle = () => new Promise(res => setTimeout(res, 50))
const submit = async ($: any, text = PROMPT, extra: object = {}) => {
  const r = await $.prompt.submit({ text, origin: { kind: 'composer' }, wait: false, ...extra })
  await settle()
  return r
}
const pane = async ($: any, surface: 'terminal' | 'desktop') =>
  JSON.stringify(await $.ui.render({ surface, component: 'Pane', requestId: 'coach', props: { bodyColumns: 60 }, viewport: { columns: 60, rows: 30 } }))
const sharpen = async ($: any, args?: string) => (await $.command.run({ command: 'sharpen', args })).text

test('first prompt is held and rewritten, no interview', async ($, on) => {
  const { prompts } = setup(on)
  expect((await submit($)).drop).toBeDefined()
  expect(prompts).toHaveLength(1)
  expect(prompts[0]).toContain('grill the user')
  for (const surface of ['terminal', 'desktop'] as const) {
    const tree = await pane($, surface)
    expect(tree).toContain('grill me about ambiguities')
    expect(tree).toContain('Use Prompt')
    expect(tree).not.toContain('Use in prompt box')
    expect(tree).toContain('Dismiss (send original)')
  }
})

test('first prompt of any length is coached', async ($, on) => {
  setup(on)
  expect((await submit($, 'x'.repeat(5000))).drop).toBeDefined()
})

test('a first prompt starting with a slash command is coached and keeps the command line', async ($, on) => {
  const { prompts } = setup(on)
  expect((await submit($, '/review-pr 42 --strict')).drop).toBeDefined()
  expect(prompts[0]).toContain('/review-pr 42 --strict')
  expect(await pane($, 'terminal')).toContain('/review-pr 42 --strict')
})

test('no later prompt is auto-coached, slash or not', async ($, on) => {
  setup(on)
  await submit($)
  expect((await submit($, 'Now add a filter by date range to that dashboard please')).drop).toBeUndefined()
  expect((await submit($, '/review-pr 42')).drop).toBeUndefined()
})

test('a slash first prompt uses up the session', async ($, on) => {
  setup(on)
  await submit($, '/review-pr 42')
  expect((await submit($, 'Now add a filter by date range to that dashboard please')).drop).toBeUndefined()
})

test('another session id is offered independently', async ($, on) => {
  const sid = { id: 's1' }
  setup(on, sid)
  expect((await submit($)).drop).toBeDefined()
  sid.id = 's2'
  expect((await submit($)).drop).toBeDefined()
})

test('the flag is written to $.state per session id', async ($, on) => {
  const { held } = setup(on)
  await submit($)
  expect(held.get('s1')).toBe(true)
})

test('a reload (fresh module, same $.state) does not offer again', async ($, on) => {
  setup(on, { id: 's1' }, new Map([['s1', true]]))
  expect((await submit($)).drop).toBeUndefined()
})

test('a first prompt with an attachment is sent as typed', async ($, on) => {
  const { sent } = setup(on)
  const r = await submit($, PROMPT, { attachments: [{ type: 'image', mediaType: 'image/png', filename: 'shot.png' }] })
  expect(r.drop).toBeUndefined()
  const tree = await pane($, 'terminal')
  expect(tree).not.toContain('Dismiss (send original)')
  expect(tree).not.toContain('Use Prompt')
  expect(sent).toEqual([])
})

test('/sharpen uses typed text, then the prompt box, then the last user message, after auto is used up', async ($, on) => {
  const { prompts } = setup(on, { id: 's1' }, new Map([['s1', true]]), 'box text here', 'last message here')
  expect(await sharpen($, 'typed draft')).toContain('opened')
  await settle()
  expect(prompts.at(-1)).toContain('typed draft')
})

test('/sharpen with no args uses the prompt box', async ($, on) => {
  const { prompts } = setup(on, { id: 's1' }, new Map(), 'box text here', 'last message here')
  await sharpen($, undefined)
  await settle()
  expect(prompts.at(-1)).toContain('box text here')
})

test('/sharpen falls back to the last user message, and a bare command with nothing prints usage', async ($, on) => {
  const { prompts } = setup(on, { id: 's1' }, new Map(), '', 'last message here')
  await sharpen($)
  await settle()
  expect(prompts.at(-1)).toContain('last message here')
})

test('a bare /sharpen with nothing to coach prints usage', async ($, on) => {
  setup(on)
  expect(await sharpen($)).toContain('Usage')
})

test('Use Prompt sends the improved prompt as the user', async ($, on) => {
  const { sent, filled } = setup(on)
  await submit($)
  await pane($, 'terminal')
  await $.ui.press({ plugin: 'guardrails', surface: 'terminal', requestId: 'coach', key: 'use' })
  await settle()
  expect(sent).toEqual([DRAFT])
  expect(filled).toEqual([])
})
