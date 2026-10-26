import { expect, test } from 'claude-code/testing'
import { sweepClean, sweepWorktrees } from './register'

const url = 'https://github.com/o/r/pull/7'

// Mocks one session id and the host's $.state; returns the PR list stored for the session.
const mock = (on: any, bash: object) => {
  const held = new Map<string, unknown>()
  on('session.id', () => ({ value: 's1' }))
  on('state.get', (_$: any, e: any) => ({ value: { value: held.get(e.id), version: held.has(e.id) ? 1 : 0 } }))
  on('state.set', (_$: any, e: any) => { held.set(e.id, e.value); return { value: { isSet: true, version: 1 } } })
  on('tool.call', { tool: 'Bash' }, () => ({ result: {}, ...bash }) as never)
  return () => held.get('s1')
}

test('records the PR url from gh pr create', async ($, on) => {
  const prs = mock(on, { text: `${url}\n` })
  await $.tool.call({ tool: 'Bash', command: 'gh pr create --fill' })
  expect(prs()).toEqual([url])
})

test('ignores other commands and failed creates', async ($, on) => {
  const prs = mock(on, { text: url, isError: true })
  await $.tool.call({ tool: 'Bash', command: 'gh pr create' })
  await $.tool.call({ tool: 'Bash', command: 'gh pr view' })
  expect(prs()).toBeUndefined()
})

test('off records nothing', { options: { mergeSweep: false } }, async ($, on) => {
  const prs = mock(on, { text: url })
  await $.tool.call({ tool: 'Bash', command: 'gh pr create' })
  expect(prs()).toBeUndefined()
})

// ---- merge detection and the band
const render = ($: any) =>
  $.ui.render({ surface: 'terminal', component: 'AbovePrompt', props: { bodyColumns: 80, hasSurvey: false }, viewport: { columns: 80, rows: 30 } })

test('a merged PR shows the cleanup band after a turn; an open PR does not', async ($, on) => {
  const prs = mock(on, { text: url })
  let state = 'OPEN'
  on('turn.complete', () => ({ text: '' }) as never)
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as never)
  on('process.run', () => ({ value: { exitCode: 0, stderr: '', stdout: JSON.stringify({ state, headRefName: 'feat', headRefOid: 'abc', baseRefName: 'main', isCrossRepository: false }) } }))
  await $.tool.call({ tool: 'Bash', command: 'gh pr create' })
  const turn = () => ($ as any).turn.complete({ answer: 'done', reason: 'answer', durationMs: 1, turnId: 't', isAborted: false })
  await turn()
  await new Promise(r => setTimeout(r, 50))
  expect(JSON.stringify(await render($))).not.toContain('merged')
  state = 'MERGED'
  await turn()
  await new Promise(r => setTimeout(r, 50))
  expect(JSON.stringify(await render($))).toContain('PR #7 merged')
  expect(prs()).toEqual([url])
})

// ---- the cleanup decisions, against a scripted git
const OID = 'a'.repeat(40)
const pr = { url, head: 'feat', oid: OID, base: 'main', isFork: false }

// A fake `$` over a scripted git. `tips` answers rev-parse and ls-remote; `fail` lists argv prefixes that exit 1.
const scripted = (o: { wt?: string; tips?: { local?: string; remote?: string }; here?: string; fail?: string[] }) => {
  const ran: string[] = []
  const wt = o.wt ?? 'worktree /repo\nHEAD x\nbranch refs/heads/main\n\nworktree /wt\nHEAD y\nbranch refs/heads/feat\n'
  const out = (stdout: string, exitCode = 0) => ({ exitCode, stdout, stderr: exitCode ? 'refused' : '' })
  const $: any = {
    session: { id: async () => 's1', root: async () => '/repo' },
    state: { get: async () => ({ value: [url] }), set: async () => ({}) },
    ui: { invalidate: () => {}, toast: () => {} },
    process: {
      run: async (argv: string[]) => {
        const cmd = argv.join(' ')
        ran.push(cmd)
        if (o.fail?.some(f => cmd.startsWith(f))) return out('', 1)
        if (cmd.startsWith('git worktree list')) return out(wt)
        if (cmd.startsWith('git rev-parse --show-toplevel')) return out(`${o.here ?? '/repo'}\n`)
        if (cmd.startsWith('git rev-parse --verify')) return out(o.tips?.local ? `${o.tips.local}\n` : '', o.tips?.local ? 0 : 1)
        if (cmd.startsWith('git ls-remote')) return out(o.tips?.remote ? `${o.tips.remote}\trefs/heads/feat\n` : '')
        return out('')
      },
    },
  }
  return { $, ran }
}

test('parses worktree list porcelain', () => {
  expect(sweepWorktrees('worktree /a\nHEAD x\nbranch refs/heads/m\n\nworktree /b\nHEAD y\ndetached\n')).toEqual([{ path: '/a', branch: 'm' }, { path: '/b', branch: undefined }])
})

test('removes the worktree, then deletes the local and remote branch when both sit at the merged commit', async () => {
  const { $, ran } = scripted({ tips: { local: OID, remote: OID } })
  await sweepClean($, pr)
  expect(ran).toContain('git worktree remove /wt')
  expect(ran).toContain('git pull --ff-only')
  expect(ran).toContain('git branch -D feat')
  expect(ran).toContain('git push origin --delete feat')
  expect(ran.some(c => c.includes('--force'))).toBe(false)
})

test('keeps a local branch with later commits and a remote that moved', async () => {
  const { $, ran } = scripted({ tips: { local: 'b'.repeat(40), remote: 'c'.repeat(40) } })
  await sweepClean($, pr)
  expect(ran.some(c => c.startsWith('git branch -D'))).toBe(false)
  expect(ran.some(c => c.startsWith('git push'))).toBe(false)
})

test('keeps a worktree git refuses to remove, and its branch', async () => {
  const { $, ran } = scripted({ tips: { local: OID, remote: OID }, fail: ['git worktree remove'] })
  await sweepClean($, pr)
  expect(ran.some(c => c.startsWith('git branch -D'))).toBe(false)
  expect(ran).toContain('git push origin --delete feat')
})

test('keeps the worktree the session stands in', async () => {
  const { $, ran } = scripted({ tips: { local: OID, remote: OID }, here: '/wt' })
  await sweepClean($, pr)
  expect(ran.some(c => c.startsWith('git worktree remove') || c.startsWith('git branch -D'))).toBe(false)
})

test('switches the main checkout to base and pulls before deleting its branch', async () => {
  const { $, ran } = scripted({ wt: 'worktree /repo\nHEAD x\nbranch refs/heads/feat\n', tips: { local: OID, remote: OID } })
  await sweepClean($, pr)
  expect(ran.indexOf('git switch main')).toBeLessThan(ran.indexOf('git pull --ff-only'))
  expect(ran.indexOf('git pull --ff-only')).toBeLessThan(ran.indexOf('git branch -D feat'))
})

test('never deletes the remote branch of a fork PR', async () => {
  const { $, ran } = scripted({ tips: { local: OID, remote: OID } })
  await sweepClean($, { ...pr, isFork: true })
  expect(ran.some(c => c.startsWith('git push'))).toBe(false)
})
