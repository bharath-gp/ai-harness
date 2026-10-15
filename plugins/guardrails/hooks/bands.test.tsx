import { expect, test } from 'claude-code/testing'

const render = ($: any, surface: string, component: string, requestId?: string) =>
  $.ui.render({ surface, component, requestId, props: { bodyColumns: 80, hasSurvey: false }, viewport: { columns: 80, rows: 30 } })
const answer = (text: string) => ({ value: { isAnswered: true, text, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }) as never

test('assumption band shows after a turn', async ($, on) => {
  on('model.complete', () => answer('["Used CSV not TSV","Chose UTC"]'))
  on('prompt.submit', () => ({ text: 'write a parser' }) as never)
  on('turn.complete', () => ({ text: '' }) as never)
  await ($ as any).prompt.submit({ text: 'write a parser', wait: false, origin: { kind: 'composer' } })
  await ($ as any).turn.complete({ answer: 'done', reason: 'answer', durationMs: 1, turnId: 't', isAborted: false })
  await new Promise(r => setTimeout(r, 50))
  for (const surface of ['terminal', 'desktop']) expect(JSON.stringify(await render($, surface, 'AbovePrompt'))).toContain('assumption')
})

test('reflect band shows a found rule', async ($, on) => {
  on('model.complete', () => answer('{"rule":"Use pnpm","scope":"repo"}'))
  on('prompt.submit', () => ({ text: '' }) as never)
  await ($ as any).prompt.submit({ text: 'no, always use pnpm here', wait: false, origin: { kind: 'composer' } })
  await new Promise(r => setTimeout(r, 50))
  for (const surface of ['terminal', 'desktop']) expect(JSON.stringify(await render($, surface, 'AbovePrompt'))).toContain('Rule found')
})

test('critique pane draws', async ($) => {
  for (const surface of ['terminal', 'desktop']) expect(await render($, surface, 'Pane', 'critique')).toBeDefined()
})
