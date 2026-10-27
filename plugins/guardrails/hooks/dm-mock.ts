// Shared by the decision-model tests: Ollama, the clock, $.state and $.store mocked.
export const FAST = 'tev1:4b'
export const STRONG = 'nimble-v3:9b-mxfp8'
export const TAGS = { models: [{ name: FAST, digest: 'd1', size: 4e9, capabilities: ['completion', 'decision'] }, { name: STRONG, digest: 'd2', size: 9e9, capabilities: ['decision'] }, { name: 'llama3:8b', digest: 'd3', size: 8e9, capabilities: ['completion'] }] }
export const choice = (c: string, confidence: number) => ({ type: 'choice', choice: c, probabilities: {}, confidence })
export type Reply = (model: string, body: any) => Record<string, unknown> | 'hang' | 'error'

// Mocks Ollama, the clock, $.state and $.store. `reply` answers each /v1/systemone request; `bench` false leaves the store empty.
export function mock(on: any, reply: Reply, o: { bench?: boolean; down?: boolean; timeouts?: boolean } = {}) {
  let now = 1_000_000
  const asked: { model: string; body: any }[] = []
  const held = new Map<string, unknown>()
  const store = new Map<string, unknown>()
  if (o.bench !== false) store.set('decisionBench', { at: now, key: 'd1,d2|', fast: FAST, strong: STRONG, scores: [] })
  on('clock.now', () => ({ value: now }))
  // A timeout fires only where the test wants one, a moment later so a prompt reply still wins; otherwise never.
  on('clock.after', () => new Promise(res => { if (o.timeouts) setTimeout(() => res({ value: undefined }), 5) }))
  on('session.cwd', () => ({ value: '/p' }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }))
  on('session.root', () => ({ value: '/p' }))
  on('state.get', (_$: any, e: any) => ({ value: { value: held.get(e.key), version: 1 } }))
  on('state.set', (_$: any, e: any) => { held.set(e.key, e.value); return { value: { isSet: true, version: 1 } } })
  on('store.get', (_$: any, e: any) => ({ value: store.get(e.key) }))
  on('store.set', (_$: any, e: any) => { store.set(e.key, e.value); return { value: undefined } })
  on('http.fetch', (_$: any, e: any) => {
    if (o.down) throw new Error('ECONNREFUSED')
    const ok = (j: unknown) => ({ value: { status: 200, ok: true, headers: {}, text: JSON.stringify(j) } })
    if (e.url.endsWith('/api/tags')) return ok(TAGS)
    const body = JSON.parse(e.init.body)
    asked.push({ model: body.model, body })
    const r = reply(body.model, body)
    if (r === 'hang') return new Promise(() => {})
    if (r === 'error') return { value: { status: 500, ok: false, headers: {}, text: 'boom' } }
    now += body.model === FAST ? 600 : 1500
    return ok({ model: body.model, answers: r, usage: { input_tokens: 100, output_tokens: 0 } })
  })
  return { asked, stats: () => held.get('decisions') as any, store, held, tick: (ms: number) => { now += ms } }
}

