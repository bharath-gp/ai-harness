import { expect, test } from 'claude-code/testing'

const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

test('first long prompt is held and interviewed', async ($, on) => {
  on('model.complete', () => ({ value: { isAnswered: true, text: '{"done":false,"question":"Which framework?","options":["React","Vue"]}', usage } }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('prompt.submit', (_$, e) => ({ value: { text: e.text } }) as never)
  on('session.model', () => ({ value: 'sonnet' }) as never)
  const r = await ($ as any).prompt.submit({ text: 'Build me a dashboard that shows sales numbers per region please', origin: { kind: 'composer' }, wait: false })
  expect(r.drop).toBeDefined()
  await new Promise(res => setTimeout(res, 50))
  for (const surface of ['terminal', 'desktop'] as const) {
    const tree = await ($.ui as any).render({ surface, component: 'Pane', requestId: 'coach', props: { bodyColumns: 60 }, viewport: { columns: 60, rows: 30 } })
    expect(JSON.stringify(tree)).toContain('Which framework?')
  }
})
