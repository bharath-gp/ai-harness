import type { Register } from 'claude-code'

type Mark = { kind: 'read' | 'write'; at: number }
type Row = { path: string; name: string; depth: number; isDir: boolean }

const HIDE = new Set(['.git', 'node_modules', '.DS_Store', '.next', 'dist', '__pycache__'])
const GLOW_MS = 8_000

const open = new Set<string>() // expanded dirs (absolute)
const marks = new Map<string, Mark>()
let selected = ''
let git = new Map<string, string>() // absolute path -> XY status
let root = ''

const redraw = ($: any) => $.ui.invalidate('ui.render')

const refreshGit = async ($: any) => {
  const r = await $.process.run(['git', 'status', '--porcelain'], { cwd: root, timeoutMs: 5000 }).catch(() => undefined)
  git = new Map()
  if (r?.exitCode === 0) {
    const top = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { cwd: root }).catch(() => undefined)
    const base = top?.exitCode === 0 ? top.stdout.trim() : root
    for (const line of r.stdout.split('\n')) if (line.length > 3) git.set(`${base}/${line.slice(3).replace(/^"|"$/g, '')}`, line.slice(0, 2).trim() || '?')
  }
  redraw($)
}

const mark = ($: any, path: string | undefined, kind: Mark['kind']) => {
  if (!path) return
  const abs = path.startsWith('/') ? path : `${root}/${path}`
  marks.set(abs, { kind, at: Date.now() })
  // reveal: open every parent folder under root
  for (let d = abs.slice(0, abs.lastIndexOf('/')); d.length > root.length; d = d.slice(0, d.lastIndexOf('/'))) open.add(d)
  redraw($)
  if (kind === 'write') void refreshGit($)
}

const rows = async ($: any, dir: string, depth: number, out: Row[]) => {
  const entries = (await $.fs.list(dir).catch(() => [])).filter((x: any) => !HIDE.has(x.name))
  entries.sort((a: any, b: any) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1))
  for (const x of entries) {
    const path = `${dir}/${x.name}`
    out.push({ path, name: x.name, depth, isDir: x.kind === 'dir' })
    if (x.kind === 'dir' && open.has(path)) await rows($, path, depth + 1, out)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    root = await $.session.cwd()
    await $.command.register({ name: 'filetree', description: 'Open the file tree pane' })
    void refreshGit($)
    $.clock.every(10_000, () => void refreshGit($))
    $.clock.every(2_000, () => marks.size && redraw($)) // fade highlights
    return next(e)
  })

  on('command.run', { command: 'filetree' }, async $ => {
    await $.ui.open({ id: 'filetree', title: 'Files' })
    return { text: 'File tree opened.' }
  })

  on('tool.call', ($, e, next) => {
    const p = (e as { file_path?: string; path?: string }).file_path ?? (e as { path?: string }).path
    if (['Read', 'Grep', 'Glob'].includes(String(e.tool))) mark($, p, 'read')
    else if (['Edit', 'Write', 'NotebookEdit'].includes(String(e.tool))) mark($, p, 'write')
    return next(e)
  })

  // selected file goes to Claude as context; @path mentions reveal the file
  on('prompt.submit', ($, e, next) => {
    for (const m of e.text.matchAll(/@([\w./-]+)/g)) {
      const abs = `${root}/${m[1]}`
      if (git.has(abs) || m[1].includes('/') || m[1].includes('.')) mark($, m[1], 'read')
    }
    return selected ? next({ ...e, context: [...(e.context ?? []), `The user has ${selected} selected in the file tree.`] }) : next(e)
  })

  on('ui.render', { component: 'Pane', requestId: 'filetree' }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list: Row[] = []
    await rows($, root, 0, list)
    const room = Math.max(3, (e.viewport?.rows ?? 30) - 4)
    const idx = Math.max(0, list.findIndex(r => r.path === selected))
    const from = Math.max(0, Math.min(idx - Math.floor(room / 2), list.length - room))
    const now = Date.now()

    return (
      <Box flexDirection="column">
        <Text dimColor>{root.split('/').slice(-2).join('/')}  ({git.size} changed)</Text>
        {list.slice(from, from + room).map(r => {
          const m = marks.get(r.path)
          const glow = m && now - m.at < GLOW_MS ? (m.kind === 'write' ? 'warning' : 'suggestion') : undefined
          const st = git.get(r.path) ?? ([...git.keys()].some(k => k.startsWith(`${r.path}/`)) ? '•' : '')
          return (
            <Button
              key={r.path}
              plain
              onPress={() => {
                if (r.isDir) open.has(r.path) ? open.delete(r.path) : open.add(r.path)
                else selected = selected === r.path ? '' : r.path
                redraw($)
              }}
            >
              <Text inverse={r.path === selected} color={glow ?? (st ? 'diffAdded' : undefined)} bold={!!glow}>
                {'  '.repeat(r.depth)}{r.isDir ? (open.has(r.path) ? '▾ ' : '▸ ') : '  '}{r.name}
              </Text>
              {st && <Text dimColor> {st}</Text>}
            </Button>
          )
        })}
      </Box>
    )
  })
}
