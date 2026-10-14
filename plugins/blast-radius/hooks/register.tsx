import type { Register } from 'claude-code'

import { folderIcon, iconTile } from './kit'
import { bar, fit, isRich, P, svg } from './ui'

// Destructive shell patterns worth a human look: [pattern, what it does].
const RISKY: [RegExp, string][] = [
  [/\brm\s+(-[a-zA-Z]*[rf][a-zA-Z]*\s+)+/, 'delete'],
  [/\bgit\s+push\b[^\n;&|]*(--force\b|--force-with-lease\b|\s-f\b)/, 'force-push'],
  [/\bgit\s+reset\s+--hard\b/, 'discard'],
  [/\bgit\s+clean\s+-[a-zA-Z]*f/, 'discard'],
  [/\bgit\s+(checkout|restore)\s+(--\s+)?\.(\s|$)/, 'discard'],
  [/\bgit\s+branch\s+-D\b/, 'force-delete a branch'],
  [/\b(mkfs|dd\s+if=)/, 'overwrite a device'],
  [/\bfind\b[^\n]*\s-delete\b/, 'delete'],
  [/\bDROP\s+(TABLE|DATABASE)\b/i, 'drop a database object'],
]

type File = { path: string; size: number; tracked: boolean }
type Impact = { cmd: string; verb: string; project: string; files: File[]; total: number; untracked: number; note: string }

let pending: Impact | undefined

const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB` : `${(n / 1048576).toFixed(1)} MB`)
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

// Every file under `path`, with sizes (capped: a node_modules rm should not take a minute).
const collect = async ($: any, path: string, out: File[]): Promise<void> => {
  const st = await $.fs.stat(path).catch(() => undefined)
  if (!st) return
  if (st.kind !== 'dir') {
    out.push({ path, size: st.size, tracked: false })
    return
  }
  for (const x of await $.fs.list(path).catch(() => [])) {
    if (out.length >= 3000) return
    if (x.kind === 'dir') await collect($, `${path}/${x.name}`, out)
    else out.push({ path: `${path}/${x.name}`, size: x.size, tracked: false })
  }
}

// `rm -rf build dist` -> ['build', 'dist']; no globbing or quoting tricks, just the plain case.
const rmTargets = (cmd: string) => {
  const m = /\brm\s+(?:-[a-zA-Z-]+\s+)+([^;&|\n]+)/.exec(cmd)
  return (m?.[1] ?? '').split(/\s+/).map(t => t.replace(/^['"]|['"]$/g, '')).filter(t => t && !t.startsWith('-'))
}

const assess = async ($: any, cmd: string, verb: string): Promise<Impact> => {
  const cwd: string = await $.session.cwd()
  const impact: Impact = { cmd, verb, project: cwd.slice(cwd.lastIndexOf('/') + 1), files: [], total: 0, untracked: 0, note: '' }
  if (verb === 'delete' && /\brm\b/.test(cmd)) {
    for (const t of rmTargets(cmd)) await collect($, t.startsWith('/') ? t : `${cwd}/${t}`, impact.files)
    const tracked = await $.process.run(['git', 'ls-files', '-z'], { cwd, timeoutMs: 8000 }).catch(() => undefined)
    const set = new Set<string>((tracked?.stdout ?? '').split('\0').filter(Boolean).map((p: string) => `${cwd}/${p}`))
    for (const f of impact.files) f.tracked = set.has(f.path)
  } else if (verb === 'discard') {
    const st = await $.process.run(['git', 'status', '--short'], { cwd, timeoutMs: 5000 }).catch(() => undefined)
    for (const l of (st?.stdout ?? '').split('\n').filter(Boolean)) {
      const p = `${cwd}/${l.slice(3)}`
      const s = await $.fs.stat(p).catch(() => undefined)
      impact.files.push({ path: p, size: s?.size ?? 0, tracked: false }) // uncommitted work is not saved anywhere
    }
  }
  impact.total = impact.files.reduce((n, f) => n + f.size, 0)
  impact.untracked = impact.files.filter(f => !f.tracked).length
  impact.note =
    impact.files.length === 0
      ? verb === 'force-push' ? 'This rewrites history on the remote. Others who pulled it will have to recover.' : 'This cannot be undone from inside the session.'
      : impact.untracked === 0
        ? 'All of these are tracked by git: you can restore them with git checkout.'
        : impact.untracked === impact.files.length
          ? "None of these are tracked by git, so they can't be restored."
          : `${plural(impact.untracked, 'file')} of these are not tracked by git, so they can't be restored.`
  return impact
}

// Group files by folder, biggest folder first.
const groups = (files: File[], project: string) => {
  const by = new Map<string, File[]>()
  for (const f of files) {
    const dir = f.path.slice(0, f.path.lastIndexOf('/'))
    by.set(dir, [...(by.get(dir) ?? []), f])
  }
  const rel = (d: string) => (d.includes(`/${project}/`) ? d.slice(d.indexOf(`/${project}/`) + project.length + 2) : d)
  return [...by.entries()]
    .map(([dir, fs]) => ({ dir: `${rel(dir)}/`, files: fs.sort((a, b) => b.size - a.size), size: fs.reduce((n, f) => n + f.size, 0) }))
    .sort((a, b) => b.size - a.size)
}

const drawCard = (ui: any, e: any, i: Impact) => {
  const { Box, Text } = ui
  const rich = isRich(ui, e)
  const n = i.files.length
  const g = groups(i.files, i.project)
  const top = g.slice(0, 2)
  const shownFiles = top.reduce((c, x) => c + Math.min(5, x.files.length), 0)
  const hiddenFiles = n - shownFiles
  const hiddenSize = i.total - top.reduce((s, x) => s + x.files.slice(0, 5).reduce((a, f) => a + f.size, 0), 0)
  const W = 90
  const meter = (pct: number) => (rich ? <ui.Svg source={svg(W, 8, bar(0, 1, W, 6, pct, '#9aa0aa'))} alt="" width={W} height={8} /> : <Text color={P.muted}>{'▰'.repeat(Math.max(1, Math.round(pct / 10)))}</Text>)
  const act = i.verb === 'delete' ? 'will delete' : i.verb === 'discard' ? 'will discard' : `will ${i.verb}`

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="#4a3030" paddingX={2} paddingY={1} gap={1}>
      <Box flexDirection="row" gap={2} alignItems="center">
        {iconTile(ui, e, i.verb === 'delete' ? '🗑' : '⚠', P.err, 52)}
        <Box flexDirection="column">
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            <Text bold>{i.cmd.length > 60 ? `${i.cmd.slice(0, 59)}…` : i.cmd}</Text>
            <Text color={P.muted}>{act}</Text>
            {n > 0 ? (
              <Box borderStyle="round" borderColor="#f97316" paddingX={1}>
                <Text bold color="#fb923c">{`${plural(n, 'file')} · ${fmtSize(i.total)}`}</Text>
              </Box>
            ) : null}
          </Box>
          <Text color={P.muted}>{`in ${i.project}`}</Text>
        </Box>
      </Box>
      <Box flexDirection="row" gap={1} borderStyle="round" borderColor="#6a3a3a" backgroundColor="#33201f" paddingX={1}>
        <Text color="#f0a0a0">{`⛨ ${i.note}`}</Text>
      </Box>
      {top.map(grp => (
        <Box key={grp.dir} flexDirection="column">
          <Box flexDirection="row" gap={1} alignItems="center">
            {folderIcon(ui, e, '#9aa0aa')}
            <Text bold>{grp.dir}</Text>
            <Box flexGrow={1} />
            <Text color={P.muted}>{plural(grp.files.length, 'file')}</Text>
            <Text bold>{fmtSize(grp.size)}</Text>
            {meter(i.total ? (grp.size / i.total) * 100 : 0)}
          </Box>
          {grp.files.slice(0, 5).map(f => (
            <Box key={f.path} flexDirection="row" gap={1} paddingLeft={3} alignItems="center">
              <Text color={P.muted}>▫</Text>
              <Text backgroundColor="#5a3a1a" color="#f3d2b0">{` ${f.path.slice(f.path.lastIndexOf('/') + 1)} `}</Text>
              <Box flexGrow={1} />
              <Text color={P.muted}>{fmtSize(f.size)}</Text>
              {meter(i.total ? (f.size / i.total) * 100 : 0)}
            </Box>
          ))}
        </Box>
      ))}
      {hiddenFiles > 0 ? <Text color={P.muted}>{`+ ${plural(hiddenFiles, 'more file')} · ${fmtSize(Math.max(0, hiddenSize))}`}</Text> : null}
    </Box>
  )
}

export const register: Register = on => {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const hit = RISKY.find(([re]) => re.test(e.command))
    if (!hit) return next(e)

    pending = await assess($, e.command.trim(), hit[1])
    const n = pending.files.length
    const proceed = n > 0 ? `${hit[1] === 'delete' ? 'Delete' : 'Discard'} ${plural(n, 'file')}` : 'Proceed'
    let answer: string
    try {
      answer = await $.ui.ask(`Blast Radius is holding this command: ${e.command.slice(0, 200)}`, { header: 'Blast Radius', options: [proceed, 'Cancel'] })
    } finally {
      pending = undefined
    }
    return answer === proceed ? next(e) : { deny: `${$.plugin.name}: user cancelled (${hit[1]}).` }
  }).catch(($, e, next) =>
    // ask rejects when nobody can answer (-p run): refuse rather than run it
    next.called ? next(e) : { deny: `${$.plugin.name}: could not confirm a destructive command.` },
  )

  // The impact card goes above the engine's own dialog, which keeps its Delete / Cancel buttons.
  on('ui.render', { component: 'AskUserQuestion' }, async ($, e, next) => {
    const q = (e.props.questions as { header?: string }[] | undefined)?.[0]
    if (!pending || q?.header !== 'Blast Radius') return next(e)
    const { Box } = $.ui.resolve(e)
    return (
      <Box flexDirection="column" gap={1}>
        {drawCard($.ui.resolve(e), e, pending)}
        {await next(e)}
      </Box>
    )
  })
}
