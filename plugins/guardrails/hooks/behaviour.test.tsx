import { expect, test } from 'claude-code/testing'

// Behaviour every guardrails mod must keep through a redesign.
const run = ($: any, command: string, args?: string) => $.command.run({ command, args, origin: { kind: 'composer' } })
const submit = ($: any, text: string) => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
const above = async ($: any, surface = 'terminal') =>
  JSON.stringify(await $.ui.render({ surface, component: 'AbovePrompt', props: { bodyColumns: 80, hasSurvey: false }, viewport: { columns: 80, rows: 30 } }))
// Built at runtime so this file is not itself a secret.
const TOKEN = ['ghp', 'a'.repeat(36)].join('_')

test('reflect: "remember:" queues a rule, /reflect-queue lists it, /reflect-pause stops new ones', async ($, on) => {
  on('prompt.submit', () => ({ text: '' }) as never)
  await submit($, 'remember: use tabs')
  for (const surface of ['terminal', 'desktop']) expect(await above($, surface)).toContain('use tabs')
  expect((await run($, 'reflect-queue')).text).toBe('- use tabs (repo, x1)')
  expect((await run($, 'reflect-pause')).text).toBe('reflect paused.')
  await submit($, 'remember: never mock the db')
  expect((await run($, 'reflect-queue')).text).not.toContain('mock')
  expect((await run($, 'reflect-pause')).text).toBe('reflect resumed.')
})

test('assumption-tracker: /assumptions with nothing recorded says so', async ($) => {
  expect((await run($, 'assumptions')).text).toContain('No assumptions')
})

test('self-critique: /critique auto toggles, a model argument is used', async ($, on) => {
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('session.model', () => ({ value: 'sonnet' }) as never)
  expect((await run($, 'critique', 'auto')).text).toBe('Auto-critique on.')
  expect((await run($, 'critique', 'auto')).text).toBe('Auto-critique off.')
  expect((await run($, 'critique', 'haiku')).text).toBe('Critiquing with haiku.')
})

test('secret-sentry: Edit with a key is denied, an .example file is allowed', async ($, on) => {
  on('tool.call', { tool: 'Edit' }, () => ({ result: {}, text: 'ok' }) as never)
  const bad = await ($.tool as any).call({ tool: 'Edit', file_path: 'a.ts', old_string: 'x', new_string: `const k = "${TOKEN}"` })
  expect(bad.deny).toContain('GitHub token')
  const ok = await ($.tool as any).call({ tool: 'Edit', file_path: 'config.example', old_string: 'x', new_string: TOKEN })
  expect(ok.deny).toBeUndefined()
})

// The dialog stays open until `answer` is called, so the test can render the card while it is pending.
function blast(on: any) {
  let answer: (label: string) => void = () => undefined
  const asked = new Promise<void>(res => {
    on('session.cwd', () => ({ value: '/tmp/p' }))
    on('fs.stat', () => ({ value: { kind: 'file', size: 2048, mtimeMs: 0 } }))
    on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: {}, text: 'ran' }))
    on('ui.render', { component: 'AskUserQuestion' }, () => ({ type: 'engine', ref: 0 }))
    on('tool.call', { tool: 'AskUserQuestion' }, (_$: any, e: any) =>
      new Promise(done => {
        answer = (want: string) => {
          const pick = e.questions[0].options.map((o: any) => o.label ?? o).find((l: string) => l.startsWith(want))
          done({ result: { questions: e.questions, answers: { [e.questions[0].question]: pick } }, text: pick })
        }
        res()
      }),
    )
  })
  return { asked, answer: (l: string) => answer(l) }
}
const dialog = async ($: any, surface: string) =>
  JSON.stringify(await $.ui.render({ surface, component: 'AskUserQuestion', props: { questions: [{ header: 'Blast Radius', question: 'q', options: [] }], bodyColumns: 80 }, viewport: { columns: 80, rows: 30 } }))

test('blast-radius: shows the files at risk, Cancel denies', async ($, on) => {
  const b = blast(on)
  const call = $.tool.call({ tool: 'Bash', command: 'rm -rf dist' })
  await b.asked
  for (const surface of ['terminal', 'desktop']) {
    const card = await dialog($, surface)
    expect(card).toContain('dist')
    expect(card).toContain('2.0 KB')
  }
  b.answer('Cancel')
  expect((await call).deny).toContain('user cancelled')
})

test('blast-radius: Delete lets the command run', async ($, on) => {
  const b = blast(on)
  const call = $.tool.call({ tool: 'Bash', command: 'rm -rf dist' })
  await b.asked
  b.answer('Delete')
  expect((await call).deny).toBeUndefined()
})
