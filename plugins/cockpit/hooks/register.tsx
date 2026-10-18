import type { Register } from 'claude-code'
import { band, beginPass, item, quiet, quietLine, type BandSpec } from './band'
import { fileBadge, folderIcon, iconTile, panel, pill, sectionLabel, tile } from './kit'
import { P, RAMP, type Tone, below, fmtCost, fmtDur, fmtSize, fmtTok, isRich, parsePorcelain, zoneTone } from './ui'

// ===== agents-progress =====
type Agent = { id: string; type: string; desc: string; model?: string; startedAt: number; endedAt?: number; failed?: boolean }

let agents: Agent[] = []
let subTools = 0 // tool calls made inside subagents; ponytail: not split per agent, no id link on spawn
let cost = 0
let ctxTokens = 0
let showFinished = true
type Todo = { id?: string; content: string; status: string; activeForm?: string }
let todos: Todo[] = [] // main session's TodoWrite list, or its TaskCreate/TaskUpdate tasks (keyed by id)

function agentsProgressRedraw($: any) { return $.ui.invalidate('ui.render') }
const running = () => agents.filter(a => a.endedAt === undefined)
const finished = () => agents.filter(a => a.endedAt !== undefined)
const pctDone = () => (agents.length ? (finished().length / agents.length) * 100 : 0)
const TIERS = [P.accent, P.info, P.ok, P.warn, P.purple, P.teal]
// A stable colour per subagent type, so "Explore" is always the same tier colour.
const tierColor = (type: string) => TIERS[[...type].reduce((n, c) => n + c.charCodeAt(0), 0) % TIERS.length] as string
const tone = (a: Agent): Tone => (a.endedAt === undefined ? 'accent' : a.failed ? 'err' : 'ok')
const clock = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')}`

async function agentsProgressSync($: any) {
  const u = await $.session.usage()
  cost = u.cost?.usd ?? cost
  ctxTokens = u.context.tokens ?? ctxTokens
  agentsProgressRedraw($)
}

export async function agentsProgressSessionStart($: any, e: any, next: any) {
  await $.command.register({ name: 'agents-info', description: 'Show the subagents panel' })
  $.clock.every(1000, () => running().length && agentsProgressRedraw($)) // elapsed-time tick
  $.clock.every(8000, () => running().length && void agentsProgressSync($))
  return next(e)
}

export async function agentsProgressCommandRunAgentsInfo($: any) {
  await $.ui.open({ id: 'agents', title: 'Agents' })
  return { text: 'Agents panel opened.' }
}

export async function agentsProgressAgentSpawn($: any, e: any, next: any) {
  const a: Agent = { id: e.tool_use_id, type: e.subagentType, desc: e.description, startedAt: await $.clock.now() }
  agents = [...agents, a].slice(-50)
  agentsProgressRedraw($)
  const r = await next(e)
  a.endedAt = await $.clock.now()
  a.failed = r.deny !== undefined
  a.model = r.model
  void agentsProgressSync($)
  return r
}

export async function agentsProgressToolCall($: any, e: any, next: any) {
  if (e.agentId !== undefined) {
    subTools += 1
    return next(e)
  }
  if (e.tool === 'TodoWrite' && Array.isArray(e.todos)) {
    todos = e.todos
    agentsProgressRedraw($)
  } else if (e.tool === 'TaskCreate') {
    const r = await next(e)
    const id = r.result?.task?.id
    if (id !== undefined && !r.isError) {
      todos = [...todos, { id: String(id), content: e.subject, status: 'pending', activeForm: e.activeForm }]
      agentsProgressRedraw($)
    }
    return r
  } else if (e.tool === 'TaskUpdate') {
    const r = await next(e)
    if (!r.isError && r.deny === undefined) {
      todos = (e.status === 'deleted'
        ? todos.filter(t => t.id !== e.taskId)
        : todos.map(t => (t.id === e.taskId ? { ...t, content: e.subject ?? t.content, status: e.status ?? t.status, activeForm: e.activeForm ?? t.activeForm } : t)))
      agentsProgressRedraw($)
    }
    return r
  }
  return next(e)
}

export async function agentsProgressUiRenderAbovePrompt($: any, e: any, next: any) {
  if (e.props.hasSurvey) return next(e)
  const live = running()
  const nested = await below(next, e)
  if (live.length) {
    const open = () => $.ui.open({ id: 'agents', title: 'Agents' })
    quiet({
      key: 'agents',
      text: `${live.length} agent${live.length > 1 ? 's' : ''} running`,
      onPress: open,
      spec: {
        title: 'Agents',
        tone: 'accent',
        busy: true,
        pct: pctDone(),
        pctLabel: `${live.length} running · ${finished().length}/${agents.length}`,
        buttons: [{ key: 'open', label: `×${agents.length}`, plain: true, onPress: open }],
      },
    })
  }
  const done = todos.filter(t => t.status === 'completed').length
  if (todos.length > 0 && done < todos.length) {
    const cur = todos.find(t => t.status === 'in_progress')
    const title = cur ? cur.activeForm || cur.content : 'Next: ' + (todos.find(t => t.status !== 'completed')?.content ?? '')
    quiet({
      key: 'todos',
      text: `${title.length > 40 ? `${title.slice(0, 39)}…` : title} ${done}/${todos.length}`,
      spec: { title, tone: 'accent', busy: Boolean(cur), pct: (done / todos.length) * 100, pctLabel: `Progress ${done}/${todos.length}` },
    })
  }
  return nested
}

export async function agentsProgressUiRenderPaneAgents($: any, e: any) {
  const ui = $.ui.resolve(e)
  const { Box, Text, Button } = ui
  const now = await $.clock.now()
  const first = agents.length ? Math.min(...agents.map(a => a.startedAt)) : now
  const last = running().length ? now : Math.max(first, ...agents.map(a => a.endedAt ?? 0))
  const card = (a: Agent) =>
    item(ui, e, {
      key: a.id,
      tone: tone(a),
      avatar: [...a.type.replace(/^[^:]*:/, '')][0]?.toUpperCase() ?? '?',
      title: a.desc || a.type,
      sub: `${a.type}${a.model ? ` · ${a.model}` : ''}`,
      subColor: tierColor(a.type),
      chip: a.endedAt === undefined ? 'working' : a.failed ? 'failed' : 'done',
      meta: clock((a.endedAt ?? now) - a.startedAt),
      pct: a.endedAt === undefined ? 'busy' : 100,
      busy: a.endedAt === undefined,
    })
  const live = running()
  const done = [...finished()].reverse()

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>Subagents</Text>
      <Box flexDirection="row" gap={1}>
        {tile(ui, e, 'Cost', `≈${fmtCost(cost)}`)}
        {tile(ui, e, 'Context', fmtTok(ctxTokens))}
        {tile(ui, e, 'Time', clock(last - first))}
      </Box>
      {agents.length === 0 ? <Text color={P.muted}>No subagents yet. They appear here the moment Claude spawns one.</Text> : null}
      {live.length ? <Text color={P.muted}>{`Running · ${live.length}`}</Text> : null}
      {[...live].reverse().map(card)}
      {done.length ? (
        <Button key="fin" plain label={`${showFinished ? '▾' : '▸'} Finished · ${done.length}`} onPress={() => { showFinished = !showFinished; agentsProgressRedraw($) }} />
      ) : null}
      {showFinished ? done.map(card) : null}
      {subTools ? <Text color={P.muted}>{`${subTools} tool calls inside subagents`}</Text> : null}
    </Box>
  )
}

// ===== cache-keeper =====
const TTL = 60 * 60_000 // main cache lifetime; ponytail: 1h only, read promptCacheTtl if 5m billing matters
const PING_AFTER = 50 * 60_000
const WARN_BEFORE = 5 * 60_000
const MIN_GUARD_TOKENS = 50_000
const DEFAULT_WINDOW = 6 * 3_600_000

// $/MTok: [1h cache write, cache read]. ponytail: two rows, extend the table per model.
const price = (model: string) => (/fable/i.test(model) ? [20, 0.25] : [4, 0.2])

const parseDuration = (s: string) => {
  const m = /^(?:(\d+)h)?(?:(\d+)m)?$/.exec(s.trim())
  return m && (m[1] || m[2]) ? (Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)) * 60_000 : undefined
}

const mins = (ms: number) => `${Math.max(0, Math.round(ms / 60_000))}m`

let lastTouch = 0 // last time the cache was written or read
let warnedCold = false
let warnedSoon = false
let warmUntil = 0
let lastPing = ''
let cacheKeeperTokens = 0
let cacheKeeperRates = [4, 0.2]

// Cost in dollars of sending the whole context at a $/MTok rate: [0] cold (cache write), [1] warm (cache read).
const cacheCost = (i: 0 | 1) => fmtCost((cacheKeeperTokens * cacheKeeperRates[i]) / 1e6)

async function cacheKeeperSync($: any) {
  const { context } = await $.session.usage()
  cacheKeeperTokens = context.tokens ?? cacheKeeperTokens
  cacheKeeperRates = price(await $.session.model())
  $.ui.invalidate('ui.render')
}

async function cacheKeeperTouch($: any) {
  lastTouch = await $.clock.now()
  warnedCold = false
  warnedSoon = false
  await cacheKeeperSync($)
}

export async function cacheKeeperSessionStart($: any, e: any, next: any) {
  await $.command.register({ name: 'keepwarm', description: 'Keep the prompt cache warm: /keepwarm [90m|2h|off|status]' })
  await $.command.register({ name: 'cache-tax', description: 'Show prompt cache state and rewrite cost' })
  lastTouch = await $.clock.now()
  void cacheKeeperSync($)

  $.clock.every(30_000, async () => {
    const now = await $.clock.now()
    const idle = now - lastTouch
    if (lastTouch && TTL - idle < WARN_BEFORE && TTL - idle > 0 && !warnedSoon && warmUntil < now) {
      warnedSoon = true
      $.ui.toast('Cache goes cold in under 5 minutes. /keepwarm to hold it.')
    }
    if (warmUntil > now && idle >= PING_AFTER && idle < TTL) {
      const r = await $.model.fork({ prompt: 'Reply with the single word: ok' })
      if (r.isAnswered) {
        lastTouch = now
        lastPing = `read ${fmtTok(r.usage.cache_read_input_tokens)}`
        if (r.usage.cache_read_input_tokens === 0) {
          warmUntil = 0 // ping wrote instead of read: cache was already cold, stop paying
          lastPing += ', cold: stopped'
        }
      } else if (r.reason !== 'nothing-to-fork') {
        lastPing = `ping failed: ${r.reason}`
      }
    }
    $.ui.invalidate('ui.render')
  })
  return next(e)
}

export async function cacheKeeperCommandRunKeepwarm($: any, e: any) {
  try {
  const now = await $.clock.now()
  const arg = (e.args ?? "").trim()
  if (arg === 'off') {
    warmUntil = 0
    $.ui.invalidate('ui.render')
    return { text: 'keepwarm off.' }
  }
  if (arg === 'status') {
    return { text: warmUntil > now ? `keepwarm armed ${mins(warmUntil - now)} more. Last ping: ${lastPing || 'none'}` : 'keepwarm off.' }
  }
  const window = arg === '' ? DEFAULT_WINDOW : parseDuration(arg)
  if (window === undefined) return { text: 'Usage: /keepwarm [90m|2h30m|off|status]' }
  warmUntil = now + window
  $.ui.invalidate('ui.render')
  return { text: `keepwarm armed for ${mins(window)}. Pings are cheap cache reads, but they do cost tokens.` }
  } catch (err) {
    return { text: `keepwarm failed: ${(err as Error).message}` }
  }
}

export async function cacheKeeperCommandRunCacheTax($: any) {
  await cacheKeeperSync($)
  const now = await $.clock.now()
  const left = TTL - (now - lastTouch)
  return {
    text: `cache ${left > 0 ? `warm ${mins(left)} left` : 'cold'} | context ${cacheKeeperTokens} tok | cold send ≈ ${cacheCost(0)} vs warm ${cacheCost(1)}`,
  }
}

export async function cacheKeeperPromptSubmit($: any, e: any, next: any) {
  const now = await $.clock.now()
  const isSlash = e.text.trimStart().startsWith('/')
  const isCold = lastTouch > 0 && now - lastTouch >= TTL
  if (isCold && !warnedCold && !isSlash && e.origin.kind !== 'plugin') {
    await cacheKeeperSync($)
    if (cacheKeeperTokens >= MIN_GUARD_TOKENS) {
      warnedCold = true
      let choice = ''
      try {
        choice = await $.ui.ask(`The cache went cold ${mins(now - lastTouch - TTL)} ago. Sending rewrites up to ${fmtTok(cacheKeeperTokens)} tokens ≈ ${cacheCost(0)} (warm: ${cacheCost(1)}). Continue here or start a new session?`, {
          header: 'Cache cold',
          options: ['Continue here', 'New session'],
        })
      } catch {
        return { drop: 'cache-keeper: cache is cold, prompt not sent. Send again to continue here.' }
      }
      if (choice === 'New session') {
        // command.run from inside prompt.submit would wait on this very turn: clear once the hook has returned
        $.clock.after(0, () => $.command.run({ command: 'clear', args: '' }))
        return { drop: 'cache-keeper: started a new session. Send your prompt again.' }
      }
    }
  }
  return next(e)
}

export async function cacheKeeperTurnComplete($: any, e: any, next: any) {
  if (e.agentId === undefined) await cacheKeeperTouch($)
  return next(e)
}

export async function cacheKeeperUiRenderAbovePrompt($: any, e: any, next: any) {
  if (e.props.hasSurvey || lastTouch === 0) return next(e)
  const now = await $.clock.now()
  const left = TTL - (now - lastTouch)
  const warm = left > 0
  const calm = left >= WARN_BEFORE // the full band shows only when the cache is about to go cold, or already is
  const keeping = warmUntil > now
  const cold$ = cacheCost(0)
  const warm$ = cacheCost(1)
  const spec: BandSpec = {
    title: warm ? `Cache warm · ${mins(left)} left` : 'Cache cold',
    tone: calm ? 'ok' : !warm ? 'err' : 'warn',
    ring: true,
    pct: warm ? Math.max(0, (left / TTL) * 100) : 100,
    busy: !warm,
    detail: warm ? `${fmtTok(cacheKeeperTokens)} ctx · next send ${warm$}` : `${fmtTok(cacheKeeperTokens)} ctx · next send rewrites it ${cold$} (warm ${warm$})`,
    chips: keeping ? [`keepwarm ${mins(warmUntil - now)}`] : [],
    right: keeping ? lastPing || 'no ping yet' : undefined,
    buttons: [{ key: 'kw', label: keeping ? 'Stop keepwarm' : 'Keep warm', onPress: () => void $.command.run({ command: 'keepwarm', args: keeping ? 'off' : '' }) }],
  }
  const nested = await below(next, e)
  if (!calm) return band($.ui.resolve(e), e, nested, spec)
  quiet({ key: 'cache', text: `Cache ${mins(left)}`, spec })
  return nested
}

// ===== context-health =====
const HANDOFF_FILE = '.claude/handoff.md'
const HANDOFF_PROMPT = `Write a handoff brief to ${HANDOFF_FILE} so a fresh session can continue this work: goal, decisions made, files touched, current state, exact next steps. Keep it under 60 lines. Reply "handoff written" when done.`

let percent = 0
let contextHealthTokens = 0
let windowSize = 0
let contextHealthRates: { kind: string; percentUsed: number }[] = []
let threshold = 50 // ponytail: stored per session; persist via $.store if wanted across sessions
let auto = false
let handingOff = false

let lastRefresh = 0
let turnNo = 0
let speed = 0 // last measured output tok/s of the main session
let costNow = 0
let costAtStart = 0
let bandHidden = false // closed with ×, for the rest of the session

async function refresh($: any, force = false) {
  const now = await $.clock.now()
  if (!force && now - lastRefresh < 2000) return
  lastRefresh = now
  const { context, rateLimits, cost } = await $.session.usage()
  costNow = cost?.usd ?? costNow
  percent = Math.round(context.percent ?? 0)
  contextHealthTokens = context.tokens ?? 0
  windowSize = context.window ?? 0
  contextHealthRates = rateLimits ?? []
  $.ui.invalidate('ui.render')
}

function startHandoff($: any) {
  handingOff = true
  // the host refuses a submit made from inside the /ctx-handoff command turn: send it from a later tick
  $.clock.after(0, () => $.prompt.submit({ text: HANDOFF_PROMPT }))
}

export async function contextHealthSessionStart($: any, e: any, next: any) {
  await $.command.register({ name: 'ctx-handoff', description: 'Write a handoff brief, clear, and continue in a fresh context' })
  await $.command.register({ name: 'autohandoff', description: 'Auto handoff at a context %: /autohandoff [percent|off]' })
  return next(e)
}

export async function contextHealthTurnStart($: any, e: any, next: any) {
  if (e.agentId === undefined) {
    turnNo += 1
    costAtStart = (await $.session.usage()).cost?.usd ?? costNow
    costNow = costAtStart
  }
  return next(e)
}

// Times each main-session response from its first chunk to its stop usage; stubs and instant bursts are dropped.
export async function* contextHealthTurnStep($: any, e: any, next: any) {
  if (e.agentId !== undefined) return yield* next(e)
  let startedAt: number | null = null
  for await (const chunk of next(e)) {
    if (startedAt === null) startedAt = await $.clock.now()
    if (chunk.kind === 'stop' && chunk.usage) {
      const secs = ((await $.clock.now()) - startedAt) / 1000
      const rate = chunk.usage.output_tokens / secs
      if (chunk.usage.output_tokens >= 50 && secs >= 1 && rate <= 400) speed = Math.round(rate)
    }
    yield chunk
  }
}

export async function contextHealthCommandRunHandoff($: any) {
  startHandoff($)
  return { text: 'Writing handoff…' }
}

export async function contextHealthCommandRunAutohandoff(_$: any, e: any) {
  const n = Number((e.args ?? "").trim())
  if ((e.args ?? "").trim() === 'off') auto = false
  else {
    auto = true
    if (n >= 10 && n <= 95) threshold = n
  }
  return { text: auto ? `Auto handoff at ${threshold}% context.` : 'Auto handoff off.' }
}

// Keep the band live while context grows (tool results) or shrinks (compact/clear).
export async function contextHealthToolCall($: any, e: any, next: any) {
  const done = await next(e)
  if (e.agentId === undefined) await refresh($)
  return done
}

export async function contextHealthPromptSubmit($: any, e: any, next: any) {
  const done = await next(e)
  await refresh($)
  return done
}

export async function contextHealthTurnComplete($: any, e: any, next: any) {
  if (e.agentId !== undefined) return next(e)
  const done = await next(e)
  if (handingOff) {
    handingOff = false
    // Clear only when the handoff turn finished and wrote its file: otherwise the context would be lost for nothing.
    if (e.reason !== 'answer' || !(await $.fs.exists(`${await $.session.cwd()}/${HANDOFF_FILE}`))) {
      $.ui.toast('Handoff did not finish: context kept.')
      return done
    }
    await $.command.run({ command: 'clear', args: '' })
    await refresh($, true)
    await $.prompt.fill({ text: `Read ${HANDOFF_FILE} and continue from there.` })
    $.ui.toast('Handoff ready: press Enter to continue in the fresh session.')
  } else {
    await refresh($, true)
    if (auto && percent >= threshold) startHandoff($)
  }
  return done
}

export async function contextHealthUiRenderAbovePrompt($: any, e: any, next: any) {
  if (e.props.hasSurvey || percent === 0 || bandHidden) return next(e)
  const high = percent >= threshold
  const limits = contextHealthRates.map(r => `${r.kind.replace('five_hour', '5h').replace('seven_day', '7d')} ${Math.round(r.percentUsed)}%`).join(' · ')
  const ctxChips = [
    ...(turnNo ? [`turn ${turnNo}`] : []),
    ...(speed ? [`${speed} tok/s`] : []),
    ...(costNow ? [`${fmtCost(Math.max(0, costNow - costAtStart))} · ${fmtCost(costNow)}`] : []),
    ...(auto ? [`auto @${threshold}%`] : []),
  ]
  const ctxTone = zoneTone(percent, threshold - 10, threshold)
  const spec: BandSpec = {
    title: `Context ${percent}%`,
    tone: ctxTone,
    ring: true,
    pct: percent,
    detail: high ? 'quality may drop: hand off or start fresh' : `${fmtTok(contextHealthTokens)} of ${fmtTok(windowSize)} tokens`,
    right: limits || undefined,
    chips: ctxChips,
    buttons: [
      ...(high
      ? [
          { key: 'h', label: 'Handoff', hotkey: 'h', onPress: () => startHandoff($) },
          { key: 'f', label: 'Fresh', hotkey: 'f', plain: true, onPress: () => void $.command.run({ command: 'clear', args: '' }) },
        ]
      : []),
      { key: 'x', label: '×', plain: true, onPress: () => { bandHidden = true; void $.ui.invalidate('ui.render') } },
    ],
  }
  const nested = await below(next, e)
  if (ctxTone !== 'ok') return band($.ui.resolve(e), e, nested, spec)
  quiet({ key: 'context', text: `Context ${percent}%`, spec })
  return nested
}

// ===== filetree =====
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
let committedSet = new Set<string>() // files in commits not pushed yet (or the last commit)
const seen = new Set<string>() // changed files already auto-expanded once

function filetreeRedraw($: any) { return $.ui.invalidate('ui.render') }
const rel = (p: string) => (p.startsWith(`${root}/`) ? p.slice(root.length + 1) : p)
const dirOf = (p: string) => p.slice(0, p.lastIndexOf('/'))
const base = (p: string) => p.slice(p.lastIndexOf('/') + 1)
const ago = (ms: number) => {
  const m = Math.floor(ms / 60_000)
  return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.floor(m / 60)}h ago` : `${Math.floor(m / 1440)}d ago`
}
// Git state in words, not letters: "new", "modified", "deleted".
const WORD: Record<string, string> = { '?': 'new', A: 'new', M: 'modified', T: 'modified', D: 'deleted', R: 'renamed', C: 'copied', U: 'conflict' }

async function refreshGit($: any) {
  const st = await $.process.run(['git', 'status', '-sb', '--porcelain', '-z'], { cwd: root, timeoutMs: 5000 }).catch(() => undefined)
  changes = new Map()
  branch = upstream = ''
  ahead = behind = 0
  if (st?.exitCode === 0) {
    const top = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { cwd: root }).catch(() => undefined)
    const b = top?.exitCode === 0 ? top.stdout.trim() : root
    const [header = '', ...rest] = st.stdout.split('\0') as string[]
    const head = /^## (\S+?)(?:\.\.\.(\S+))?(?: \[(.+)\])?$/.exec(header)
    branch = head?.[1] ?? ''
    upstream = head?.[2] ?? ''
    ahead = Number(/ahead (\d+)/.exec(head?.[3] ?? '')?.[1] ?? 0)
    behind = Number(/behind (\d+)/.exec(head?.[3] ?? '')?.[1] ?? 0)
    for (const r of parsePorcelain(rest.join('\0'))) changes.set(`${b}/${r.path}`, { st: r.st.trim()[0] ?? '?', add: 0, del: 0 })
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
  filetreeRedraw($)
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
    if (x.kind === 'dir' && expand(path) && x.name !== '.git') await walk($, path, depth + 1, out, expand)
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
  filetreeRedraw($)
}

function startTick($: any) {
  if (ticking) return
  ticking = true
  const loop = () => {
    const live = activity?.running || [...touched.values()].some(m => Date.now() - m.at < GLOW_MS)
    phase += 1
    filetreeRedraw($)
    if (live) $.clock.after(130, loop)
    else ticking = false
  }
  $.clock.after(130, loop)
}

function filetreeTouch($: any, path: string | undefined, state: State) {
  if (!path) return
  const abs = path.startsWith('/') ? path : `${root}/${path}`
  touched.set(abs, { state, at: Date.now() })
  for (let d = dirOf(abs); d.length > root.length; d = dirOf(d)) open.add(d)
  if (state === 'edited' || state === 'editing') allFiles = undefined
  void rebuild($)
  startTick($)
}

function say($: any, a: Activity) {
  activity = a
  startTick($)
  filetreeRedraw($)
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
  if (p) filetreeTouch($, p, state)
  say($, { state, label: isRead ? `Claude is reading ${target}` : isWrite ? `Claude is editing ${target}` : `Claude is running ${target}`, target: where, running: true, at: Date.now() })
  const ran = await next(e)
  const failed = ran.deny !== undefined || ran.isError === true
  const doneState: State = isRead ? 'opened' : isWrite ? 'edited' : 'committed'
  if (p && !failed) filetreeTouch($, p, doneState)
  say($, { state: doneState, label: isRead ? `Claude read ${target}` : isWrite ? `Claude edited ${target}` : `Claude ran ${target}`, target: where, running: false, at: Date.now(), failed })
  if (!isRead) void refreshGit($)
  if (git === 'commit' && !failed) {
    const shown = await $.process.run(['git', 'show', '--name-only', '--pretty=format:', 'HEAD'], { cwd: root, timeoutMs: 5000 }).catch(() => undefined)
    const top = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { cwd: root }).catch(() => undefined)
    for (const f of (shown?.stdout ?? '').split('\n').filter(Boolean)) filetreeTouch($, `${top?.stdout.trim() ?? root}/${f}`, 'committed')
  }
  return ran
}

export function filetreePromptSubmit($: any, e: any, next: any) {
  for (const m of e.text.matchAll(/@([\w./-]+)/g)) if (m[1].includes('/') || m[1].includes('.')) filetreeTouch($, m[1], 'opened')
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
    size: () => { showSize = !showSize; filetreeRedraw($) },
    hidden: () => { showHidden = !showHidden; allFiles = undefined; void rebuild($) },
    up: () => { root = dirOf(root) || '/'; open.clear(); allFiles = undefined; void refreshGit($); void rebuild($) },
    home: () => { root = cwd; open.clear(); allFiles = undefined; void refreshGit($); void rebuild($) },
    unselect: () => { selected = ''; filetreeRedraw($) },
  }
  return isRich(ui, e) ? drawRich(ui, e, actions) : drawText(ui, e, actions)
}

export async function filetreeUiRenderAbovePrompt($: any, e: any, next: any) {
  if (e.props.hasSurvey || touched.size === 0) return next(e)
  if ((await $.ui.panes()).some(p => p.id === 'filetree')) return next(e)
  const now = Date.now()
  const live = activity && (activity.running || now - activity.at < 6_000) ? activity : undefined
  const edits = [...touched.values()].filter(t => t.state === 'edited' || t.state === 'editing').length
  const reads = touched.size - edits
  const open = () => $.ui.open({ id: 'filetree', title: `Files: ${base(root || cwd)}` })
  const nested = await below(next, e)
  quiet({
    key: 'files',
    text: `${touched.size} file${touched.size > 1 ? 's' : ''}`,
    onPress: open,
    spec: {
      title: live ? live.label : `Claude touched ${touched.size} file${touched.size > 1 ? 's' : ''}`,
      tone: live ? (live.state === 'editing' || live.state === 'edited' ? 'accent' : live.state === 'committed' ? 'ok' : 'purple') : 'purple',
      busy: live?.running,
      detail: `${reads} read · ${edits} edited`,
      buttons: [{ key: 'open', label: 'Open file tree', onPress: open }],
    },
  })
  return nested
}

// ===== usage-limits =====
const LIMIT_MS: Record<string, number> = { five_hour: 5 * 3600_000, seven_day: 7 * 86_400_000 }
const LIMIT_SHORT: Record<string, string> = { five_hour: '5h', seven_day: '7d' }

let usageLimitRates: { kind: string; percentUsed: number; resetsAt?: string }[] = []
let usageLimitWarned: Record<string, boolean> = {} // toast once per window until it drops back under 90%

function usageLimitsSet($: any, rates: any[]) {
  usageLimitRates = (rates ?? []).filter((r: any) => r.kind in LIMIT_MS)
  for (const r of usageLimitRates) {
    if (r.percentUsed >= 90 && !usageLimitWarned[r.kind]) {
      usageLimitWarned[r.kind] = true
      $.ui.toast(`${LIMIT_SHORT[r.kind]} limit at ${Math.round(r.percentUsed)}%`)
    } else if (r.percentUsed < 90) usageLimitWarned[r.kind] = false
  }
  $.ui.invalidate('ui.render')
}

const usageLeft = (ms: number) => (ms >= 86_400_000 ? `${Math.floor(ms / 86_400_000)}d${Math.floor((ms % 86_400_000) / 3600_000)}h` : fmtDur(ms))

// Burn vs time: +12% means 12 points more used than the window's elapsed share.
const usagePace = (r: { kind: string; percentUsed: number }, ms: number) => {
  const d = Math.round(r.percentUsed - 100 * (1 - ms / LIMIT_MS[r.kind]))
  return `pace ${d > 0 ? '+' : ''}${d}%`
}

export async function usageLimitsSessionStart($: any, e: any, next: any) {
  const sync = async () => usageLimitsSet($, (await $.session.usage()).rateLimits)
  await sync()
  $.clock.every(15_000, sync) // measure only fires on whole-point moves; this keeps the bars and countdowns fresh
  return next(e)
}

export async function usageLimitsSessionMeasure($: any, e: any, next: any) {
  usageLimitsSet($, e.rateLimits)
  return next(e)
}

export async function usageLimitsUiRenderAbovePrompt($: any, e: any, next: any) {
  if (e.props.hasSurvey || !usageLimitRates.length) return next(e)
  const now = await $.clock.now()
  const left = (r: { resetsAt?: string }) => (r.resetsAt ? Date.parse(r.resetsAt) - now : 0)
  const rates = [...usageLimitRates].sort((a, b) => (a.kind === 'five_hour' ? -1 : 0) - (b.kind === 'five_hour' ? -1 : 0))
  const peak = Math.max(...rates.map(r => r.percentUsed))
  const spec: BandSpec = {
    title: 'Usage limits',
    tone: zoneTone(peak, 70, 90),
    detail: rates.map(r => `${LIMIT_SHORT[r.kind]} ${left(r) > 0 ? `${usageLeft(left(r))} (${usagePace(r, left(r)).replace('pace ', '')})` : 'reset pending'}`).join(' · '),
    bars: rates.map(r => ({ pct: r.percentUsed, label: LIMIT_SHORT[r.kind], tone: zoneTone(r.percentUsed, 70, 90) })),
  }
  const nested = await below(next, e)
  if (peak >= 70) return band($.ui.resolve(e), e, nested, spec)
  quiet({ key: 'usage', text: rates.map(r => `${LIMIT_SHORT[r.kind]} ${Math.round(r.percentUsed)}%`).join(' · '), spec })
  return nested
}

// ===== token-meter =====
type TmTok = { input: number; output: number; cacheRead: number; cacheWrite: number }
const tmZero = (): TmTok => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
const tmSum = (t: TmTok) => t.input + t.output + t.cacheRead + t.cacheWrite

let tmSession = tmZero()
let tmModels: Record<string, number> = {}
let tmScan = { tokens: 0, files: 0, skipped: 0, done: false, scanning: false }
let tmLiveAtScan = 0 // session tokens already inside the scan, so the project total does not count them twice
let tmCostAtStart = 0
let tmLastTurnCost = 0
let tmTurns = 0

// Reads each past transcript of this folder once; a message streamed over several lines counts once (by id).
// shortcut: files over the 4 MiB $.fs.read limit are skipped and flagged, switch to $.process + jq if that matters.
async function tmRescan($: any) {
  if (tmScan.scanning) return
  tmScan = { ...tmScan, scanning: true }
  $.ui.invalidate('ui.render')
  const slug = (await $.session.cwd()).replace(/[^a-zA-Z0-9]/g, '-')
  const dir = `${(await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${await $.env.get('HOME')}/.claude`}/projects/${slug}`
  const seen = new Set<string>()
  let tokens = 0
  let files = 0
  let skipped = 0
  const entries = (await $.fs.exists(dir)) ? await $.fs.list(dir) : []
  for (const f of entries) {
    if (f.kind !== 'file' || !f.name.endsWith('.jsonl')) continue
    files += 1
    try {
      const text = await $.fs.read(`${dir}/${f.name}`)
      for (const line of text.split('\n')) {
        if (!line.includes('"usage"')) continue
        try {
          const m = JSON.parse(line).message
          if (!m?.usage || (m.id && seen.has(m.id))) continue
          if (m.id) seen.add(m.id)
          const u = m.usage
          tokens += (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
        } catch {}
      }
    } catch {
      skipped += 1
    }
  }
  tmLiveAtScan = tmSum(tmSession)
  tmScan = { tokens, files, skipped, done: true, scanning: false }
  $.ui.invalidate('ui.render')
}

export async function tokenMeterSessionStart($: any, e: any, next: any) {
  tmCostAtStart = (await $.session.usage()).cost?.usd ?? 0
  void tmRescan($).catch(() => {
    tmScan = { ...tmScan, scanning: false }
  })
  return next(e)
}

export async function tokenMeterTurnStart($: any, e: any, next: any) {
  if (e.agentId === undefined) {
    tmTurns += 1
    tmCostAtStart = (await $.session.usage()).cost?.usd ?? tmCostAtStart
  }
  return next(e)
}

export async function* tokenMeterTurnStep($: any, e: any, next: any) {
  for await (const chunk of next(e)) {
    if (chunk.kind === 'stop' && chunk.usage) {
      const u = chunk.usage
      tmSession.input += u.input_tokens ?? 0
      tmSession.output += u.output_tokens ?? 0
      tmSession.cacheRead += u.cache_read_input_tokens ?? 0
      tmSession.cacheWrite += u.cache_creation_input_tokens ?? 0
      const n = String(u.model ?? 'unknown').replace(/^claude-/, '')
      tmModels[n] = (tmModels[n] ?? 0) + (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
      $.ui.invalidate('ui.render')
    }
    yield chunk
  }
}

export async function tokenMeterTurnComplete($: any, e: any, next: any) {
  const done = await next(e)
  if (e.agentId === undefined) tmLastTurnCost = Math.max(0, ((await $.session.usage()).cost?.usd ?? 0) - tmCostAtStart)
  return done
}

export async function tokenMeterUiRenderAbovePrompt($: any, e: any, next: any) {
  if (e.props.hasSurvey) return next(e)
  const total = tmSum(tmSession)
  const cost = (await $.session.usage()).cost?.usd ?? 0
  const project = tmScan.tokens + (total - tmLiveAtScan)
  const models = Object.entries(tmModels).sort((a, b) => b[1] - a[1]).map(([m, n]) => `${m} ${fmtTok(n)}`).join(' · ')
  const projectLabel = !tmScan.done ? 'scanning…' : `${fmtTok(project)} tokens · ${tmScan.files} sessions${tmScan.skipped ? ` (${tmScan.skipped} too large, not counted)` : ''}`
  const spec: BandSpec = {
    title: 'Tokens',
    tone: 'info',
    detail: `this session ${fmtTok(total)}`,
    chips: [`in ${fmtTok(tmSession.input)}`, `out ${fmtTok(tmSession.output)}`, `cache read ${fmtTok(tmSession.cacheRead)}`, `cache write ${fmtTok(tmSession.cacheWrite)}`],
    rows: [
      { key: 'project', label: `Project  ${projectLabel}`, hint: 'click to rescan', onPress: () => void tmRescan($) },
      { key: 'cost', label: `Cost  ${fmtCost(cost)} session · ${fmtCost(tmLastTurnCost)} last turn${tmTurns ? ` · ${fmtCost(cost / tmTurns)}/turn` : ''}`, onPress: () => {} },
      ...(models ? [{ key: 'models', label: `Models  ${models}`, onPress: () => {} }] : []),
    ],
  }
  const nested = await below(next, e)
  quiet({ key: 'tokens', text: `${fmtTok(total)} tok`, spec })
  return nested
}

// ===== next-steps =====
const PROMPT = (answer: string) =>
  `Given the assistant's last reply below, suggest exactly 3 short, concrete next prompts the user would plausibly send next (max 12 words each, imperative). Reply with only a JSON array of 3 strings.\n\n<reply>\n${answer.slice(0, 6000)}\n</reply>`

const parse = (text: string): string[] => {
  try {
    const arr = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1))
    return Array.isArray(arr) ? arr.filter((s): s is string => typeof s === 'string').slice(0, 3) : []
  } catch {
    return []
  }
}

let steps: string[] = []
let stepsGen = 0 // a late reply for an older prompt is ignored

export function nextStepsPromptSubmit($: any, e: any, next: any) {
  steps = []
  stepsGen += 1
  $.ui.invalidate('ui.render')
  return next(e)
}

export async function nextStepsTurnComplete($: any, e: any, next: any) {
  if (e.agentId === undefined && e.reason === 'answer') {
    const gen = stepsGen
    void $.model
      .complete({ model: 'haiku', prompt: PROMPT(e.answer), maxTokens: 200, effort: 'low', timeoutMs: 15_000 })
      .then(r => {
        if (gen !== stepsGen) return
        steps = r.isAnswered ? parse(r.text) : []
        $.ui.invalidate('ui.render')
      })
  }
  return next(e)
}

export async function nextStepsUiRenderAbovePrompt($: any, e: any, next: any) {
  if (e.props.hasSurvey || steps.length === 0) return next(e)
  return band($.ui.resolve(e), e, await below(next, e), {
    title: 'Next steps',
    tone: 'info',
    detail: 'click one to put it in the prompt',
    rows: steps.map((s, i) => ({ key: `s${i}`, label: s, hotkey: String(i + 1), onPress: () => $.prompt.fill({ text: s }) })),
    buttons: [{ key: 'x', label: '×', plain: true, onPress: () => { steps = []; $.ui.invalidate('ui.render') } }],
  })
}

let lineOpen = false // the shared status line shows each mod's detail

// Each mod is on unless its userConfig flag is false (toggle in the config menu; the module reloads).
export const register: Register = (on, options) => {
  on('session.start', ($, e, next) => {
    const n6 = (x: any) => next(x)
    const n5 = (x: any) => (options.tokenMeter === false ? n6(x) : tokenMeterSessionStart($, x, n6))
    const n4 = (x: any) => (options.usageLimits === false ? n5(x) : usageLimitsSessionStart($, x, n5))
    const n3 = (x: any) => (options.filetree === false ? n4(x) : filetreeSessionStart($, x, n4))
    const n2 = (x: any) => (options.contextHealth === false ? n3(x) : contextHealthSessionStart($, x, n3))
    const n1 = (x: any) => (options.cacheKeeper === false ? n2(x) : cacheKeeperSessionStart($, x, n2))
    return options.agentsProgress === false ? n1(e) : agentsProgressSessionStart($, e, n1)
  })
  if (options.agentsProgress !== false) on('command.run', { command: 'agents-info' }, agentsProgressCommandRunAgentsInfo)
  if (options.agentsProgress !== false) on('agent.spawn', agentsProgressAgentSpawn)
  on('tool.call', ($, e, next) => {
    const n3 = (x: any) => next(x)
    const n2 = (x: any) => (options.contextHealth === false ? n3(x) : contextHealthToolCall($, x, n3))
    const n1 = (x: any) => (options.filetree === false ? n2(x) : filetreeToolCall($, x, n2))
    return options.agentsProgress === false ? n1(e) : agentsProgressToolCall($, e, n1)
  })
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    beginPass()
    const n7 = (x: any) => next(x)
    const n6 = (x: any) => (options.nextSteps === false ? n7(x) : nextStepsUiRenderAbovePrompt($, x, n7))
    const n5 = (x: any) => (options.tokenMeter === false ? n6(x) : tokenMeterUiRenderAbovePrompt($, x, n6))
    const n4 = (x: any) => (options.usageLimits === false ? n5(x) : usageLimitsUiRenderAbovePrompt($, x, n5))
    const n3 = (x: any) => (options.filetree === false ? n4(x) : filetreeUiRenderAbovePrompt($, x, n4))
    const n2 = (x: any) => (options.contextHealth === false ? n3(x) : contextHealthUiRenderAbovePrompt($, x, n3))
    const n1 = (x: any) => (options.cacheKeeper === false ? n2(x) : cacheKeeperUiRenderAbovePrompt($, x, n2))
    const drawn = await (options.agentsProgress === false ? n1(e) : agentsProgressUiRenderAbovePrompt($, e, n1))
    return quietLine($.ui.resolve(e), e, drawn, lineOpen, () => { lineOpen = !lineOpen; void $.ui.invalidate('ui.render') })
  })
  if (options.agentsProgress !== false) on('ui.render', { component: 'Pane', requestId: 'agents' }, agentsProgressUiRenderPaneAgents)
  if (options.cacheKeeper !== false) on('command.run', { command: 'keepwarm' }, cacheKeeperCommandRunKeepwarm)
  if (options.cacheKeeper !== false) on('command.run', { command: 'cache-tax' }, cacheKeeperCommandRunCacheTax)
  on('prompt.submit', ($, e, next) => {
    const n4 = (x: any) => next(x)
    const n3 = (x: any) => (options.contextHealth === false ? n4(x) : contextHealthPromptSubmit($, x, n4))
    const n2 = (x: any) => (options.nextSteps === false ? n3(x) : nextStepsPromptSubmit($, x, n3))
    const n1 = (x: any) => (options.filetree === false ? n2(x) : filetreePromptSubmit($, x, n2))
    return options.cacheKeeper === false ? n1(e) : cacheKeeperPromptSubmit($, e, n1)
  })
  on('turn.start', ($, e, next) => {
    const n1 = (x: any) => (options.tokenMeter === false ? next(x) : tokenMeterTurnStart($, x, next))
    return options.contextHealth === false ? n1(e) : contextHealthTurnStart($, e, n1)
  })
  on('turn.step', async function* ($, e, next) {
    const n1 = (x: any) => (options.tokenMeter === false ? next(x) : tokenMeterTurnStep($, x, next))
    return yield* (options.contextHealth === false ? n1(e) : contextHealthTurnStep($, e, n1))
  })
  on('turn.complete', ($, e, next) => {
    const n4 = (x: any) => next(x)
    const n3 = (x: any) => (options.tokenMeter === false ? n4(x) : tokenMeterTurnComplete($, x, n4))
    const n2 = (x: any) => (options.nextSteps === false ? n3(x) : nextStepsTurnComplete($, x, n3))
    const n1 = (x: any) => (options.contextHealth === false ? n2(x) : contextHealthTurnComplete($, x, n2))
    return options.cacheKeeper === false ? n1(e) : cacheKeeperTurnComplete($, e, n1)
  })
  if (options.contextHealth !== false) on('command.run', { command: 'ctx-handoff' }, contextHealthCommandRunHandoff)
  if (options.contextHealth !== false) on('command.run', { command: 'autohandoff' }, contextHealthCommandRunAutohandoff)
  if (options.usageLimits !== false) on('session.measure', usageLimitsSessionMeasure)
  if (options.filetree !== false) on('command.run', { command: 'filetree' }, filetreeCommandRunFiletree)
  if (options.filetree !== false) on('ui.render', { component: 'Pane', requestId: 'filetree' }, filetreeUiRenderPaneFiletree)
}
