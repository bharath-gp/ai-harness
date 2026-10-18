import { expect, test } from 'claude-code/testing'
import { parsePorcelain } from './ui'

test('parses -z status: renames carry an extra field, odd names stay intact', () => {
  const out = ' M a.ts\0R  new name.ts\0old.ts\0?? é.md\0'
  expect(parsePorcelain(out)).toEqual([
    { st: ' M', path: 'a.ts' },
    { st: 'R ', path: 'new name.ts' },
    { st: '??', path: 'é.md' },
  ])
})
