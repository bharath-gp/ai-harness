import type { Register } from 'claude-code'
import { band, paneHeader } from './band'
import { textCard } from './kit'
import { C, P, type Tone, below, fmtSize, gauge, parsePorcelain, DECK, usePalette } from './ui'

// ===== shared drawing =====
// After a surface module faults on a surface, it is drawn there without animation; other surfaces keep theirs.
const faulted = new Set<string>()

// A rail that carries packets while `active` (claude-flightdeck's connector), a still faint line otherwise or where the
// surface cannot run a surface module. The module path must be a literal in this file.
export function rail(ui: any, e: any, key: string, active: boolean, color: string, width: number) {
  const { Text } = ui
  if (!DECK.motion || !('Client' in ui) || faulted.has(`${e.surface}:rail.tsx`))
    return <Text color={C.faint} mono>{'─'.repeat(Math.max(1, width))}</Text>
  return <ui.Client key={key} module="./rail.tsx" width={width} height={1} props={{ active, width, color, dim: C.faint, marks: [], isMerge: false }} />
}

// ===== blast-radius =====
// Destructive shell patterns worth a human look: [pattern, what it does].
export const RISKY: [RegExp, string][] = [
  [/\brm\s+((-[a-zA-Z]*[rRf][a-zA-Z]*|--recursive|--force)\s+)+/, 'delete'],
  [/\bgit\s+push\b[^\n;&|]*(--force\b|--force-with-lease\b|\s-f\b|\s\+\S|--delete\b)/, 'force-push'],
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
    const st = await $.process.run(['git', 'status', '--porcelain', '-z'], { cwd, timeoutMs: 5000 }).catch(() => undefined)
    for (const row of parsePorcelain(st?.stdout ?? '')) {
      const p = `${cwd}/${row.path}`
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

// The dialog takes at most 12 rows, the engine's own included (Claude Code 2.1.300 holds the desktop to 12 too),
// and no size or place: so on every surface the card is flightdeck's borderless mini form, three flex rows. The
// dialog's own question already names the command.
const drawCard = (ui: any, i: Impact) => {
  const { Box, Text } = ui
  const n = i.files.length
  const big = groups(i.files, i.project)[0]
  const folders = new Set(i.files.map(f => f.path.slice(0, f.path.lastIndexOf('/')))).size
  const act = i.verb === 'delete' ? 'will delete' : i.verb === 'discard' ? 'will discard' : `will ${i.verb}`
  const g6 = big ? gauge(i.total ? (big.size / i.total) * 100 : 0, 6) : null
  const row = (key: string, left: unknown, right: string, m: unknown) => (
    <Box key={key} flexDirection="row" columnGap={1}>
      <Box flexGrow={1} flexShrink={1}>{left}</Box>
      <Box flexShrink={0}><Text dimColor>{right}</Text></Box>
      {m ? <Box flexShrink={0}>{m}</Box> : null}
    </Box>
  )
  return (
    <Box flexDirection="column">
      {row('t', <Text color={C.warn} bold wrap="truncate">{`BLAST RADIUS · ${act}`}</Text>, n > 0 ? `${plural(n, 'file')} · ${fmtSize(i.total)}` : `in ${i.project}`, null)}
      <Text color={C.amber} wrap="truncate">{`⛨ ${i.note}`}</Text>
      {big && g6
        ? row(
            'g',
            <Text wrap="truncate"><Text color={C.agent}>■ </Text><Text bold>{big.dir}</Text><Text dimColor>{` ${big.files[0].path.slice(big.files[0].path.lastIndexOf('/') + 1)}${folders > 1 ? ` · +${plural(folders - 1, 'folder')}` : ''}`}</Text></Text>,
            `${plural(big.files.length, 'file')} ${fmtSize(big.size)}`,
            <Text><Text color={C.warn}>{g6.on}</Text><Text color={C.faint}>{g6.off}</Text></Text>,
          )
        : null}
    </Box>
  )
}

// Chained into the bundle's one Bash tool.call hook in `register`.
export async function blastRadiusBash($: any, e: any, next: any) {
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
}

export const blastRadius: Register = on => {
  // The impact card goes above the engine's own dialog, which keeps its Delete / Cancel buttons.
  on('ui.render', { component: 'AskUserQuestion' }, async ($, e, next) => {
    const q = (e.props.questions as { header?: string }[] | undefined)?.[0]
if (!pending || q?.header !== 'Blast Radius') return next(e)
    const { Box } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {drawCard($.ui.resolve(e), pending)}
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
  $.ui.status(`secret-sentry · ${blocked} blocked`)
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

  on('tool.call', { tool: 'NotebookEdit' }, ($, e, next) => guard($, e.notebook_path, e.new_source ?? '') ?? next(e)).catch(
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
  if (old.includes(START) && old.includes(END)) next = old.replace(END, () => `${bullet}\n${END}`) // a function: `$&` in a rule must stay literal
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
let assumptionGen = 0 // a late reply for an older prompt is ignored

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
  assumptionGen += 1
  return next(e)
}

export async function assumptionTrackerTurnComplete($: any, e: any, next: any) {
  if (e.agentId === undefined && e.reason === 'answer' && task) {
    const gen = assumptionGen
    void $.model
      .complete({ model: 'haiku', prompt: assumptionTrackerPROMPT(task, e.answer), maxTokens: 600, effort: 'low', timeoutMs: 20_000 })
      .then(r => {
        if (gen !== assumptionGen) return
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
      {items.length === 0 && <Text dimColor>Nothing to review.</Text>}
      {items.length > 0 && <Text dimColor>{`1-${items.length} cycle right / wrong${wrong.length ? ' · f send the fixes' : ''}`}</Text>}
      {items.map((it, i) => {
        const color = it.verdict === 'wrong' ? P.err : it.verdict === 'right' ? P.ok : P.warn // amber until reviewed
        const mark = it.verdict === 'wrong' ? '✗ wrong' : it.verdict === 'right' ? '✓ right' : '◇ unreviewed'
        return textCard(ui, {
          key: `r${i}`,
          color,
          text: it.text,
          children: (
            <Box flexDirection="row" columnGap={1}>
              <Button key={`cy${i}`} plain hotkey={String(i + 1)} label={`${i + 1} ${mark}`} onPress={() => set(i, it.verdict === undefined ? 'right' : it.verdict === 'right' ? 'wrong' : undefined)} />
              <Box flexGrow={1} />
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
          hotkey="f"
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
      {rail(ui, e, 'critique-busy', status === 'Critiquing…', C.arch, Math.max(10, (e.props.bodyColumns ?? 40) - 1))}
      <Box flexDirection="row" columnGap={1} flexWrap="wrap">
        <Button key="rerun" label="Rerun" hotkey="r" variant="primary" onPress={() => void run($, lastAnswer)} />
        <Button key="auto" label={`Auto ${auto ? 'on' : 'off'}`} hotkey="a" onPress={() => { auto = !auto; $.ui.invalidate('ui.render') }} />
        <Button key="model" label={`Model: ${model}`} hotkey="m" onPress={() => { model = MODELS[(MODELS.indexOf(model) + 1) % MODELS.length]; $.ui.invalidate('ui.render') }} />
      </Box>
      {result && (
        <>
          {textCard(ui, { key: 'verdict', color: P[tone], text: `${result.verdict.toUpperCase()}: ${result.summary}` })}
          {result.strengths.map((s, i) => textCard(ui, { key: `s${i}`, color: P.ok, text: s }))}
          {result.flaws.map((f, i) => (
            <Box key={`f${i}`} flexDirection="column">
              {textCard(ui, { key: `fc${i}`, color: P.err, text: f.issue, sub: `fix: ${f.fix}` })}
              <Button key={`fix${i}`} label={`${i + 1} Make this fix`} hotkey={String(i + 1)} onPress={() => void $.prompt.submit({ text: `Fix this issue in your last answer: ${f.issue}. ${f.fix}` })} />
            </Box>
          ))}
        </>
      )}
    </Box>
  )
}

// ===== prompt-coach =====
type Coach = {
  original: string
  ctx: string
  draft?: string
  changes?: string
  asking: boolean // the "request changes" box is open
  busy: string
  err: string
  tipOnly?: boolean // the prompt carries attachments: it was sent as typed, the improved text is only offered
  fromSubmit?: boolean // the session's first prompt, held until the user picks Use or Dismiss
}

let coach: Coach | undefined
// Per-session "offered" flag in $.state (survives hot reload); only the session's first prompt is auto-coached, /sharpen coaches any.
const coachedRef = { plugin: 'guardrails', key: 'coached' } as const

// A prompt that opens with /command or a skill keeps that first line verbatim in front of the reworded text.
const coachCommandLine = (text: string) => (text.startsWith('/') ? text.split('\n')[0].trim() : '')

const coachDraftPROMPT = (c: Coach) => {
  const cmd = coachCommandLine(c.original)
  return (
    `Rewrite the user's prompt below as one better prompt for a coding assistant, following prompting best practices. Write it to the assistant in second person. Use these sections, omitting any with nothing to say: Role (persona), Goal (intent and why), Context, Requirements, Constraints, Out of scope, Acceptance criteria, Output format. Never invent requirements the user did not state. Always include a section "Before you start" instructing the assistant to grill the user, before doing any work, about every ambiguity, missing requirement and unstated assumption in the request: ask one question at a time, give options with a recommendation, look at the project itself for anything it can answer, and wait for the answers before starting. The assistant does the questioning, you do not ask anything. ` +
    (cmd
      ? `The prompt opens with the slash command or skill line ${JSON.stringify(cmd)}; take what that skill does into account. Do not repeat that line and do not quote the original: reply with only the text that follows it.`
      : 'End with an "Original request" section quoting the original prompt verbatim.') +
    ` Reply with only the prompt text, no preamble and no code fences.\n\n<project_context>\n${c.ctx}\n</project_context>\n<original_prompt>\n${c.original}\n</original_prompt>` +
    (c.changes ? `\n<previous_draft>\n${c.draft}\n</previous_draft>\n<requested_changes>\n${c.changes}\n</requested_changes>` : '')
  )
}

async function coachContext($: any): Promise<string> {
  try {
    const root = await $.session.root()
    const md = `${root}/CLAUDE.md`
    const doc: string = (await $.fs.exists(md)) ? await $.fs.read(md) : ''
    const names = (await $.fs.list(root)).map((f: any) => (f.kind === 'dir' ? `${f.name}/` : f.name))
    return `${doc.slice(0, 4000)}\n\nTop-level files: ${names.slice(0, 60).join(', ')}`
  } catch {
    return ''
  }
}

async function coachDraft($: any, c: Coach) {
  c.busy = 'Writing your prompt…'
  c.err = ''
  redraw($)
  if (!c.ctx) c.ctx = await coachContext($)
  const r = await $.model.complete({ model: await $.session.model(), prompt: coachDraftPROMPT(c), maxTokens: 2500, timeoutMs: 90_000 })
  if (coach !== c) return
  c.busy = ''
  const body = r.isAnswered ? r.text.trim() : ''
  if (body) {
    const cmd = coachCommandLine(c.original)
    c.draft = cmd ? `${cmd}\n\n${body}` : body
    c.changes = undefined
    c.asking = false
  } else c.err = `Could not write the prompt${r.isAnswered ? '' : `: ${r.reason}`}`
  redraw($)
}

// text: the original to send on (Dismiss), or nothing.
async function coachClose($: any, text?: string) {
  coach = undefined
  await $.ui.close({ id: 'coach' })
  if (text) void $.prompt.submit({ text, asUser: true })
}

// Puts the improved prompt in the prompt box to edit; a held first prompt is not sent.
async function coachUse($: any, c: Coach) {
  const r = await $.prompt.fill({ text: c.draft })
  $.ui.toast(r.isFilled ? 'Prompt coach: improved prompt is in the prompt box' : 'Prompt coach: could not fill the prompt box, use Copy')
  if (r.isFilled) await coachClose($)
}

// Opens the pane and writes the draft; false when no surface draws a pane (the prompt then goes through unchanged).
async function coachStart($: any, text: string, fromSubmit = false, tipOnly = false): Promise<boolean> {
  const c: Coach = { fromSubmit, tipOnly, original: text, ctx: '', asking: false, busy: 'Writing your prompt…', err: '' }
  coach = c
  const r = await $.ui.open({ id: 'coach', title: 'Prompt coach', focus: true })
  if (!r.isPlaced) {
    coach = undefined
    return false
  }
  void coachDraft($, c)
  return true
}

export async function promptCoachSessionStart($: any, e: any, next: any) {
  await $.command.register({ name: 'sharpen', description: 'Rewrite a prompt so the main session grills you first: /sharpen [prompt] (defaults to the prompt box, then your last message)' })
  return next(e)
}

export async function promptCoachCommandRunSharpen($: any, e: any) {
  let text = (e.args ?? '').trim()
  if (!text) text = ((await $.prompt.read()).text ?? '').trim()
  if (!text) {
    const last = (await $.session.messages()).filter((m: any) => m.role === 'user' && (m.text ?? '').trim()).at(-1)
    text = (last?.text ?? '').trim()
  }
  if (!text) return { text: 'Usage: /sharpen <prompt>' }
  return { text: (await coachStart($, text)) ? 'Prompt coach opened.' : 'No pane available here.' }
}

export async function promptCoachPromptSubmit($: any, e: any, next: any) {
  const t = e.text.trim()
  if (e.origin?.kind === 'plugin' || e.command || !t) return next(e)
  const member = { ...coachedRef, id: await $.session.id() }
  if ((await $.state.get(member)).value) return next(e)
  await $.state.set(member, true) // set on the first prompt whether or not it is coached: nothing later is auto-coached
  // Attachments can't be re-sent with a rewritten prompt, so such a prompt goes through as typed and the pane only offers the improved text.
  const tipOnly = !!e.attachments?.length
  if (!(await coachStart($, t, true, tipOnly)) || tipOnly) return next(e)
  return { drop: 'prompt-coach: review the improved prompt, then pick Use or Dismiss.' }
}

export function promptCoachUiRenderPaneCoach($: any, e: any) {
  const ui = $.ui.resolve(e)
  const { Box, Text, Button, Input } = ui
  const c = coach
  if (!c) return <Text dimColor>No prompt being coached.</Text>
  const dismiss = <Button key="dismiss" hotkey="d" label={c.tipOnly || !c.fromSubmit ? 'Dismiss' : 'Dismiss (send original)'} onPress={() => void coachClose($, c.tipOnly || !c.fromSubmit ? undefined : c.original)} />
  return (
    <Box flexDirection="column" gap={1}>
      {paneHeader(ui, e, { title: 'Prompt coach', sub: c.draft ? 'Review your prompt' : c.busy || 'Could not write the prompt', pct: c.draft ? 100 : 0, tone: 'purple' })}
      {c.tipOnly && <Text dimColor>Your prompt and its attachments were already sent. Use the improved version next time.</Text>}
      {c.err && textCard(ui, { key: 'err', color: P.err, text: c.err })}
      {rail(ui, e, 'coach-busy', Boolean(c.busy), C.arch, Math.max(10, (e.props.bodyColumns ?? 40) - 1))}
      {c.busy && <Text dimColor>{c.busy}</Text>}
      {c.draft && !c.busy && (
        <>
          {textCard(ui, { key: 'draft', color: C.main, text: c.draft })}
          {c.asking && (
            <Input
              key="changes"
              autoFocus
              placeholder="What should change?"
              submitLabel="regenerate"
              onSubmit={(v: string) => {
                if (!v.trim()) return
                c.changes = v.trim()
                void coachDraft($, c)
              }}
            />
          )}
          <Box flexDirection="row" columnGap={1} flexWrap="wrap">
            <Button key="use" label="Use in prompt box" hotkey="u" variant="primary" onPress={() => void coachUse($, c)} />
            <Button key="copy" label="Copy" hotkey="c" onPress={async () => { $.ui.toast((await $.ui.copy({ text: c.draft, surface: e.surface })).isCopied ? 'Copied' : 'Copy failed') }} />
            <Button key="change" label="Request changes" hotkey="e" onPress={() => { c.asking = !c.asking; redraw($) }} />
            {dismiss}
          </Box>
        </>
      )}
      {c.err && !c.busy && (
        <Box flexDirection="row" columnGap={1}>
          <Button key="retry" label="Retry" hotkey="r" variant="primary" onPress={() => void coachDraft($, c)} />
          {!c.draft && dismiss}
        </Box>
      )}
    </Box>
  )
}

// ===== merge-sweep =====
// PRs this session opened with `gh pr create`, kept per session id in $.state (survives hot reload).
const sweepPrsRef = { plugin: 'guardrails', key: 'prs' } as const
const SWEEP_CREATE = /\bgh\s+pr\s+create\b/
const SWEEP_PR_URL = /https:\/\/[^\s"')]+\/pull\/\d+/

export async function mergeSweepBash($: any, e: any, next: any) {
  if (!SWEEP_CREATE.test(e.command)) return next(e)
  const ran = await next(e)
  if (ran.deny !== undefined || ran.isError) return ran
  const url = SWEEP_PR_URL.exec(ran.text ?? '')?.[0]
  if (url) {
    const member = { ...sweepPrsRef, id: await $.session.id() }
    const prs: string[] = (await $.state.get(member)).value ?? []
    if (!prs.includes(url)) await $.state.set(member, [...prs, url])
  }
  return ran
}

// Merged PRs waiting for an answer, rebuilt by the poll after a reload; a PR leaves the state list once cleaned or dismissed.
type SweepPr = { url: string; head: string; oid: string; base: string; isFork: boolean }
let sweepReady: SweepPr[] = []
let sweepBusy = false

const sweepRun = ($: any, argv: string[], cwd?: string) =>
  $.process.run(argv, { cwd, timeoutMs: 30_000 }).catch((err: unknown) => ({ exitCode: 1, stdout: '', stderr: String(err) }))

const sweepWhy = (r: { stderr: string }) => r.stderr.trim().split('\n')[0].slice(0, 120)

export const sweepWorktrees = (text: string) =>
  text
    .split('\n\n')
    .map(b => ({ path: /^worktree (.+)$/m.exec(b)?.[1] ?? '', branch: /^branch refs\/heads\/(.+)$/m.exec(b)?.[1] }))
    .filter(w => w.path)

async function sweepForget($: any, url: string) {
  const member = { ...sweepPrsRef, id: await $.session.id() }
  const prs: string[] = (await $.state.get(member)).value ?? []
  await $.state.set(member, prs.filter(u => u !== url))
  sweepReady = sweepReady.filter(p => p.url !== url)
  $.ui.invalidate('ui.render')
}

async function sweepPoll($: any) {
  const prs: string[] = (await $.state.get({ ...sweepPrsRef, id: await $.session.id() })).value ?? []
  for (const url of prs) {
    if (sweepReady.some(p => p.url === url)) continue
    const r = await sweepRun($, ['gh', 'pr', 'view', url, '--json', 'state,headRefName,headRefOid,baseRefName,isCrossRepository'])
    if (r.exitCode !== 0) continue // offline or not signed in: ask again next turn
    try {
      const j = JSON.parse(r.stdout)
      if (j.state === 'MERGED') sweepReady = [...sweepReady, { url, head: j.headRefName, oid: j.headRefOid, base: j.baseRefName, isFork: !!j.isCrossRepository }]
    } catch {}
  }
  $.ui.invalidate('ui.render')
}

// Never forces: a dirty worktree, a branch with later commits or a moved remote is kept and reported.
// shortcut: the remote is assumed to be `origin`, upgrade when a PR's head lives on another remote.
export async function sweepClean($: any, p: SweepPr) {
  sweepBusy = true
  $.ui.invalidate('ui.render')
  const done: string[] = []
  const kept: string[] = []
  try {
    const cwd = await $.session.root()
    const git = (...a: string[]) => sweepRun($, ['git', ...a], cwd)
    const wts = sweepWorktrees((await git('worktree', 'list', '--porcelain')).stdout)
    const main = wts[0]
    const here = (await git('rev-parse', '--show-toplevel')).stdout.trim()
    if (!main || p.head === p.base) kept.push(`${p.head}: nothing to clean`)
    else {
      let blocked = false // the branch is still checked out somewhere
      const wt = wts.find(w => w.branch === p.head)
      if (wt === main) {
        const r = await sweepRun($, ['git', 'switch', p.base], main.path)
        if (r.exitCode === 0) {
          main.branch = p.base
          done.push(`switched to ${p.base}`)
        } else {
          blocked = true
          kept.push(`switch to ${p.base} failed: ${sweepWhy(r)}`)
        }
      } else if (wt) {
        if (wt.path === here) {
          blocked = true
          kept.push(`worktree ${wt.path} is the current directory: later run git worktree remove ${wt.path} && git branch -D ${p.head}`)
        } else {
          const r = await git('worktree', 'remove', wt.path)
          if (r.exitCode === 0) done.push('worktree removed')
          else {
            blocked = true
            kept.push(`worktree ${wt.path}: ${sweepWhy(r)}`)
          }
        }
      }
      if (main.branch === p.base) {
        const r = await sweepRun($, ['git', 'pull', '--ff-only'], main.path)
        if (r.exitCode === 0) done.push(`pulled ${p.base}`)
        else kept.push(`pull ${p.base} failed: ${sweepWhy(r)}`)
      } else kept.push(`${p.base} not pulled: main checkout is on ${main.branch ?? 'a detached head'}`)

      if (!blocked) {
        const tip = (await git('rev-parse', '--verify', '--quiet', `refs/heads/${p.head}`)).stdout.trim()
        if (tip === p.oid) {
          const r = await git('branch', '-D', p.head)
          if (r.exitCode === 0) done.push('local branch deleted')
          else kept.push(`local ${p.head}: ${sweepWhy(r)}`)
        } else if (tip) kept.push(`local ${p.head} has commits after the merged ${p.oid.slice(0, 7)}`)
      }

      if (p.isFork) kept.push('remote branch: the PR is from a fork')
      else {
        const line = (await git('ls-remote', '--heads', 'origin', `refs/heads/${p.head}`)).stdout.split('\n').find(l => l.endsWith(`\trefs/heads/${p.head}`))
        const sha = line?.split('\t')[0]
        if (sha === p.oid) {
          const r = await git('push', 'origin', '--delete', p.head)
          if (r.exitCode === 0) done.push('remote branch deleted')
          else kept.push(`remote ${p.head}: ${sweepWhy(r)}`)
        } else if (sha) kept.push(`remote ${p.head} moved past the merged commit`)
      }
    }
  } catch (err) {
    kept.push(`failed: ${String(err).slice(0, 120)}`)
  } finally {
    sweepBusy = false
  }
  await sweepForget($, p.url)
  $.ui.toast(`Cleanup: ${done.join(', ') || 'nothing removed'}${kept.length ? ` | kept: ${kept.join('; ')}` : ''}`)
}

export function mergeSweepTurnComplete($: any, e: any, next: any) {
  void sweepPoll($).catch(() => {})
  return next(e)
}

export async function mergeSweepUiRenderAbovePrompt($: any, e: any, next: any) {
  if (e.props.hasSurvey || sweepReady.length === 0) return next(e)
  const p = sweepReady[0]
  return band($.ui.resolve(e), e, await below(next, e), {
    title: `PR #${/\/pull\/(\d+)/.exec(p.url)?.[1]} merged`,
    tone: 'ok',
    busy: sweepBusy,
    detail: sweepBusy ? 'cleaning up' : `clean up ${p.head}?`,
    chips: sweepReady.length > 1 ? [`+${sweepReady.length - 1} more`] : [],
    buttons: sweepBusy
      ? []
      : [
          { key: 'clean', label: 'Clean up', hotkey: 'c', onPress: () => void sweepClean($, p) },
          { key: 'skip', label: 'Dismiss', hotkey: 'd', plain: true, onPress: () => void sweepForget($, p.url) },
        ],
  })
}

// Each mod is on unless its userConfig flag is false (toggle in the config menu; the module reloads).
export const register: Register = (on, options) => {
  usePalette(options.palette, options.motion)
  on('ui.fault', ($, e, next) => {
    const key = `${e.surface}:${e.module.split(/[\\/]/).pop()}`
    if (!faulted.has(key)) {
      faulted.add(key)
      $.ui.log(`guardrails: ${e.module} faulted on ${e.surface} (${e.phase}: ${e.reason}); drawing it without animation`)
      $.ui.invalidate('ui.render')
    }
    return next(e)
  })
  if (options.blastRadius !== false) blastRadius(on)
  // blast-radius and merge-sweep share the one Bash tool.call hook; merge-sweep is outermost so it sees the final result.
  on('tool.call', { tool: 'Bash' }, ($, e, next) => {
    const n = (x: any) => (options.blastRadius === false ? next(x) : blastRadiusBash($, x, next))
    return options.mergeSweep === false ? n(e) : mergeSweepBash($, e, n)
  }).catch(($, e, next) =>
    // ask rejects when nobody can answer (-p run): refuse rather than run it
    next.called || options.blastRadius === false ? next(e) : { deny: `${$.plugin.name}: could not confirm a destructive command.` },
  )
  if (options.secretSentry !== false) secretSentry(on)
  on('session.start', ($, e, next) => {
    const n4 = (x: any) => next(x)
    const n3 = (x: any) => (options.promptCoach === false ? n4(x) : promptCoachSessionStart($, x, n4))
    const n2 = (x: any) => (options.selfCritique === false ? n3(x) : selfCritiqueSessionStart($, x, n3))
    const n1 = (x: any) => (options.assumptionTracker === false ? n2(x) : assumptionTrackerSessionStart($, x, n2))
    return options.reflect === false ? n1(e) : reflectSessionStart($, e, n1)
  })
  if (options.reflect !== false) on('command.run', { command: 'reflect-queue' }, reflectCommandRunReflectQueue)
  if (options.reflect !== false) on('command.run', { command: 'reflect-pause' }, reflectCommandRunReflectPause)
  on('prompt.submit', ($, e, next) => {
    const n2 = (x: any) => (options.promptCoach === false ? next(x) : promptCoachPromptSubmit($, x, next)) // last, so reflect and assumption-tracker see the original first
    const n1 = (x: any) => (options.assumptionTracker === false ? n2(x) : assumptionTrackerPromptSubmit($, x, n2))
    return options.reflect === false ? n1(e) : reflectPromptSubmit($, e, n1)
  })
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const n2 = (x: any) => (options.mergeSweep === false ? next(x) : mergeSweepUiRenderAbovePrompt($, x, next))
    const n1 = (x: any) => (options.assumptionTracker === false ? n2(x) : assumptionTrackerUiRenderAbovePrompt($, x, n2))
    return options.reflect === false ? n1(e) : reflectUiRenderAbovePrompt($, e, n1)
  })
  if (options.assumptionTracker !== false) on('command.run', { command: 'assumptions' }, assumptionTrackerCommandRunAssumptions)
  on('turn.complete', ($, e, next) => {
    const n2 = (x: any) => (options.mergeSweep === false ? next(x) : mergeSweepTurnComplete($, x, next))
    const n1 = (x: any) => (options.selfCritique === false ? n2(x) : selfCritiqueTurnComplete($, x, n2))
    return options.assumptionTracker === false ? n1(e) : assumptionTrackerTurnComplete($, e, n1)
  })
  if (options.assumptionTracker !== false) on('ui.render', { component: 'Pane', requestId: 'assumptions' }, assumptionTrackerUiRenderPaneAssumptions)
  if (options.selfCritique !== false) on('command.run', { command: 'critique' }, selfCritiqueCommandRunCritique)
  if (options.selfCritique !== false) on('ui.render', { component: 'Pane', requestId: 'critique' }, selfCritiqueUiRenderPaneCritique)
  if (options.promptCoach !== false) on('command.run', { command: 'sharpen' }, promptCoachCommandRunSharpen)
  if (options.promptCoach !== false) on('ui.render', { component: 'Pane', requestId: 'coach' }, promptCoachUiRenderPaneCoach)
}
