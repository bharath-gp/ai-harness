import { expect, test } from 'claude-code/testing'

test('pane draws with assumptions', async ($, on) => {
  on('model.complete', () => ({ value: { isAnswered: true, text: '["Used CSV not TSV","Chose UTC"]', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }) as never)
  on('prompt.submit', e => ({ text: 'write a parser' }) as never)
  on('turn.complete', () => ({ text: '' }) as never)
  await ($ as any).prompt.submit({ text: 'write a parser', wait: false, origin: { kind: 'composer' } })
  await ($ as any).turn.complete({ answer: 'done', reason: 'answer', durationMs: 1, turnId: 't', isAborted: false })
  await new Promise(r => setTimeout(r, 50))
  for (const surface of ['terminal', 'desktop'] as const) {
    const tree = await ($.ui as any).render({ surface, component: 'Pane', requestId: 'assumptions', props: { bodyColumns: 60 }, viewport: { columns: 60, rows: 30 } })
    expect(tree).toBeDefined()
  }
})
