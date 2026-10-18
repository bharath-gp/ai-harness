import { expect, test } from 'claude-code/testing'
import { RISKY } from './register'

const held = (cmd: string) => RISKY.some(([re]) => re.test(cmd))

test('lets safe commands through', async ($, on) => {
  on('tool.call', { tool: 'Bash' }, () => ({ result: {}, text: 'ran' }) as never)
  const r = await $.tool.call({ tool: 'Bash', command: 'git status' })
  expect(r.deny).toBeUndefined()
})

test('holds destructive spellings, including -R, long flags and +refspec', () => {
  for (const c of ['rm -rf dist', 'rm -r dist', 'rm -R dist', 'rm --recursive --force dist', 'git push -f', 'git push origin +main', 'git push --delete origin main', 'git reset --hard', 'git branch -D x'])
    expect(held(c)).toBe(true)
})

test('does not hold harmless commands', () => {
  for (const c of ['rm file.txt', 'git push origin main', 'git status', 'ls -la'])
    expect(held(c)).toBe(false)
})
