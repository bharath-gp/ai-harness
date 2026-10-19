import { expect, test } from 'claude-code/testing'

const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const TIP = '{"done":false,"question":"Which framework?","options":["React","Vue"]}'
const CLEAR = '{"done":true}'
const PROMPT = 'Build me a dashboard that shows sales numbers per region please'

// Mocks one session; `reply` is what the interviewer model answers, `sid` the session id.
function setup(on: any, reply: string, sid: { id: string } = { id: 's1' }, held = new Map<string, boolean>()) {
  const toasts: string[] = []
  const sent: string[] = []
  on('model.complete', () => ({ value: { isAnswered: true, text: reply, usage } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.toast', (_$: any, e: any) => { toasts.push(e.message ?? e.text ?? JSON.stringify(e)); return { value: undefined } })
  on('session.model', () => ({ value: 'sonnet' }))
  on('session.id', () => ({ value: sid.id }))
  // the host's $.state: a map that outlives any one module load
  on('state.get', (_$: any, e: any) => ({ value: { value: held.get(e.id), version: held.has(e.id) ? 1 : 0 } }))
  on('state.set', (_$: any, e: any) => { held.set(e.id, e.value); return { value: { isSet: true, version: 1 } } })
  on('prompt.submit', (_$: any, e: any) => { if (e.origin?.kind === 'plugin') sent.push(e.text); return { text: e.text } })
  return { toasts, sent, held }
}
const settle = () => new Promise(res => setTimeout(res, 50))
// waits for the background interview call, so none outlives its test
const submit = async ($: any, text = PROMPT, extra: object = {}) => {
  const r = await $.prompt.submit({ text, origin: { kind: 'composer' }, wait: false, ...extra })
  await settle()
  return r
}
const pane = async ($: any, surface: 'terminal' | 'desktop') =>
  JSON.stringify(await $.ui.render({ surface, component: 'Pane', requestId: 'coach', props: { bodyColumns: 60 }, viewport: { columns: 60, rows: 30 } }))

test('first improvable prompt is held and interviewed', async ($, on) => {
  setup(on, TIP)
  const r = await submit($)
  expect(r.drop).toBeDefined()
  await settle()
  for (const surface of ['terminal', 'desktop'] as const) expect(await pane($, surface)).toContain('Which framework?')
})

test('first prompt of any length is coached, long or short', async ($, on) => {
  setup(on, TIP)
  expect((await submit($, 'x'.repeat(5000))).drop).toBeDefined()
})

test('first clear prompt shows Looks good and is sent on', async ($, on) => {
  const { toasts, sent } = setup(on, CLEAR)
  const r = await submit($)
  expect(r.drop).toBeDefined()
  await settle()
  expect(toasts.join(' ')).toContain('Looks good')
  expect(sent).toEqual([PROMPT])
})

test('second prompt in the same session does nothing', async ($, on) => {
  setup(on, TIP)
  await submit($)
  await settle()
  const r = await submit($, 'Now add a filter by date range to that dashboard please')
  expect(r.drop).toBeUndefined()
})

test('a clear first prompt also uses up the session', async ($, on) => {
  setup(on, CLEAR)
  await submit($)
  await settle()
  expect((await submit($, 'Now add a filter by date range to that dashboard please')).drop).toBeUndefined()
})

test('another session id is coached independently', async ($, on) => {
  const sid = { id: 's1' }
  setup(on, TIP, sid)
  expect((await submit($)).drop).toBeDefined()
  expect((await submit($, 'A second long enough prompt in the same first session')).drop).toBeUndefined()
  sid.id = 's2'
  expect((await submit($)).drop).toBeDefined()
})

test('the coached flag is written to $.state per session id', async ($, on) => {
  const { held } = setup(on, TIP)
  await submit($)
  expect(held.get('s1')).toBe(true)
})

test('a reload (fresh module, same $.state) does not coach again', async ($, on) => {
  setup(on, TIP, { id: 's1' }, new Map([['s1', true]]))
  expect((await submit($)).drop).toBeUndefined()
})

const SHOT = { attachments: [{ type: 'image', mediaType: 'image/png', filename: 'shot.png' }] }

test('first prompt with an attachment is sent as typed and the improved text is only a tip', async ($, on) => {
  const { sent } = setup(on, TIP)
  const r = await submit($, PROMPT, SHOT)
  expect(r.drop).toBeUndefined()
  expect(r.text).toBe(PROMPT)
  for (const surface of ['terminal', 'desktop'] as const) {
    const tree = await pane($, surface)
    expect(tree).toContain('Which framework?')
    expect(tree).toContain('already sent')
    expect(tree).not.toContain('Dismiss (send original)')
  }
  expect(sent).toEqual([])
})

test('a clear first prompt with an attachment shows Looks good and sends nothing twice', async ($, on) => {
  const { toasts, sent } = setup(on, CLEAR)
  const r = await submit($, PROMPT, SHOT)
  expect(r.drop).toBeUndefined()
  expect(toasts.join(' ')).toContain('Looks good')
  expect(sent).toEqual([])
})
