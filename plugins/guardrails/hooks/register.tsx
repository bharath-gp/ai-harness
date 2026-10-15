import type { Register } from 'claude-code'
import { band, paneHeader } from './band'
import { folderIcon, iconTile, textCard } from './kit'
import { P, type Tone, bar, below, fit, isRich, svg } from './ui'

// ===== blast-radius =====
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
async function collect($: any, path: string, out: File[]) {
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

async function assess($: any, cmd: string, verb: string) {
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

export const blastRadius: Register = on => {
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

// ===== secret-sentry =====
const SECRETS: [RegExp, string][] = [
  [/AKIA[0-9A-Z]{16}/, 'AWS access key'],
  [/sk-ant-[A-Za-z0-9_-]{20,}/, 'Anthropic API key'],
  [/sk-[A-Za-z0-9]{32,}/, 'OpenAI-style API key'],
  [/gh[pousr]_[A-Za-z0-9]{36,}/, 'GitHub token'],
  [/xox[abprs]-[A-Za-z0-9-]{10,}/, 'Slack token'],
  [/-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/, 'private key'],
  [/(api[_-]?key|secret|token|passwd|password)["']?\s*[:=]\s*["'][A-Za-z0-9/+_=-]{20,}["']/i, 'hard-coded credential'],
]

// .env files are where secrets belong; example files hold placeholders.
const ALLOWED_PATH = /(^|\/)\.env(\.|$)|\.example$|\.sample$/

const scan = (text: string) => SECRETS.find(([re]) => re.test(text))?.[1]

let blocked = 0

function guard($: any, path: string, text: string) {
  if (ALLOWED_PATH.test(path)) return undefined
  const kind = scan(text)
  if (!kind) return undefined
  blocked += 1
  $.ui.status(`🛡 Secret Sentry · ${blocked} blocked`)
  $.ui.toast(`Secret Sentry blocked a ${kind} in ${path.split('/').pop()}`)
  return { deny: `${$.plugin.name}: refused to write a ${kind} into ${path}. Read it from an env var instead.` }
}

export const secretSentry: Register = on => {
  on('tool.call', { tool: 'Write' }, ($, e, next) => guard($, e.file_path, e.content) ?? next(e)).catch(
    ($, e, next) => (next.called ? next(e) : { deny: `${$.plugin.name}: guard failed.` }),
  )

  on('tool.call', { tool: 'Edit' }, ($, e, next) => guard($, e.file_path, e.new_string) ?? next(e)).catch(
    ($, e, next) => (next.called ? next(e) : { deny: `${$.plugin.name}: guard failed.` }),
  )
}

// ===== reflect =====
const START = '<!-- reflect:start -->'
const END = '<!-- reflect:end -->'
const SKIP = /^(ok|okay|yes|no|y|n|continue|go on|thanks|thank you|go|sure|proceed)\W*$/i

const reflectPROMPT = (text: string) =>
  `The user sent this message to a coding assistant. Does it state a reusable, durable preference or correction (a rule to follow in future sessions, e.g. "use pnpm not npm", "never mock the db")? One-off task instructions are NOT rules. Any language. Reply with only JSON: {"rule":"<imperative rule in English>"|null,"scope":"global"|"repo"}.\n\n<message>\n${text}\n</message>`

type Found = { rule: string; scope: 'global' | 'repo'; count: number }

const reflectParse = (text: string): { rule: string; scope: 'global' | 'repo' } | undefined => {
  try {
    const j = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))
    return typeof j.rule === 'string' && j.rule ? { rule: j.rule, scope: j.scope === 'global' ? 'global' : 'repo' } : undefined
  } catch {
    return undefined
  }
}

let queue: Found[] = []
let paused = false

function add($: any, rule: string, scope: Found['scope']) {
  const hit = queue.find(q => q.rule.toLowerCase() === rule.toLowerCase())
  if (hit) hit.count += 1
  else queue = [...queue, { rule, scope, count: 1 }]
  $.ui.invalidate('ui.render')
}

async function save($: any, f: Found, scope: Found['scope']) {
  const path = scope === 'global' ? '~/.claude/CLAUDE.md' : `${await $.session.root()}/CLAUDE.md`
  const file = scope === 'global' ? `${await $.env.get('HOME')}/.claude/CLAUDE.md` : path
  const old: string = (await $.fs.exists(file)) ? await $.fs.read(file) : ''
  const bullet = `- ${f.rule}`
  let next: string
  if (old.includes(START) && old.includes(END)) next = old.replace(END, `${bullet}\n${END}`)
  else next = `${old.trimEnd()}${old ? '\n\n' : ''}## Learned rules\n${START}\n${bullet}\n${END}\n`
  await $.fs.write(file, next)
  queue = queue.filter(q => q !== f)
  $.ui.invalidate('ui.render')
  $.ui.toast(`Saved to ${scope === 'global' ? '~/.claude/CLAUDE.md' : './CLAUDE.md'}`)
}

export async function reflectSessionStart($: any, e: any, next: any) {
  await $.command.register({ name: 'reflect-queue', description: 'List rules reflect found in your prompts' })
  await $.command.register({ name: 'reflect-pause', description: 'Pause or resume reflect' })
  return next(e)
}

export function reflectCommandRunReflectQueue() {
  return { text: queue.length ? queue.map(q => `- ${q.rule} (${q.scope}, x${q.count})`).join('\n') : 'Nothing queued.' }
}

export function reflectCommandRunReflectPause() {
  paused = !paused
  return { text: paused ? 'reflect paused.' : 'reflect resumed.' }
}

export async function reflectPromptSubmit($: any, e: any, next: any) {
  const t = e.text.trim()
  if (e.origin.kind === 'plugin' || paused || t.startsWith('/')) return next(e)

  const explicit = /^remember:\s*(.+)$/is.exec(t)
  if (explicit) add($, explicit[1].trim(), 'repo')
  else if (t.length <= 500 && !SKIP.test(t)) {
    void $.model
      .complete({ model: 'haiku', prompt: reflectPROMPT(t), maxTokens: 150, effort: 'low', timeoutMs: 15_000 })
      .then(r => {
        const found = r.isAnswered ? reflectParse(r.text) : undefined
        if (found) add($, found.rule, found.scope)
      })
  }
  return next(e)
}

export async function reflectUiRenderAbovePrompt($: any, e: any, next: any) {
  if (e.props.hasSurvey || queue.length === 0) return next(e)
  const f = queue[0]
  const other = f.scope === 'global' ? 'repo' : 'global'
  const more = queue.length > 1 ? [`+${queue.length - 1} more`] : []
  return band($.ui.resolve(e), e, await below(next, e), {
    title: 'Rule found',
    tone: 'purple',
    detail: f.rule,
    chips: [f.scope, ...(f.count > 1 ? [`×${f.count}`] : []), ...more],
    buttons: [
      { key: 'save', label: 'Save', onPress: () => save($, f, f.scope) },
      { key: 'other', label: other === 'global' ? 'Global instead' : 'This repo instead', onPress: () => save($, f, other) },
      { key: 'skip', label: 'Skip', plain: true, onPress: () => { queue = queue.filter(q => q !== f); $.ui.invalidate('ui.render') } },
    ],
  })
}

// ===== assumption-tracker =====
type Item = { text: string; verdict: 'right' | 'wrong' | undefined }

const assumptionTrackerPROMPT = (task: string, answer: string) =>
  `List the assumptions the assistant made that the user did not explicitly specify (defaults chosen, ambiguities resolved silently, scope decisions). Max 8, one short sentence each. Reply with only a JSON array of strings, [] if none.\n\n<user_request>\n${task.slice(0, 2000)}\n</user_request>\n<assistant_reply>\n${answer.slice(0, 6000)}\n</assistant_reply>`

const assumptionTrackerParse = (text: string): string[] => {
  try {
    const arr = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1))
    return Array.isArray(arr) ? arr.filter((s): s is string => typeof s === 'string').slice(0, 8) : []
  } catch {
    return []
  }
}

let items: Item[] = []
let task = ''

function redraw($: any) { return $.ui.invalidate('ui.render') }

export async function assumptionTrackerSessionStart($: any, e: any, next: any) {
  await $.command.register({ name: 'assumptions', description: 'Review the assumptions Claude made last turn' })
  return next(e)
}

export async function assumptionTrackerCommandRunAssumptions($: any) {
  if (items.length === 0) return { text: 'No assumptions recorded for the last turn.' }
  await $.ui.open({ id: 'assumptions', title: 'Assumptions', focus: true, closeOnEscape: true })
  return { text: 'Assumptions opened.' }
}

export function assumptionTrackerPromptSubmit($: any, e: any, next: any) {
  if (e.origin.kind !== 'plugin') task = e.text // fix prompts we send must not overwrite the task
  return next(e)
}

export async function assumptionTrackerTurnComplete($: any, e: any, next: any) {
  if (e.agentId === undefined && e.reason === 'answer' && task) {
    void $.model
      .complete({ model: 'haiku', prompt: assumptionTrackerPROMPT(task, e.answer), maxTokens: 600, effort: 'low', timeoutMs: 20_000 })
      .then(r => {
        items = r.isAnswered ? assumptionTrackerParse(r.text).map(text => ({ text, verdict: undefined })) : []
        redraw($)
      })
  }
  return next(e)
}

export async function assumptionTrackerUiRenderAbovePrompt($: any, e: any, next: any) {
  if (e.props.hasSurvey || items.length === 0) return next(e)
  const reviewed = items.filter(i => i.verdict).length
  return band($.ui.resolve(e), e, await below(next, e), {
    title: `Claude made ${items.length} assumption${items.length > 1 ? 's' : ''}`,
    tone: 'warn',
    detail: `${reviewed}/${items.length} reviewed`,
    pct: (reviewed / items.length) * 100,
    buttons: [
      { key: 'review', label: 'Review', hotkey: '0', onPress: () => $.ui.open({ id: 'assumptions', title: 'Assumptions', focus: true, closeOnEscape: true }) },
      { key: 'skip', label: '×', plain: true, onPress: () => { items = []; redraw($) } },
    ],
  })
}

export function assumptionTrackerUiRenderPaneAssumptions($: any, e: any) {
  const ui = $.ui.resolve(e)
  const { Box, Text, Button } = ui
  const wrong = items.filter(i => i.verdict === 'wrong')
  const set = (i: number, v: Item['verdict']) => {
    items = items.map((it, j) => (j === i ? { ...it, verdict: v } : it))
    redraw($)
  }
  const reviewed = items.filter(i => i.verdict).length
  return (
    <Box flexDirection="column" gap={1}>
      {paneHeader(ui, e, { title: 'Assumptions', sub: `${reviewed}/${items.length} reviewed · ${wrong.length} wrong`, pct: items.length ? (reviewed / items.length) * 100 : 0, tone: 'warn' })}
      {items.length === 0 && <Text color="#8b8f98">Nothing to review.</Text>}
      {items.map((it, i) => {
        const color = it.verdict === 'wrong' ? P.err : it.verdict === 'right' ? P.ok : P.warn // yellow until reviewed
        return textCard(ui, {
          key: `r${i}`,
          color,
          text: it.text,
          children: (
            <Box flexDirection="row" gap={1}>
              <Button key={`ok${i}`} label="Right" variant={it.verdict === 'right' ? 'primary' : 'secondary'} onPress={() => set(i, 'right')} />
              <Button key={`no${i}`} label="Wrong" variant={it.verdict === 'wrong' ? 'primary' : 'secondary'} onPress={() => set(i, 'wrong')} />
            </Box>
          ),
        })
      })}
      {wrong.length > 0 && (
        <Button
          key="send"
          variant="primary"
          label={`Fix ${wrong.length} wrong`}
          onPress={async () => {
            const keep = items.filter(i => i.verdict === 'right').map(i => `- ${i.text}`)
            const text =
              `These assumptions you made were wrong. Fix only the parts that depend on them:\n${wrong.map(i => `- ${i.text}`).join('\n')}` +
              (keep.length ? `\n\nThese were right, keep them:\n${keep.join('\n')}` : '')
            items = []
            await $.ui.close({ id: 'assumptions' })
            void $.prompt.submit({ text })
          }}
        />
      )}
    </Box>
  )
}

// ===== self-critique =====
type Critique = {
  verdict: 'strong' | 'mixed' | 'weak'
  summary: string
  strengths: string[]
  flaws: { issue: string; fix: string }[]
}

const MODELS = ['session', 'opus', 'sonnet', 'haiku'] as const

const selfCritiquePROMPT = (answer: string) =>
  `Critique the assistant reply below. Reply with only JSON: {"verdict":"strong|mixed|weak","summary":"one sentence","strengths":["..."],"flaws":[{"issue":"...","fix":"one-line instruction to repair it"}]}. Be specific; at most 4 strengths and 5 flaws.\n\n<reply>\n${answer.slice(0, 12000)}\n</reply>`

const selfCritiqueParse = (text: string): Critique | undefined => {
  try {
    const c = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))
    return Array.isArray(c.flaws) && Array.isArray(c.strengths) ? c : undefined
  } catch {
    return undefined
  }
}

let result: Critique | undefined
let status = 'No critique yet. Run /critique.'
let model: (typeof MODELS)[number] = 'session'
let auto = false
let lastAnswer = ''

async function run($: any, answer: string) {
  if (!answer) {
    status = 'Nothing to critique yet.'
    return
  }
  status = 'Critiquing…'
  $.ui.invalidate('ui.render')
  const m = model === 'session' ? await $.session.model() : model
  const r = await $.model.complete({ model: m, prompt: selfCritiquePROMPT(answer), maxTokens: 1500, timeoutMs: 60_000 })
  result = r.isAnswered ? selfCritiqueParse(r.text) : undefined
  status = result ? '' : `Critique failed${r.isAnswered ? ' (unparseable reply)' : `: ${r.reason}`}`
  $.ui.invalidate('ui.render')
}

export async function selfCritiqueSessionStart($: any, e: any, next: any) {
  await $.command.register({ name: 'critique', description: 'Critique the last answer: /critique [auto|opus|sonnet|haiku|session]' })
  return next(e)
}

export async function selfCritiqueCommandRunCritique($: any, e: any) {
  const arg = (e.args ?? "").trim()
  if (arg === 'auto') {
    auto = !auto
    return { text: `Auto-critique ${auto ? 'on' : 'off'}.` }
  }
  if ((MODELS as readonly string[]).includes(arg)) model = arg as typeof model
  await $.ui.open({ id: 'critique', title: 'Critique' })
  void run($, lastAnswer)
  return { text: `Critiquing with ${model}.` }
}

export async function selfCritiqueTurnComplete($: any, e: any, next: any) {
  if (e.agentId === undefined && e.reason === 'answer') {
    lastAnswer = e.answer
    if (auto) {
      await $.ui.open({ id: 'critique', title: 'Critique' })
      void run($, e.answer)
    }
  }
  return next(e)
}

export function selfCritiqueUiRenderPaneCritique($: any, e: any) {
  const ui = $.ui.resolve(e)
  const { Box, Text, Button } = ui
  const tone: Tone = result?.verdict === 'strong' ? 'ok' : result?.verdict === 'weak' ? 'err' : 'warn'
  const score = result ? { strong: 90, mixed: 55, weak: 20 }[result.verdict] : undefined
  return (
    <Box flexDirection="column" gap={1}>
      {paneHeader(ui, e, { title: 'Critique', sub: status || `${result?.flaws.length ?? 0} flaws · model: ${model}`, pct: score, tone: result ? tone : 'purple' })}
      <Box flexDirection="row" gap={1}>
        <Button key="rerun" label="Rerun" variant="primary" onPress={() => void run($, lastAnswer)} />
        <Button key="auto" label={`Auto ${auto ? 'on' : 'off'}`} onPress={() => { auto = !auto; $.ui.invalidate('ui.render') }} />
        <Button key="model" label={`Model: ${model}`} onPress={() => { model = MODELS[(MODELS.indexOf(model) + 1) % MODELS.length]; $.ui.invalidate('ui.render') }} />
      </Box>
      {result && (
        <>
          {textCard(ui, { key: 'verdict', color: P[tone], text: `${result.verdict.toUpperCase()}: ${result.summary}` })}
          {result.strengths.map((s, i) => textCard(ui, { key: `s${i}`, color: P.ok, text: s }))}
          {result.flaws.map((f, i) => (
            <Box key={`f${i}`} flexDirection="column">
              {textCard(ui, { key: `fc${i}`, color: P.err, text: f.issue, sub: `fix: ${f.fix}` })}
              <Button key={`fix${i}`} label="Make this fix" onPress={() => void $.prompt.submit({ text: `Fix this issue in your last answer: ${f.issue}. ${f.fix}` })} />
            </Box>
          ))}
        </>
      )}
    </Box>
  )
}

// Each mod is on unless its userConfig flag is false (toggle in the config menu; the module reloads).
export const register: Register = (on, options) => {
  if (options.blastRadius !== false) blastRadius(on)
  if (options.secretSentry !== false) secretSentry(on)
  on('session.start', ($, e, next) => {
    const n3 = (x: any) => next(x)
    const n2 = (x: any) => (options.selfCritique === false ? n3(x) : selfCritiqueSessionStart($, x, n3))
    const n1 = (x: any) => (options.assumptionTracker === false ? n2(x) : assumptionTrackerSessionStart($, x, n2))
    return options.reflect === false ? n1(e) : reflectSessionStart($, e, n1)
  })
  if (options.reflect !== false) on('command.run', { command: 'reflect-queue' }, reflectCommandRunReflectQueue)
  if (options.reflect !== false) on('command.run', { command: 'reflect-pause' }, reflectCommandRunReflectPause)
  on('prompt.submit', ($, e, next) => {
    const n2 = (x: any) => next(x)
    const n1 = (x: any) => (options.assumptionTracker === false ? n2(x) : assumptionTrackerPromptSubmit($, x, n2))
    return options.reflect === false ? n1(e) : reflectPromptSubmit($, e, n1)
  })
  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    const n2 = (x: any) => next(x)
    const n1 = (x: any) => (options.assumptionTracker === false ? n2(x) : assumptionTrackerUiRenderAbovePrompt($, x, n2))
    return options.reflect === false ? n1(e) : reflectUiRenderAbovePrompt($, e, n1)
  })
  if (options.assumptionTracker !== false) on('command.run', { command: 'assumptions' }, assumptionTrackerCommandRunAssumptions)
  on('turn.complete', ($, e, next) => {
    const n2 = (x: any) => next(x)
    const n1 = (x: any) => (options.selfCritique === false ? n2(x) : selfCritiqueTurnComplete($, x, n2))
    return options.assumptionTracker === false ? n1(e) : assumptionTrackerTurnComplete($, e, n1)
  })
  if (options.assumptionTracker !== false) on('ui.render', { component: 'Pane', requestId: 'assumptions' }, assumptionTrackerUiRenderPaneAssumptions)
  if (options.selfCritique !== false) on('command.run', { command: 'critique' }, selfCritiqueCommandRunCritique)
  if (options.selfCritique !== false) on('ui.render', { component: 'Pane', requestId: 'critique' }, selfCritiqueUiRenderPaneCritique)
}
