import { expect, test } from 'claude-code/testing'

const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

test('critique pane draws verdict and flaws', async ($, on) => {
  on('model.complete', () => ({ value: { isAnswered: true, text: '{"verdict":"mixed","summary":"ok","strengths":["clear"],"flaws":[{"issue":"no tests","fix":"add tests"}]}', usage } }) as never)
  on('turn.complete', () => ({ text: '' }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('session.model', () => ({ value: 'sonnet' }) as never)
  await ($ as any).turn.complete({ answer: 'done', reason: 'answer', durationMs: 1, turnId: 't', isAborted: false })
  await ($ as any).command.run({ command: 'critique', args: '' })
  await new Promise(r => setTimeout(r, 50))
  for (const surface of ['terminal', 'desktop'] as const) {
    const tree = await ($.ui as any).render({ surface, component: 'Pane', requestId: 'critique', props: { bodyColumns: 60 }, viewport: { columns: 60, rows: 30 } })
    expect(JSON.stringify(tree)).toContain('no tests')
  }
})
