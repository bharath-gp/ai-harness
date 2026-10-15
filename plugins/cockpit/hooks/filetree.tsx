import { band } from './band'
import { fileBadge, folderIcon, iconTile, pill, sectionLabel, panel } from './kit'
import { below, isRich, P, RAMP } from './ui'

type State = 'reading' | 'opened' | 'editing' | 'edited' | 'committed'
type Row = { path: string; name: string; depth: number; isDir: boolean; size: number; mtime: number }
type Change = { st: string; add: number; del: number }
type Activity = { state: State; label: string; target: string; running: boolean; at: number; failed?: boolean }
type Touch = { state: State; at: number }

const HIDE = new Set(['node_modules', '.DS_Store', '.next', 'dist', '__pycache__', '.venv'])
const GLOW_MS = 9_000
const MAX_ROWS = 300
// One colour family per kind of activity: purple reads, orange edits, green commits (as in the video).
const FAMILY: Record<State, { fg: string; bg: string; ramp: string[]; label: string }> = {
  reading: { fg: '#c084fc', bg: '#2a2140', ramp: RAMP.purple, label: 'Reading' },
  opened: { fg: '#c084fc', bg: '#2a2140', ramp: RAMP.purple, label: 'Opened' },
  editing: { fg: '#fb923c', bg: '#3a2a16', ramp: RAMP.orange, label: 'Editing' },
  edited: { fg: '#fb923c', bg: '#3a2a16', ramp: RAMP.orange, label: 'Edited' },
  committed: { fg: '#4ade80', bg: '#16301f', ramp: RAMP.green, label: 'Committed' },
}
const GIT_COLOR: Record<string, string> = { M: P.warn, T: P.warn, A: P.ok, '?': P.ok, R: P.info, C: P.info, D: P.err, U: P.err }
const COMMITTED = '#4ade80'
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

const open = new Set<string>() // expanded dirs (absolute)
const touched = new Map<string, Touch>()
let cwd = ''
let root = ''
let selected = ''
let query = ''
let showSize = false
let showHidden = true
let changes = new Map<string, Change>() // absolute path -> change
let branch = ''
let upstream = ''
let ahead = 0
let behind = 0
let list: Row[] = []
let allFiles: Row[] | undefined // flat index for search, built on first use
let activity: Activity | undefined
let phase = 0
let ticking = false
let dismissed = false
let committedSet = new Set<string>() // files in commits not pushed yet (or the last commit)
const seen = new Set<string>() // changed files already auto-expanded once

function redraw($: any) { return $.ui.invalidate('ui.render') }
const rel = (p: string) => (p.startsWith(`${root}/`) ? p.slice(root.length + 1) : p)
const dirOf = (p: string) => p.slice(0, p.lastIndexOf('/'))
const base = (p: string) => p.slice(p.lastIndexOf('/') + 1)
const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB` : `${(n / 1048576).toFixed(1)} MB`)
const ago = (ms: number) => {
  const m = Math.floor(ms / 60_000)
  return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.floor(m / 60)}h ago` : `${Math.floor(m / 1440)}d ago`
}
// Git state in words, not letters: "new", "modified", "deleted".
const WORD: Record<string, string> = { '?': 'new', A: 'new', M: 'modified', T: 'modified', D: 'deleted', R: 'renamed', C: 'copied', U: 'conflict' }

async function refreshGit($: any) {
  const st = await $.process.run(['git', 'status', '-sb', '--porcelain'], { cwd: root, timeoutMs: 5000 }).catch(() => undefined)
  changes = new Map()
  branch = upstream = ''
  ahead = behind = 0
  if (st?.exitCode === 0) {
    const top = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { cwd: root }).catch(() => undefined)
    const b = top?.exitCode === 0 ? top.stdout.trim() : root
    const lines: string[] = st.stdout.split('\n')
    const head = /^## (\S+?)(?:\.\.\.(\S+))?(?: \[(.+)\])?$/.exec(lines[0] ?? '')
    branch = head?.[1] ?? ''
    upstream = head?.[2] ?? ''
    ahead = Number(/ahead (\d+)/.exec(head?.[3] ?? '')?.[1] ?? 0)
    behind = Number(/behind (\d+)/.exec(head?.[3] ?? '')?.[1] ?? 0)
    for (const line of lines.slice(1)) if (line.length > 3) changes.set(`${b}/${line.slice(3).replace(/^"|"$/g, '')}`, { st: line.slice(0, 2).trim()[0] ?? '?', add: 0, del: 0 })
    const ns = await $.process.run(['git', 'diff', '--numstat', 'HEAD'], { cwd: root, timeoutMs: 5000 }).catch(() => undefined)
    for (const l of (ns?.stdout ?? '').split('\n')) {
      const [a, d, p] = l.split('\t')
      const c = p && changes.get(`${b}/${p}`)
      if (c) Object.assign(c, { add: Number(a) || 0, del: Number(d) || 0 })
    }
  }
  // Committed but not pushed: what the branch has that its upstream has not (else just the last commit).
  committedSet = new Set()
  if (branch) {
    const top = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { cwd: root }).catch(() => undefined)
    const b = top?.exitCode === 0 ? top.stdout.trim() : root
    const range = upstream ? [`${upstream}..HEAD`] : ['HEAD~1', 'HEAD']
    const cm = await $.process.run(['git', 'diff', '--name-only', ...range], { cwd: root, timeoutMs: 5000 }).catch(() => undefined)
    for (const f of (cm?.exitCode === 0 ? cm.stdout : '').split('\n').filter(Boolean)) if (!changes.has(`${b}/${f}`)) committedSet.add(`${b}/${f}`)
  }
  await expandRecent($)
  redraw($)
}

// Open the folders of the files that changed most recently, so nested changes are visible without hunting.
// Each file is expanded once: a folder you collapse yourself stays collapsed until something new changes.
async function expandRecent($: any) {
  const fresh = [...changes.keys(), ...committedSet].filter(f => !seen.has(f) && f.startsWith(`${root}/`))
  for (const f of fresh) seen.add(f)
  const dated = await Promise.all(fresh.map(async f => ({ f, t: (await $.fs.stat(f).catch(() => undefined))?.mtimeMs ?? 0 })))
  for (const { f } of dated.sort((a, b) => b.t - a.t).slice(0, 12)) for (let d = dirOf(f); d.length > root.length; d = dirOf(d)) open.add(d)
  await rebuild($)
}

async function walk($: any, dir: string, depth: number, out: Row[], expand: (p: string) => boolean) {
  const entries = (await $.fs.list(dir).catch(() => [])).filter((x: any) => !HIDE.has(x.name) && (showHidden ? x.name !== '.DS_Store' : !x.name.startsWith('.')))
  entries.sort((a: any, b: any) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1))
  for (const x of entries) {
    if (out.length >= 2500) return
    const path = `${dir}/${x.name}`
    out.push({ path, name: x.name, depth, isDir: x.kind === 'dir', size: x.size, mtime: x.mtimeMs })
  }
}

async function rebuild($: any) {
  if (query) {
    allFiles ??= await (async () => {
      const out: Row[] = []
      await walk($, root, 0, out, () => true)
      return out.filter(r => !r.isDir)
    })()
    const q = query.toLowerCase()
    list = allFiles.filter(r => r.path.toLowerCase().includes(q)).slice(0, MAX_ROWS)
  } else {
    const out: Row[] = []
    await walk($, root, 0, out, p => open.has(p))
    list = out
  }
  redraw($)
}

function startTick($: any) {
  if (ticking) return
  ticking = true
  const loop = () => {
    const live = activity?.running || [...touched.values()].some(m => Date.now() - m.at < GLOW_MS)
    phase += 1
    redraw($)
    if (live) $.clock.after(130, loop)
    else ticking = false
  }
  $.clock.after(130, loop)
}

function touch($: any, path: string | undefined, state: State) {
  if (!path) return
  const abs = path.startsWith('/') ? path : `${root}/${path}`
  touched.set(abs, { state, at: Date.now() })
  dismissed = false // a new touch brings the band back
  for (let d = dirOf(abs); d.length > root.length; d = dirOf(d)) open.add(d)
  if (state === 'edited' || state === 'editing') allFiles = undefined
  void rebuild($)
  startTick($)
}

function say($: any, a: Activity) {
  activity = a
  startTick($)
  redraw($)
}

// Per-character shimmer: a bright band sweeping along the name.
const shimmer = (i: number, len: number, ramp: string[]) => {
  const band = ((phase * 1.4) % (len + 8)) - 4
  const d = Math.abs(i - band)
  return ramp[d < 0.8 ? 3 : d < 1.8 ? 2 : d < 2.8 ? 1 : 0] ?? ramp[0]
}

const counts = (dir: string) => {
  let n = 0
  let m = 0
  let d = 0
  let c = 0
  for (const [k, ch] of changes) {
    if (!k.startsWith(`${dir}/`)) continue
    if (ch.st === 'D') d += 1
    else if (ch.st === 'M' || ch.st === 'T') m += 1
    else n += 1
  }
  for (const k of committedSet) if (k.startsWith(`${dir}/`)) c += 1
  return { n, m, d, c }
}

// What every drawing needs from the hook: the callbacks (they close over `$`, which cannot cross an import
// but never leaves this file) and nothing else; state is read from the module.
type Actions = {
  toggle: (r: Row) => void
  reveal: (path: string) => void
  search: (q: string) => void
  refresh: () => void
  collapse: () => void
  size: () => void
  hidden: () => void
  up: () => void
  home: () => void
  unselect: () => void
}

// A tinted row is one Claude is working on right now (or did in the last few seconds), or just committed.
const rowState = (path: string, now: number): Touch | undefined => {
  const t = touched.get(path)
  return t && (now - t.at < GLOW_MS || t.state === 'reading' || t.state === 'editing') ? t : undefined
}

const nameEl = (ui: any, r: Row, name: string, t: Touch | undefined, own: Change | undefined, isSel: boolean) => {
  const { Text } = ui
  if (t) {
    const fam = FAMILY[t.state]
    return [...name].map((c, i) => <Text bold color={shimmer(i, name.length, fam.ramp)}>{c}</Text>)
  }
  const gc = own ? GIT_COLOR[own.st] : undefined
  return <Text color={gc ?? (r.name.startsWith('.') ? P.muted : undefined)} bold={isSel || r.isDir} strikethrough={own?.st === 'D'}>{name}</Text>
}

const heroOf = (now: number) => {
  const a = activity
  if (a && (a.running || now - a.at < 6_000)) {
    const fam = FAMILY[a.state]
    return { glyph: a.state === 'committed' ? '⎇' : a.state === 'reading' || a.state === 'opened' ? '◉' : '✎', color: fam.fg, head: a.label, sub: a.target ? `in ${a.target}` : '' }
  }
  return { glyph: '◌', color: P.muted, head: 'Claude is idle', sub: a ? `last: ${a.label.toLowerCase()}` : 'nothing touched yet' }
}

const drawRich = (ui: any, e: any, a: Actions) => {
  const { Box, Text, Button, Input } = ui
  const now = Date.now()
  const hero = heroOf(now)
  const addAll = [...changes.values()].reduce((n, c) => n + c.add, 0)
  const delAll = [...changes.values()].reduce((n, c) => n + c.del, 0)
  const recent = [...touched.entries()].sort((x, y) => y[1].at - x[1].at)
  const shown = list.slice(0, MAX_ROWS)
  const btn = (key: string, label: string, onPress: () => void) => <Button key={key} label={label} onPress={onPress} />

  return (
    <Box flexDirection="column" gap={1}>
      {panel(
        ui,
        <Box flexDirection="column" paddingY={1} gap={1}>
          <Box flexDirection="row" gap={2} alignItems="center">
            {iconTile(ui, e, hero.glyph, hero.color, 54)}
            <Box flexDirection="column">
              <Text bold color={hero.color}>{activity?.running || (activity && now - activity.at < 6_000) ? 'RIGHT NOW' : 'STATUS'}</Text>
              <Text bold>{hero.head}</Text>
              <Text color={P.muted}>{hero.sub}</Text>
            </Box>
          </Box>
          <Text color="#30343c">{'─'.repeat(Math.max(10, (e.props.bodyColumns ?? 40) - 6))}</Text>
          <Box flexDirection="row">
            <Text color={P.info}>⎇ </Text>
            <Text bold>{branch || base(root)}</Text>
            {ahead > 0 ? <Text color={P.teal}>{` ↑${ahead}`}</Text> : null}
            {behind > 0 ? <Text color={P.info}>{` ↓${behind}`}</Text> : null}
            <Box flexGrow={1} />
            <Text color={P.muted}>{changes.size === 0 ? (committedSet.size ? `${committedSet.size} committed, nothing uncommitted` : 'clean, nothing changed') : `${changes.size} not committed${committedSet.size ? ` · ${committedSet.size} committed` : ''}`}</Text>
            {addAll + delAll > 0 ? <Text color={P.muted}>{' · lines '}<Text color={P.ok}>{`+${addAll}`}</Text><Text color={P.err}>{` −${delAll}`}</Text></Text> : null}
          </Box>
          <Box flexDirection="row" gap={2} flexWrap="wrap">
            <Text color={FAMILY.reading.fg}>● <Text color={undefined}>Claude read</Text></Text>
            <Text color={FAMILY.editing.fg}>● <Text color={undefined}>Claude edited</Text></Text>
          </Box>
          <Box flexDirection="row" gap={2} flexWrap="wrap">
            <Text color={P.muted}>Not committed:</Text>
            <Text color={P.ok}>● <Text color={undefined}>new</Text></Text>
            <Text color={P.warn}>● <Text color={undefined}>modified</Text></Text>
            <Text color={P.err}>● <Text color={undefined}>deleted</Text></Text>
            <Text color={P.muted}>Committed, not pushed:</Text>
            <Text color={COMMITTED}>● <Text color={undefined}>committed</Text></Text>
          </Box>
        </Box>,
        { color: '#30343c' },
      )}
      <Box borderStyle="round" borderColor="#30343c" paddingX={1}>
        <Input key="q" label="⌕ " placeholder="Find a file" value={query} onInput={(v: string) => a.search(v)} onSubmit={() => undefined} />
      </Box>
      <Box flexDirection="row" flexWrap="wrap" gap={1}>
        {btn('refresh', 'Refresh', a.refresh)}
        {btn('collapse', 'Collapse all', a.collapse)}
        {btn('size', showSize ? 'Show dates' : 'Show sizes', a.size)}
        {btn('up', 'Up a folder', a.up)}
        {btn('home', 'Back to project', a.home)}
        {btn('hidden', showHidden ? 'Hide hidden files' : 'Show hidden files', a.hidden)}
        {selected ? btn('unselect', 'Clear selection', a.unselect) : null}
      </Box>
      {recent.length
        ? panel(
            ui,
            <Box flexDirection="column" paddingY={1}>
              {sectionLabel(ui, 'Claude touched', `${recent.length} file${recent.length > 1 ? 's' : ''}`)}
              {recent.slice(0, 6).map(([path, t]) => (
                <Box key={`t:${path}`} flexDirection="row" alignItems="center" gap={1} paddingY={0}>
                  {fileBadge(ui, e, base(path))}
                  <Button key={`tb:${path}`} plain onPress={() => a.reveal(path)}>
                    <Text bold>{base(path)}</Text>
                    <Text color={P.muted}>{` ${base(dirOf(path))}`}</Text>
                  </Button>
                  <Box flexGrow={1} />
                  {pill(ui, e, FAMILY[t.state].label, FAMILY[t.state].fg)}
                </Box>
              ))}
            </Box>,
            { color: '#30343c' },
          )
        : null}
      {sectionLabel(ui, 'All files', base(root))}
      <Box flexDirection="column">
        {shown.length === 0 ? <Text color={P.muted}>{query ? 'no matches' : 'empty'}</Text> : null}
        {shown.map(r => {
          const t = rowState(r.path, now)
          const own = changes.get(r.path)
          const dc = r.isDir ? counts(r.path) : undefined
          const dirty = dc && dc.n + dc.m + dc.d + dc.c > 0
          const isSel = r.path === selected
          const fam = t ? FAMILY[t.state] : undefined
          const kids = r.isDir ? [...touched.entries()].find(([p, tt]) => p.startsWith(`${r.path}/`) && rowState(p, now)) : undefined
          const name = query ? rel(r.path) : r.name
          return (
            <Box key={r.path} flexDirection="row" alignItems="center" gap={1} paddingX={1} backgroundColor={fam ? fam.bg : isSel ? P.selection : undefined}>
              <Text>{query ? '' : '  '.repeat(r.depth)}</Text>
              {r.isDir ? <Button key={`c:${r.path}`} plain dimColor label={open.has(r.path) ? '▾' : '▸'} onPress={() => a.toggle(r)} /> : <Text> </Text>}
              {r.isDir ? folderIcon(ui, e, kids ? FAMILY[rowState(kids[0], now)!.state].fg : r.name.startsWith('.') ? P.muted : '#61afef') : fileBadge(ui, e, r.name)}
              <Button key={`b:${r.path}`} plain onPress={() => a.toggle(r)}>
                {nameEl(ui, r, name, t ?? (kids ? rowState(kids[0], now) : undefined), own, isSel)}
              </Button>
              <Box flexGrow={1} />
              {t ? (
                pill(ui, e, t.state === 'committed' ? 'committed' : FAMILY[t.state].label.toLowerCase(), fam!.fg)
              ) : (
                <Box flexDirection="row" gap={1}>
                  {dirty && dc.n > 0 ? <Text color={P.ok}>{`${dc.n} new`}</Text> : null}
                  {dirty && dc.m > 0 ? <Text color={P.warn}>{`${dc.m} modified`}</Text> : null}
                  {dirty && dc.d > 0 ? <Text color={P.err}>{`${dc.d} deleted`}</Text> : null}
                  {dirty && dc.c > 0 ? <Text color={COMMITTED}>{`${dc.c} committed`}</Text> : null}
                  {!own && !r.isDir && committedSet.has(r.path) ? <Text bold color={COMMITTED}>committed</Text> : null}
                  {own && own.add + own.del > 0 ? <Text color={P.muted}>{'lines '}<Text color={P.ok}>{`+${own.add}`}</Text><Text color={P.err}>{` −${own.del}`}</Text></Text> : null}
                  {own ? <Text bold color={GIT_COLOR[own.st]}>{WORD[own.st] ?? own.st}</Text> : null}
                  <Text color={P.muted}>{showSize ? (r.isDir ? '' : fmtSize(r.size)) : r.isDir ? '' : ago(now - r.mtime)}</Text>
                </Box>
              )}
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}

// Terminal: dense one-line rows, the claude-code-filetree way.
const drawText = (ui: any, e: any, a: Actions) => {
  const { Box, Text, Button, Input } = ui
  const now = Date.now()
  const room = Math.max(5, (e.viewport?.rows ?? 30) - 8)
  const idx = Math.max(0, list.findIndex(r => r.path === selected))
  const from = Math.max(0, Math.min(idx - Math.floor(room / 2), list.length - room))
  const act = activity && (activity.running || now - activity.at < GLOW_MS) ? activity : undefined
  const addAll = [...changes.values()].reduce((n, c) => n + c.add, 0)
  const delAll = [...changes.values()].reduce((n, c) => n + c.del, 0)
  const all = counts(root)
  const hdr = (id: string, label: string, dim: boolean, onPress: () => void) => <Button key={id} plain dimColor={dim} label={label} onPress={onPress} />
  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Text bold color={P.accent} wrap="truncate-start">{base(root)}</Text>
        <Box flexGrow={1} />
        <Box flexDirection="row" gap={1}>
          {hdr('refresh', '↻', true, a.refresh)}
          {hdr('size', 'Σ', !showSize, a.size)}
          {hdr('collapse', '⊟', true, a.collapse)}
          {hdr('up', '↑', true, a.up)}
          {selected ? hdr('unselect', '⊘', false, a.unselect) : null}
          <Text> </Text>
        </Box>
      </Box>
      {branch ? (
        <Box flexDirection="row">
          <Text bold color={P.accent}>{`⎇ ${branch}`}</Text>
          {ahead > 0 ? <Text color={P.teal}>{` ↑${ahead}`}</Text> : null}
          {behind > 0 ? <Text color={P.info}>{` ↓${behind}`}</Text> : null}
          <Text color={P.muted} wrap="truncate-end">{upstream ? ` ${upstream}` : ''}</Text>
          <Box flexGrow={1} />
          {addAll > 0 ? <Text color={P.ok}>{` +${addAll}`}</Text> : null}
          {delAll > 0 ? <Text color={P.err}>{` -${delAll}`}</Text> : null}
          {all.n > 0 ? <Text color={P.ok}>{` ${all.n} new`}</Text> : null}
          {all.m > 0 ? <Text color={P.warn}>{` ${all.m} mod`}</Text> : null}
          {all.d > 0 ? <Text color={P.err}>{` ${all.d} del`}</Text> : null}
          {changes.size === 0 ? <Text color={P.muted}> clean</Text> : null}
        </Box>
      ) : null}
      <Input key="q" label="/ " placeholder="search" value={query} onInput={(v: string) => a.search(v)} onSubmit={() => undefined} />
      {list.length === 0 ? <Text color={P.muted}>{query ? 'no matches' : 'empty'}</Text> : null}
      {list.slice(from, from + room).map(r => {
        const t = rowState(r.path, now)
        const own = changes.get(r.path)
        const dc = r.isDir ? counts(r.path) : undefined
        const isSel = r.path === selected
        const gc = own ? GIT_COLOR[own.st] : undefined
        return (
          <Box key={r.path} flexDirection="row" height={1} overflow="hidden" backgroundColor={t ? FAMILY[t.state].bg : isSel ? P.selection : undefined}>
            <Button key={`b:${r.path}`} plain onPress={() => a.toggle(r)}>
              <Text>{query ? '' : '  '.repeat(r.depth)}</Text>
              <Text color={P.muted}>{r.isDir ? (open.has(r.path) ? '▾ ' : '▸ ') : '  '}</Text>
              <Text color={t ? FAMILY[t.state].fg : (gc ?? (r.isDir ? P.accent : P.muted))}>{r.isDir ? '■ ' : '· '}</Text>
              {nameEl(ui, r, query ? rel(r.path) : r.name, t, own, isSel)}
            </Button>
            <Box flexGrow={1} />
            <Box flexDirection="row" flexShrink={0}>
              <Text color={P.muted}>{r.isDir ? '' : ` ${showSize ? fmtSize(r.size) : ago(now - r.mtime)}`}</Text>
              {own && own.add > 0 ? <Text color={P.ok}>{` +${own.add}`}</Text> : null}
              {own && own.del > 0 ? <Text color={P.err}>{` −${own.del}`}</Text> : null}
              {dc && dc.n > 0 ? <Text color={P.ok}>{` ${dc.n} new`}</Text> : null}
              {dc && dc.m > 0 ? <Text color={P.warn}>{` ${dc.m} mod`}</Text> : null}
              {dc && dc.c > 0 ? <Text color={COMMITTED}>{` ${dc.c} commit`}</Text> : null}
              {own ? <Text bold color={gc}>{` ${WORD[own.st] ?? own.st}`}</Text> : committedSet.has(r.path) ? <Text bold color={COMMITTED}> committed</Text> : <Text>{'  '}</Text>}
            </Box>
          </Box>
        )
      })}
      {selected || act ? (
        <Box flexDirection="row">
          <Box flexShrink={1}>
            <Text color={P.muted} wrap="truncate-start">{selected ? `selected: ${rel(selected)}` : ''}</Text>
          </Box>
          <Box flexGrow={1} />
          {act ? (
            <Text bold={act.running} color={act.failed ? P.err : FAMILY[act.state].fg}>
              {`${act.running ? SPIN[phase % SPIN.length] : '✓'} ${act.running ? `${act.label}…` : act.label}`}
            </Text>
          ) : null}
        </Box>
      ) : null}
    </Box>
  )
}

// What Claude is doing to which file: shown while it runs, kept in "Claude touched" after.
// selected file goes to Claude as context; @path mentions reveal the file
// A way in: as soon as Claude has read or edited a file, offer the tree on the bar above the prompt.

export async function filetreeSessionStart($: any, e: any, next: any) {
  cwd = root = await $.session.cwd()
  await $.command.register({ name: 'filetree', description: 'Open the file tree pane' })
  void refreshGit($)
  void rebuild($)
  $.clock.every(10_000, () => void refreshGit($))
  return next(e)
}

export async function filetreeCommandRunFiletree($: any) {
  await $.ui.open({ id: 'filetree', title: `Files: ${base(root || cwd)}` })
  return { text: 'File tree opened.' }
}

export async function filetreeToolCall($: any, e: any, next: any) {
  const t = String(e.tool)
  const p = (e as { file_path?: string; path?: string }).file_path ?? (e as { path?: string }).path
  const cmd = (e as { command?: string }).command ?? ''
  const git = t === 'Bash' ? /\bgit\s+(commit|push|pull|merge|checkout|switch|rebase)\b/.exec(cmd)?.[1] : undefined
  const isRead = ['Read', 'Grep', 'Glob'].includes(t)
  const isWrite = ['Edit', 'Write', 'NotebookEdit'].includes(t)
  if (!isRead && !isWrite && !git) return next(e)

  const target = p ? base(p) : git ? `git ${git}` : t
  const where = p ? base(dirOf(p)) : ''
  const state: State = isRead ? 'reading' : isWrite ? 'editing' : 'committed'
  if (p) touch($, p, state)
  say($, { state, label: isRead ? `Claude is reading ${target}` : isWrite ? `Claude is editing ${target}` : `Claude is running ${target}`, target: where, running: true, at: Date.now() })
  const ran = await next(e)
  const failed = ran.deny !== undefined || ran.isError === true
  const doneState: State = isRead ? 'opened' : isWrite ? 'edited' : 'committed'
  if (p && !failed) touch($, p, doneState)
  say($, { state: doneState, label: isRead ? `Claude read ${target}` : isWrite ? `Claude edited ${target}` : `Claude ran ${target}`, target: where, running: false, at: Date.now(), failed })
  if (!isRead) void refreshGit($)
  if (git === 'commit' && !failed) {
    const shown = await $.process.run(['git', 'show', '--name-only', '--pretty=format:', 'HEAD'], { cwd: root, timeoutMs: 5000 }).catch(() => undefined)
    const top = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { cwd: root }).catch(() => undefined)
    for (const f of (shown?.stdout ?? '').split('\n').filter(Boolean)) touch($, `${top?.stdout.trim() ?? root}/${f}`, 'committed')
  }
  return ran
}

export function filetreePromptSubmit($: any, e: any, next: any) {
  for (const m of e.text.matchAll(/@([\w./-]+)/g)) if (m[1].includes('/') || m[1].includes('.')) touch($, m[1], 'opened')
  return selected ? next({ ...e, context: [...(e.context ?? []), `The user has ${selected} selected in the file tree.`] }) : next(e)
}

export function filetreeUiRenderPaneFiletree($: any, e: any) {
  const ui = $.ui.resolve(e)
  const actions: Actions = {
    toggle: r => {
      if (r.isDir) open.has(r.path) ? open.delete(r.path) : open.add(r.path)
      else selected = selected === r.path ? '' : r.path
      void rebuild($)
    },
    reveal: path => {
      for (let d = dirOf(path); d.length > root.length; d = dirOf(d)) open.add(d)
      selected = path
      void rebuild($)
    },
    search: q => { query = q; void rebuild($) },
    refresh: () => { allFiles = undefined; void refreshGit($); void rebuild($) },
    collapse: () => { open.clear(); void rebuild($) },
    size: () => { showSize = !showSize; redraw($) },
    hidden: () => { showHidden = !showHidden; allFiles = undefined; void rebuild($) },
    up: () => { root = dirOf(root) || '/'; open.clear(); allFiles = undefined; void refreshGit($); void rebuild($) },
    home: () => { root = cwd; open.clear(); allFiles = undefined; void refreshGit($); void rebuild($) },
    unselect: () => { selected = ''; redraw($) },
  }
  return isRich(ui, e) ? drawRich(ui, e, actions) : drawText(ui, e, actions)
}

export async function filetreeUiRenderAbovePrompt($: any, e: any, next: any) {
  if (e.props.hasSurvey || touched.size === 0 || dismissed) return next(e)
  if ((await $.ui.panes()).some(p => p.id === 'filetree')) return next(e)
  const now = Date.now()
  const live = activity && (activity.running || now - activity.at < 6_000) ? activity : undefined
  const edits = [...touched.values()].filter(t => t.state === 'edited' || t.state === 'editing').length
  const reads = touched.size - edits
  return band($.ui.resolve(e), e, await below(next, e), {
    title: live ? live.label : `Claude touched ${touched.size} file${touched.size > 1 ? 's' : ''}`,
    tone: live ? (live.state === 'editing' || live.state === 'edited' ? 'accent' : live.state === 'committed' ? 'ok' : 'purple') : 'purple',
    busy: live?.running,
    detail: `${reads} read · ${edits} edited`,
    buttons: [
      { key: 'open', label: 'Open file tree', onPress: () => $.ui.open({ id: 'filetree', title: `Files: ${base(root || cwd)}` }) },
      { key: 'x', label: 'Dismiss', plain: true, onPress: () => { dismissed = true; redraw($) } },
    ],
  })
}
