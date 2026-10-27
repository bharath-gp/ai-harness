import type { Register } from 'claude-code'
import { band, beginPass, box, gaugeSpans, line, quiet, quietLine, type BandSpec, type Piece } from './band'
import { fileBadge, pill, sectionLabel } from './kit'
import { C, DECK, MONO, P, SVG_COLORS, below, esc, fmtClock, fmtCost, fmtDur, fmtSize, fmtTimer, fmtTok, gauge, isRich, maskSecrets, parsePorcelain, plural, prettyModel, shorten, usePalette, zoneTone } from './ui'

// ===== shared drawing =====
// The look and the pane follow claude-flightdeck (MIT, see THIRD_PARTY_NOTICES.md).
// After a surface module faults on a surface, it is drawn there without animation; other surfaces keep theirs.
const faulted = new Set<string>()

// A connector carrying packets while `active`, a still faint line otherwise or where the surface cannot run a surface
// module. `marks` are cells where a branch drops (┬) or merges (┴). The module path must be a literal in this file.
export function rail(ui: any, e: any, key: string, active: boolean, color: string, width: number, marks: number[] = [], isMerge = false) {
  const { Text } = ui
  if (!DECK.motion || !('Client' in ui) || faulted.has(`${e.surface}:rail.tsx`)) {
    const cells = Array.from({ length: Math.max(1, width) }, () => '─')
    for (const m of marks) if (m >= 0 && m < cells.length) cells[m] = isMerge ? '┴' : '┬'
    return <Text key={key} color={C.faint} mono>{cells.join('')}</Text>
  }
  return <ui.Client key={key} module="./rail.tsx" width={width} height={1} props={{ active, width, color, dim: C.faint, marks, isMerge }} />
}

// A running clock that ticks on the surface's own frame clock, so the pane does not redraw every second.
export function liveClock(ui: any, e: any, key: string, since: number, now: number, endAt: number | null, color: string) {
  const { Text } = ui
  if (since <= 0) return <Text color={color}>—</Text>
  if (!('Client' in ui) || faulted.has(`${e.surface}:elapsed.tsx`)) return <Text color={color}>{fmtTimer((endAt ?? now) - since)}</Text>
  return <ui.Client key={key} module="./elapsed.tsx" props={{ since, now, endAt, color }} />
}

// Passes a turn.step stream through, calling `see` on each chunk, and returns its result to the hooks above.
async function* tap(stream: any, see: (chunk: any) => unknown) {
  const it = stream[Symbol.asyncIterator]()
  for (let r = await it.next(); ; r = await it.next()) {
    if (r.done) return r.value
    await see(r.value)
    yield r.value
  }
}

// ===== cockpit pane =====
// The shell every mod draws into: one docked pane (inline as an 8-row summary on the terminal's main screen), its
// header, the main model's vitals and the turn the architect and receipt read. Not a mod: it has no toggle.
const PANE = 'cockpit'
let cockpitCfg = { layout: 'auto', maxCards: 3, paneColumns: 66, openOnStart: true }
let deckModel = ''
let deckEffort = ''
let deckMode = ''
let deckSteps = 0
let deckRunning = false
let deckTtft: number | null = null
let deckLayout: string | null = null // /cockpit layout override, for this session
// The main turn so far: edits from every loop, errors from the main loop only (a subagent's failure is its own).
let deckTurn = { edits: 0, errors: 0, errorStreak: 0, startedAt: 0, costAtStart: null as number | null, isReviewing: false }

function cockpitOpen($: any) {
  // columns apply when docked beside the transcript, rows when seated inline above the prompt.
  return $.ui.open({ id: PANE, title: 'Cockpit', columns: cockpitCfg.paneColumns, rows: 8 })
}

async function paneIsOpen($: any, id: string) {
  try {
    return (await $.ui.panes()).some((p: any) => p.id === id)
  } catch {
    return false
  }
}

export async function cockpitSessionStart($: any, e: any, next: any) {
  await $.command.register({ name: 'cockpit', description: 'Cockpit pane: open, close, reset, or set the layout', argumentHint: '[open|close|reset|layout auto|compact|wide|mini]' })
  deckModel = await Promise.resolve($.session.model()).catch(() => '') // until the first request names it
  if (cockpitCfg.openOnStart) void Promise.resolve(cockpitOpen($)).catch(() => undefined)
  return next(e)
}

export async function cockpitCommandRun($: any, e: any) {
  const [verb = 'open', arg = ''] = (e.args ?? '').trim().split(/\s+/)
  if (verb === 'close') {
    await $.ui.close({ id: PANE })
    return { text: 'Cockpit closed.' }
  }
  if (verb === 'reset') {
    cockpitReset()
    $.ui.invalidate('ui.render')
    return { text: 'Cockpit reset.' }
  }
  if (verb === 'layout') {
    if (!['auto', 'compact', 'wide', 'mini'].includes(arg)) return { text: 'Usage: /cockpit layout auto|compact|wide|mini' }
    deckLayout = arg
    const opened = await cockpitOpen($)
    return { text: opened.isPlaced ? `Cockpit layout: ${arg}.` : `Layout set to ${arg}; the pane is not shown yet: ${opened.reason}` }
  }
  const opened = await cockpitOpen($)
  if (!opened.isPlaced) return { text: `Cockpit is not shown yet: ${opened.reason}` }
  return { text: 'Cockpit opened. Focus it with ctrl+x tab: 1-6 expand agents, f/s/o open the gate rows, h hands off, k keeps the cache warm, t shows token details, d decision details.' }
}

// Clears what the panels collected this session (agents, consults, checks, loops, log, receipt); cost and limits stay.
function cockpitReset() {
  agents = []
  subTools = 0
  bgTasks = []
  mainTool = ''
  archConsults = []
  archIds = []
  archAdvice = ''
  gateRecent = []
  gateTotals = gateZero()
  loopsList = []
  logLines = []
  receiptLast = null
  deckTurn = { ...deckTurn, edits: 0, errors: 0, errorStreak: 0, isReviewing: false }
}

export async function cockpitSessionEnd($: any, e: any, next: any) {
  if (e.reason === 'clear') cockpitReset()
  return next(e)
}

export function cockpitUserPromptSubmit(_$: any, e: any, next: any) {
  if (e.permission_mode) deckMode = e.permission_mode
  return next(e)
}

export async function cockpitTurnStart($: any, e: any, next: any) {
  if (e.agentId === undefined) {
    deckRunning = true
    deckTurn = { edits: 0, errors: 0, errorStreak: 0, startedAt: await $.clock.now(), costAtStart: (await $.session.usage().catch(() => null))?.cost?.usd ?? null, isReviewing: false }
    $.ui.invalidate('ui.render')
  }
  return next(e)
}

// The main loop's model is known when its request starts; its time to first token is timed as the stream passes.
export async function* cockpitTurnStep($: any, e: any, next: any) {
  if (e.agentId !== undefined) return yield* next(e)
  deckModel = e.model
  deckEffort = String(e.effort ?? deckEffort)
  deckSteps += 1
  const sentAt = await $.clock.now()
  let firstAt: number | null = null
  const result = yield* tap(next(e), async (c: any) => {
    if (firstAt === null && c.kind !== 'engine' && c.kind !== 'stop') firstAt = await $.clock.now()
  })
  if (firstAt !== null) deckTtft = Math.max(0, firstAt - sentAt)
  return result
}

export async function cockpitToolCall($: any, e: any, next: any) {
  const ran = await next(e)
  const didRun = ran.deny === undefined
  const hasFailed = didRun && ran.isError === true
  const isEdit = didRun && !hasFailed && ['Edit', 'Write', 'NotebookEdit'].includes(String(e.tool))
  const inSub = e.agentId !== undefined
  deckTurn = {
    ...deckTurn,
    errorStreak: inSub ? deckTurn.errorStreak : hasFailed ? deckTurn.errorStreak + 1 : 0,
    errors: deckTurn.errors + (!inSub && hasFailed ? 1 : 0),
    edits: deckTurn.edits + (isEdit ? 1 : 0),
  }
  return ran
}

export async function cockpitTurnComplete($: any, e: any, next: any) {
  const done = await next(e)
  if (e.agentId === undefined) {
    deckRunning = false
    $.ui.invalidate('ui.render')
  }
  return done
}

// The main box: model, effort, mode, requests, then each enabled mod's rows, then the last request's ttft.
function cockpitMainPanel($: any, ui: any, e: any, w: number, now: number, options: any) {
  const { Box, Text } = ui
  const effortN = ({ low: 1, medium: 2, high: 3, xhigh: 4, max: 4 } as Record<string, number>)[deckEffort] ?? 0
  return box(ui, {
    key: 'main',
    color: C.main,
    title: `${prettyModel(deckModel)} · main`,
    right: deckRunning ? '● working' : '○ idle',
    w,
    children: (
      <Box flexDirection="column">
        {line(ui, [
          { spans: [{ text: 'effort ', dim: true }, { text: `${'▮'.repeat(effortN)}${'▯'.repeat(4 - effortN)} `, color: C.main }, { text: deckEffort || '—', color: C.main, bold: true }] },
          deckMode ? { spans: [{ text: `mode ${deckMode}`, dim: true }] } : null,
          { spans: [{ text: `${deckSteps} req`, dim: true }] },
        ], w - 4, 3)}
        {options.contextHealth !== false ? contextHealthPaneRow($, ui, w) : null}
        {options.usageLimits !== false ? usageLimitsPaneRow(ui, w, now) : null}
        {options.cacheKeeper !== false ? cacheKeeperPaneRow($, ui, w, now) : null}
        {options.tokenMeter !== false ? tokenMeterPaneRows($, ui, w) : null}
        {deckTtft !== null ? <Text dimColor wrap="truncate">{`last req  ttft ${(deckTtft / 1000).toFixed(1)}s`}</Text> : null}
      </Box>
    ),
  })
}

// Inline above the prompt (the terminal's main screen): a summary of at most 8 rows.
function cockpitMini($: any, ui: any, e: any, W: number, now: number, options: any) {
  const { Box, Text } = ui
  const on = (k: string) => options[k] !== false
  const ctx = on('contextHealth') && percent > 0 ? gauge(percent, 6) : null
  const shown = on('agentsProgress') ? [...running(), ...[...finished()].reverse()].slice(0, 3) : []
  const s = gateSummary()
  return (
    <Box flexDirection="column" width={W}>
      {line(ui, [
        { spans: [{ text: prettyModel(deckModel), color: C.main, bold: true }, { text: deckRunning ? ' ● working' : ' ○ idle', color: deckRunning ? C.main : C.dim }] },
        ctx ? { spans: [{ text: '· ctx ', dim: true }, { text: ctx.on, color: percent >= 80 ? C.warn : C.main }, { text: ctx.off, color: C.faint }, { text: ` ${percent}%` }, ...(compactions ? [{ text: ` ⟲${compactions}`, color: C.amber }] : [])] } : null,
        on('tokenMeter') ? { spans: [{ text: `· ${fmtTok(tmSum(tmSession))} tok`, dim: true }] } : null,
        on('architect') && archShown() ? { spans: [{ text: `· ${archLabel.toLowerCase()} ${archAdvising() ? 'advising' : archConsults.length}`, color: C.arch }] } : null,
      ], W)}
      {line(ui, [
        ...(on('usageLimits') ? usageLimitRates.map((r, i): Piece => ({ key: `u${i}`, spans: [{ text: `${i ? '· ' : ''}${LIMIT_SHORT[r.kind]} ${Math.round(r.percentUsed)}%`, color: r.percentUsed >= 70 ? P[zoneTone(r.percentUsed, 70, 90)] : undefined, dim: r.percentUsed < 70 }] })) : []),
        on('cacheKeeper') && lastTouch ? { spans: [{ text: `· cache ${TTL - (now - lastTouch) > 0 ? mins(TTL - (now - lastTouch)) : 'cold'}`, dim: true }] } : null,
        on('agentsProgress') && todos.length ? { spans: [{ text: `· tasks ${todos.filter(t => t.status === 'completed').length}/${todos.length}`, dim: true }] } : null,
        on('agentsProgress') && bgLive(now).length ? { spans: [{ text: `· bg ${bgLive(now).length}`, dim: true }] } : null,
        on('decisions') && dmLast ? { spans: [{ text: dmLast.offline ? '· local offline' : `· local ${fmtTok(dmLast.tokens ?? 0)} tok · ${dmCounts(dmLast).auto}/${dmCounts(dmLast).total} auto`, color: dmLast.offline ? C.amber : C.arch }] } : null,
      ], W)}
      {on('permissionGate') && s.total > 0 ? (
        <Box columnGap={1}>
          <Text dimColor>{gateLabel.toLowerCase()}</Text>
          <Box overflow="hidden" flexShrink={1}><Text wrap="truncate-start">{gateMarks(ui, gateRecent.slice(-Math.max(4, W - 50)))}</Text></Box>
          <Box flexShrink={0}><Text color={s.deny ? C.warn : s.ask ? C.amber : C.dim}>{`${s.rule} allowed · ${s.local ? `${s.local} local · ` : ''}${s.cleared} ${gateDecider()} · ${s.deny} denied`}</Text></Box>
        </Box>
      ) : null}
      {shown.map(a => (
        <Box key={`m-${a.id}`} columnGap={1}>
          <Text color={agentColor(a)}>{agentGlyph(a)}</Text>
          <Box flexGrow={1} flexShrink={1}><Text wrap="truncate">{a.desc || a.type}</Text></Box>
          {a.steps ? <Text dimColor>{`ctx ${fmtTok(a.ctx)}`}</Text> : null}
          {liveClock(ui, e, `mini-clock-${a.id}`, a.startedAt, now, a.endedAt ?? null, C.dim)}
        </Box>
      ))}
      {agents.length > shown.length && on('agentsProgress') ? <Text color={C.faint} wrap="truncate">{`+${agents.length - shown.length} more agents · /cockpit layout compact for all`}</Text> : null}
      {on('loops') && loopsList.length ? <Text dimColor wrap="truncate">{`other loops ${loopsList.length} · ${loopsList.filter(l => loopActive(l, now)).length} active`}</Text> : null}
      {on('turnReceipt') && !deckRunning && receiptLast ? <Text dimColor wrap="truncate">{receiptText(receiptLast)}</Text> : null}
    </Box>
  )
}

export async function cockpitUiRenderPane($: any, e: any, options: any) {
  const ui = $.ui.resolve(e)
  const { Box, Text } = ui
  const now = await $.clock.now()
  const W = Math.max(24, e.props.bodyColumns ?? 66)
  const layout = deckLayout ?? cockpitCfg.layout
  const on = (k: string) => options[k] !== false
  if (layout === 'mini' || (layout === 'auto' && e.props.placement === 'inline')) return cockpitMini($, ui, e, W, now, options)
  const isWide = layout === 'wide' || (layout === 'auto' && W >= 110)
  const colW = isWide ? Math.floor((W - 2) / 2) : W
  const showArch = on('architect') && archShown()
  // A panel with nothing to show yet takes no room; the agents panel always shows, its main row runs every turn.
  type Panel = { id: string; draw: (w: number) => unknown; flow?: { active: boolean; color: string } }
  const panels: Panel[] = [
    { id: 'main', draw: w => cockpitMainPanel($, ui, e, w, now, options) },
    ...(showArch ? [{ id: 'architect', draw: (w: number) => architectPanel(ui, w, now), flow: { active: archAdvising(), color: C.arch } }] : []),
    ...(on('permissionGate') && gateRecent.length ? [{ id: 'gate', draw: (w: number) => gatePanel($, ui, e, w), flow: { active: deckRunning, color: C.gate } }] : []),
    ...(on('decisions') && dmLast ? [{ id: 'decisions', draw: (w: number) => decisionsPanel($, ui, w) }] : []),
    ...(on('agentsProgress') ? [{ id: 'agents', draw: (w: number) => agentsProgressPanel($, ui, e, w, now) }] : []),
    ...(on('loops') && loopsList.length ? [{ id: 'loops', draw: (w: number) => loopsPanel(ui, e, w, now) }] : []),
    ...(on('turnReceipt') && (deckRunning || receiptLast) ? [{ id: 'receipt', draw: (w: number) => receiptPanel(ui, e, w, now), flow: { active: deckRunning, color: C.main } }] : []),
  ]
  // Panels with the flow between them: a rail that runs while a turn (or a consult) does.
  const column = (ps: Panel[], w: number) => (
    <Box flexDirection="column" width={w}>
      {ps.map((p, i) => (
        <Box key={p.id} flexDirection="column">
          {i > 0 && p.flow && ps[i - 1].id !== 'agents' ? rail(ui, e, `link-${p.id}`, p.flow.active, p.flow.color, w) : null}
          {p.draw(w)}
        </Box>
      ))}
    </Box>
  )
  const LEFT = ['main', 'architect', 'gate', 'decisions']
  const left = panels.filter(p => LEFT.includes(p.id))
  const right = panels.filter(p => !LEFT.includes(p.id))
  const legend = [
    { label: 'main', color: C.main },
    ...(on('agentsProgress') ? [{ label: 'agents', color: C.agent }] : []),
    ...(on('permissionGate') ? [{ label: gateLabel.toLowerCase(), color: C.gate }] : []),
    ...(showArch ? [{ label: archLabel.toLowerCase(), color: C.arch }] : []),
  ]
  return (
    <Box flexDirection="column" width={W}>
      {line(ui, [
        W >= 40 ? { spans: [{ text: 'COCKPIT', bold: true }, { text: ' ·', color: C.dim, bold: true }] } : null,
        { spans: [{ text: prettyModel(deckModel).toUpperCase(), color: C.main, bold: true }, { text: deckRunning ? ' WORKS' : ' IDLE', bold: true }] },
        showArch ? { spans: [{ text: '· ', color: C.dim, bold: true }, { text: archLabel, color: C.arch, bold: true }, { text: archAdvising() ? ' ADVISING' : ' ON CALL', bold: true }] } : null,
      ], W, 1, 'center')}
      {line(ui, legend.map((l, i): Piece => ({ key: `l${i}`, spans: [{ text: '■', color: l.color }, { text: ` ${l.label}`, dim: true }] })), W, 2, 'center')}
      {isWide ? (
        <Box columnGap={2}>
          {column(left, colW)}
          {column(right, colW)}
        </Box>
      ) : (
        column(panels, W)
      )}
      {on('sessionLog') ? logPanel(ui, e, W) : null}
      {on('agentsProgress') ? agentsSvgLanes(ui, e, now) : null}
      {!panels.length && !on('sessionLog') ? <Text dimColor>Every cockpit mod is off.</Text> : null}
    </Box>
  )
}

// ===== agents-progress =====
type Agent = {
  id: string
  agentId?: string
  type: string
  desc: string
  model?: string
  startedAt: number
  endedAt?: number
  failed?: boolean
  steps: number
  ctx: number
  out: number
  lastStop?: string | null
  tools: { text: string; isError: boolean }[]
  answer?: string
  bg?: boolean // run_in_background
  wf?: boolean // started by a workflow script's agent()
}
// Background work of the main loop or a subagent: shells, monitors, and wakeups (CronCreate, ScheduleWakeup, /loop).
type BgTask = { id: string; kind: 'shell' | 'monitor' | 'wakeup'; text: string; who: string; startedAt: number; endedAt?: number; isStopped?: boolean; fireAt?: number; recurring?: boolean }

let agents: Agent[] = []
let subTools = 0 // tool calls made inside subagents
let cost = 0
let ctxTokens = 0
let showFinished = true
let agentsExpanded: string | null = null // a card opened with 1-6
type Todo = { id?: string; content: string; status: string; activeForm?: string }
let todos: Todo[] = [] // main session's TodoWrite list, or its TaskCreate/TaskUpdate tasks (keyed by id)
// A subagent's turn.complete can come before its agent.spawn returns: kept here until the card learns its agentId.
const agentDone = new Map<string, { at: number; failed: boolean; answer: string }>()
let bgTasks: BgTask[] = []
let mainTool = '' // the main loop's latest tool call while it runs
let mainEndedAt: number | null = null

function agentsProgressRedraw($: any) { return $.ui.invalidate('ui.render') }
const running = () => agents.filter(a => a.endedAt === undefined)
const finished = () => agents.filter(a => a.endedAt !== undefined)
const pctDone = () => (agents.length ? (finished().length / agents.length) * 100 : 0)
const agentColor = (a: Agent) => (a.endedAt === undefined ? C.agent : a.failed ? C.warn : C.gate)
const agentGlyph = (a: Agent) => (a.endedAt === undefined ? '◐' : a.failed ? '✗' : '✓')
// A one-shot wakeup is over once its time passes; a recurring cron stays until deleted.
const bgLive = (now: number) => bgTasks.filter(t => t.endedAt === undefined && (t.kind !== 'wakeup' || t.recurring || (t.fireAt ?? 0) > now))
const bgShown = (now: number) => [...bgLive(now), ...bgTasks.filter(t => t.endedAt !== undefined).slice(-3).reverse()]
const agentName = (agentId: string | undefined) => {
  if (!agentId) return 'main'
  const a = agents.find(x => x.agentId === agentId)
  return a ? shorten(a.desc || a.type, 14) : 'agent'
}

async function agentsProgressSync($: any) {
  const u = await $.session.usage()
  cost = u.cost?.usd ?? cost
  ctxTokens = u.context.tokens ?? ctxTokens
  agentsProgressRedraw($)
}

export async function agentsProgressSessionStart($: any, e: any, next: any) {
  await $.command.register({ name: 'agents-info', description: 'Show the subagents in the cockpit pane' })
  $.clock.every(1000, () => (running().length || bgTasks.some(t => t.endedAt === undefined)) && agentsProgressRedraw($)) // elapsed-time tick where clocks cannot run
  $.clock.every(8000, () => running().length && void agentsProgressSync($))
  return next(e)
}

export async function agentsProgressCommandRunAgentsInfo($: any) {
  showFinished = true
  await cockpitOpen($)
  return { text: 'Agents panel opened.' }
}

export async function agentsProgressAgentSpawn($: any, e: any, next: any) {
  const a: Agent = { id: e.tool_use_id, type: e.subagentType, desc: e.description, startedAt: await $.clock.now(), steps: 0, ctx: 0, out: 0, tools: [], bg: e.background === true, wf: e.workflow !== undefined }
  agents = [...agents, a].slice(-50)
  agentsProgressRedraw($)
  const r = await next(e)
  a.model = r.model
  if (r.deny !== undefined || !r.agentId) {
    // Refused, or a remote workflow agent with no local loop: nothing more will arrive for it.
    a.endedAt = await $.clock.now()
    a.failed = r.deny !== undefined
  } else {
    a.agentId = r.agentId
    const d = agentDone.get(r.agentId)
    if (d) Object.assign(a, { endedAt: d.at, failed: d.failed, answer: d.answer })
    agentDone.delete(r.agentId)
  }
  void agentsProgressSync($)
  return r
}

// A subagent's model requests: its context is the latest step's whole input; output adds up.
export async function* agentsProgressTurnStep($: any, e: any, next: any) {
  if (e.agentId === undefined) return yield* next(e)
  const result = yield* next(e)
  const a = agents.find(x => x.agentId === e.agentId)
  if (a) {
    const u = result?.usage ?? {}
    const ctx = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
    Object.assign(a, { model: a.model || e.model, steps: a.steps + 1, ctx: ctx > 0 ? ctx : a.ctx, out: a.out + (u.output_tokens ?? 0), lastStop: result?.stopReason ?? null })
    if (a.endedAt !== undefined) a.endedAt = undefined // a step after its end: resumed (SendMessage)
    agentsProgressRedraw($)
  }
  return result
}

export async function agentsProgressTurnComplete($: any, e: any, next: any) {
  const done = await next(e)
  if (e.agentId === undefined) {
    mainTool = ''
    mainEndedAt = await $.clock.now()
  } else {
    const at = await $.clock.now()
    const failed = e.reason !== 'answer'
    const answer = shorten(e.answer ?? '', 400)
    const a = agents.find(x => x.agentId === e.agentId)
    if (a) Object.assign(a, { endedAt: at, failed, answer })
    else agentDone.set(e.agentId, { at, failed, answer })
    agentsProgressRedraw($)
  }
  return done
}

// The tool shows as the loop's current one while it runs; todos, tasks and background work are read from its result.
export async function agentsProgressToolCall($: any, e: any, next: any) {
  const tool = String(e.tool)
  const isMain = e.agentId === undefined
  const step = { text: describeInput(tool, e), isError: false }
  const a = isMain ? undefined : agents.find(x => x.agentId === e.agentId)
  if (!isMain) subTools += 1
  if (a) a.tools = [...a.tools, step].slice(-3)
  if (isMain) mainTool = step.text
  if (isMain && tool === 'TodoWrite' && Array.isArray(e.todos)) todos = e.todos
  agentsProgressRedraw($)
  const r = await next(e)
  step.isError = r.deny !== undefined || r.isError === true
  if (isMain && mainTool === step.text) mainTool = ''
  if (isMain && !step.isError && tool === 'TaskCreate' && r.result?.task?.id !== undefined) {
    todos = [...todos, { id: String(r.result.task.id), content: e.subject, status: 'pending', activeForm: e.activeForm }]
  } else if (isMain && !step.isError && tool === 'TaskUpdate') {
    todos = (e.status === 'deleted'
      ? todos.filter(t => t.id !== e.taskId)
      : todos.map(t => (t.id === e.taskId ? { ...t, content: e.subject ?? t.content, status: e.status ?? t.status, activeForm: e.activeForm ?? t.activeForm } : t)))
  }
  if (!step.isError) await agentsProgressBackground($, e, r.result ?? {})
  agentsProgressRedraw($)
  return r
}

async function agentsProgressBackground($: any, e: any, res: any) {
  const at = await $.clock.now()
  const who = agentName(e.agentId)
  const add = (t: BgTask) => { bgTasks = [...bgTasks.filter(x => x.id !== t.id), t].slice(-20) }
  if (e.tool === 'Bash' && res.backgroundTaskId) add({ id: String(res.backgroundTaskId), kind: 'shell', text: e.description || e.command || 'shell', who, startedAt: at })
  else if (e.tool === 'Monitor' && res.taskId) add({ id: String(res.taskId), kind: 'monitor', text: e.description || e.command || 'monitor', who, startedAt: at })
  else if (e.tool === 'CronCreate' && res.id) add({ id: `cron:${res.id}`, kind: 'wakeup', text: `${res.humanSchedule ?? e.cron} · ${e.prompt ?? ''}`, who, startedAt: at, fireAt: res.nextFireAt, recurring: res.recurring === true })
  else if (e.tool === 'CronDelete') bgTasks = bgTasks.filter(t => t.id !== `cron:${e.id}`)
  else if (e.tool === 'ScheduleWakeup') {
    bgTasks = bgTasks.filter(t => t.id !== 'wakeup') // one dynamic /loop wakeup at a time
    if (!e.stop && res.scheduledFor) add({ id: 'wakeup', kind: 'wakeup', text: e.reason || e.prompt || 'wakeup', who, startedAt: at, fireAt: res.scheduledFor })
  } else if (e.tool === 'TaskStop') {
    const id = String(e.task_id ?? e.shell_id ?? '')
    bgTasks = bgTasks.map(t => (t.id === id && t.endedAt === undefined ? { ...t, endedAt: at, isStopped: true } : t))
  }
}

// Stop lists the background work still in flight: a shell or monitor missing from it has ended, a cron was deleted.
// shortcut: an ended task shows as done whether it passed or failed; read the task-notification status if that matters.
export async function agentsProgressStop($: any, e: any, next: any) {
  const at = await $.clock.now()
  if (Array.isArray(e.background_tasks)) {
    const live = new Set(e.background_tasks.map((t: any) => String(t.id)))
    bgTasks = bgTasks.map(t => (t.kind !== 'wakeup' && t.endedAt === undefined && !live.has(t.id) ? { ...t, endedAt: at } : t))
  }
  if (Array.isArray(e.session_crons)) {
    const crons = new Set(e.session_crons.map((c: any) => `cron:${c.id}`))
    bgTasks = bgTasks.filter(t => !t.id.startsWith('cron:') || crons.has(t.id))
  }
  agentsProgressRedraw($)
  return next(e)
}

const todoTitle = () => {
  const cur = todos.find(t => t.status === 'in_progress')
  return { cur, title: cur ? cur.activeForm || cur.content : 'Next: ' + (todos.find(t => t.status !== 'completed')?.content ?? '') }
}

export async function agentsProgressUiRenderAbovePrompt($: any, e: any, next: any) {
  if (e.props.hasSurvey) return next(e)
  const live = running()
  const nested = await below(next, e)
  if (live.length) {
    const open = () => cockpitOpen($)
    quiet({
      key: 'agents',
      text: `${live.length} agent${live.length > 1 ? 's' : ''} running`,
      onPress: open,
      spec: { title: 'Agents', tone: 'info', busy: true, pct: pctDone(), pctLabel: `${live.length} running · ${finished().length}/${agents.length}` },
    })
  }
  const bg = bgLive(await $.clock.now()).length
  if (bg) quiet({ key: 'bg', text: `${bg} background`, onPress: () => cockpitOpen($) })
  const done = todos.filter(t => t.status === 'completed').length
  if (todos.length > 0 && done < todos.length) {
    const { title } = todoTitle()
    quiet({ key: 'todos', text: `${title.length > 40 ? `${title.slice(0, 39)}…` : title} ${done}/${todos.length}` })
  }
  return nested
}

// The main loop's row: working or idle, the tool it runs now, its requests and the turn's clock.
function agentsProgressMainRow(ui: any, e: any, w: number, now: number) {
  const { Box, Text } = ui
  return (
    <Box columnGap={1} width={w}>
      <Text color={C.main}>{deckRunning ? '◐' : '○'}</Text>
      <Text color={C.main} bold>main</Text>
      <Box flexGrow={1} flexShrink={1}><Text dimColor={!deckRunning} wrap="truncate">{deckRunning ? mainTool || 'thinking' : 'idle'}</Text></Box>
      <Box flexShrink={0}><Text dimColor>{`${deckSteps} req`}</Text></Box>
      {deckTurn.startedAt ? <Box flexShrink={0}>{liveClock(ui, e, 'main-clock', deckTurn.startedAt, now, deckRunning ? null : mainEndedAt, C.dim)}</Box> : null}
    </Box>
  )
}

// Background shells, monitors and wakeups: the live ones, then the last three that ended.
function agentsProgressBgRows(ui: any, e: any, w: number, now: number) {
  const { Box, Text } = ui
  const shown = bgShown(now)
  return (
    <Box flexDirection="column" width={w} marginTop={1}>
      <Text bold wrap="truncate">{`background · ${bgLive(now).length} running`}</Text>
      {shown.length ? null : <Text color={C.faint}>no background tasks</Text>}
      {shown.map(t => (
        <Box key={`bg-${t.id}`} columnGap={1}>
          <Text color={t.endedAt === undefined ? C.agent : t.isStopped ? C.warn : C.gate}>{t.endedAt === undefined ? '◐' : t.isStopped ? '✗' : '✓'}</Text>
          {w >= 40 ? <Box width={7} flexShrink={0}><Text color={C.dim}>{t.kind}</Text></Box> : null}
          <Box flexGrow={1} flexShrink={1}><Text dimColor={t.endedAt !== undefined} wrap="truncate">{t.who === 'main' ? t.text : `${t.text} · ${t.who}`}</Text></Box>
          <Box flexShrink={0}>
            {t.kind !== 'wakeup' ? liveClock(ui, e, `bg-clock-${t.id}`, t.startedAt, now, t.endedAt ?? null, C.dim)
              : <Text dimColor>{t.fireAt && t.fireAt > now ? `in ${fmtTimer(t.fireAt - now)}` : t.recurring ? 'recurring' : ''}</Text>}
          </Box>
        </Box>
      ))}
    </Box>
  )
}

const agentTag = (a: Agent) => `${a.type}${a.wf ? ' · wf' : a.bg ? ' · bg' : ''}`
const agentNow = (a: Agent) => (a.tools.length ? `· ${a.tools[a.tools.length - 1].text}` : '')

// Cards side by side while they fit (maxCards, 20 columns each), swimlanes on one time axis beyond that.
function agentsProgressPanel($: any, ui: any, e: any, w: number, now: number) {
  const { Box, Text, Button } = ui
  const live = running()
  const list = showFinished ? agents : live
  const fit = Math.max(1, Math.min(cockpitCfg.maxCards, Math.floor((w + 1) / 21)))
  const useLanes = list.length > fit
  const expand = (id: string) => () => { agentsExpanded = agentsExpanded === id ? null : id; agentsProgressRedraw($) }
  const first = agents.length ? Math.min(...agents.map(a => a.startedAt)) : now
  const last = live.length ? now : Math.max(first, ...agents.map(a => a.endedAt ?? 0))
  const done = todos.filter(t => t.status === 'completed').length
  const { cur, title } = todoTitle()
  const header = (
    <Box justifyContent="space-between" width={w}>
      <Text bold wrap="truncate">{w < 40 ? `agents · ${live.length}/${agents.length}` : `agents · ${live.length} running · ${agents.length} total`}</Text>
      {list.length ? <Box flexShrink={0}><Text color={C.faint}>{`1-${Math.min(list.length, 6)}${w < 40 ? '' : ' expand'}`}</Text></Box> : null}
    </Box>
  )
  const shown = useLanes ? list.slice(-6) : list.slice(-fit)
  let body: unknown
  if (!list.length) body = <Text color={C.faint}>{agents.length ? 'all finished · a shows them' : 'no subagents yet'}</Text>
  else if (useLanes) {
    const labelW = Math.min(17, Math.max(7, w - 17))
    const barW = Math.max(4, w - 11 - labelW)
    const start = Math.min(...shown.map(a => a.startedAt), now)
    const span = Math.max(1, now - start)
    body = (
      <Box flexDirection="column">
        {list.length > shown.length ? <Text color={C.faint}>{`+${list.length - shown.length} earlier`}</Text> : null}
        {shown.map((a, i) => {
          const from = Math.min(barW, Math.floor(((a.startedAt - start) / span) * barW))
          const to = Math.min(barW, Math.max(from + 1, Math.ceil((((a.endedAt ?? now) - start) / span) * barW)))
          return (
            <Box key={`lane-${a.id}`} flexDirection="column">
              <Box columnGap={1}>
                <Text color={agentColor(a)}>{agentGlyph(a)}</Text>
                <Box width={labelW} flexShrink={0}><Button key={`card-${a.id}`} plain hotkey={String(i + 1)} label={shorten(a.desc || a.type, labelW - 3)} onPress={expand(a.id)} /></Box>
                <Box flexShrink={0}>
                  <Text>
                    <Text color={C.faint}>{'·'.repeat(from)}</Text>
                    <Text color={agentColor(a)}>{'━'.repeat(to - from)}</Text>
                    <Text color={C.faint}>{'·'.repeat(barW - to)}</Text>
                  </Text>
                </Box>
                {liveClock(ui, e, `lane-clock-${a.id}`, a.startedAt, now, a.endedAt ?? null, C.dim)}
              </Box>
              {a.endedAt === undefined && agentNow(a) && w >= 40 ? <Box paddingLeft={2}><Text color={C.faint} wrap="truncate">{agentNow(a)}</Text></Box> : null}
            </Box>
          )
        })}
      </Box>
    )
  } else {
    const cardW = Math.max(20, Math.floor((w - (shown.length - 1)) / shown.length))
    const centers = shown.map((_, i) => i * (cardW + 1) + Math.floor(cardW / 2))
    body = (
      <Box flexDirection="column">
        {rail(ui, e, 'fan-out', live.length > 0, C.agent, w, centers)}
        <Box columnGap={1}>
          {shown.map((a, i) => (
            <Box key={`c-${a.id}`} flexDirection="column" borderStyle={agentsExpanded === a.id ? 'double' : 'round'} borderColor={a.lastStop === 'max_tokens' ? C.warn : C.agent} borderDimColor={a.endedAt !== undefined} width={cardW} paddingX={1}>
              <Button key={`card-${a.id}`} plain hotkey={String(i + 1)} label={shorten(a.desc || a.type, cardW - 7)} onPress={expand(a.id)} />
              <Text color={C.dim} wrap="truncate">{a.model ? `${agentTag(a)} · ${prettyModel(a.model)}` : agentTag(a)}</Text>
              <Text dimColor wrap="truncate">{a.steps > 0 ? `ctx ${fmtTok(a.ctx)} · out ${fmtTok(a.out)} · ${a.steps} st` : 'starting…'}</Text>
              <Text color={C.faint} wrap="truncate">{agentNow(a) || '·'}</Text>
              <Box columnGap={1}>
                <Text color={a.lastStop === 'max_tokens' ? C.warn : agentColor(a)}>{cardW >= 26 ? `${agentGlyph(a)} ${a.lastStop === 'max_tokens' ? 'max_tokens' : a.endedAt === undefined ? 'working' : a.failed ? 'failed' : 'done'}` : agentGlyph(a)}</Text>
                <Box flexShrink={0}>{liveClock(ui, e, `card-clock-${a.id}`, a.startedAt, now, a.endedAt ?? null, C.dim)}</Box>
              </Box>
            </Box>
          ))}
        </Box>
        {rail(ui, e, 'merge', live.length > 0, C.agent, w, centers, true)}
      </Box>
    )
  }
  const x = agents.find(a => a.id === agentsExpanded)
  return (
    <Box flexDirection="column" width={w}>
      {agentsProgressMainRow(ui, e, w, now)}
      {todos.length && done < todos.length ? line(ui, [{ spans: [{ text: cur ? '◐ ' : '○ ', color: C.agent }, { text: title }], fill: true }, { spans: gaugeSpans((done / todos.length) * 100, 6, C.agent, `${done}/${todos.length}`) }], w, 2) : null}
      <Box marginTop={1}>{header}</Box>
      {body}
      {x ? (
        <Box flexDirection="column" borderStyle="single" borderColor={C.agent} paddingX={1} width={w}>
          <Text bold wrap="wrap">{x.desc || x.type}</Text>
          <Text dimColor wrap="truncate">{`${x.type} · ${prettyModel(x.model ?? '')} · ${x.endedAt === undefined ? 'working' : x.failed ? 'failed' : 'done'} · ${x.steps} steps`}</Text>
          {x.tools.length === 0 ? <Text color={C.faint}>no tool calls yet</Text> : null}
          {x.tools.map((n, i) => <Box key={`t${i}`}><Text color={n.isError ? C.warn : undefined} wrap="truncate">{`${n.isError ? '✗' : '·'} ${n.text}`}</Text></Box>)}
          {x.answer ? <Text dimColor wrap="wrap">{`» ${shorten(x.answer, 240)}`}</Text> : null}
        </Box>
      ) : null}
      {line(ui, [
        { spans: [{ text: 'cost ', dim: true }, { text: `≈${fmtCost(cost)}`, bold: true }] },
        { spans: [{ text: 'ctx ', dim: true }, { text: fmtTok(ctxTokens), bold: true }] },
        { spans: [{ text: 'time ', dim: true }, { text: fmtTimer(last - first), bold: true }] },
        subTools ? { spans: [{ text: `${subTools} tool calls in subagents`, dim: true }] } : null,
      ], w, 2)}
      {finished().length ? <Button key="fin" plain hotkey="a" label={`${showFinished ? '▾' : '▸'} finished · ${finished().length}`} onPress={() => { showFinished = !showFinished; agentsProgressRedraw($) }} /> : null}
      {agentsProgressBgRows(ui, e, w, now)}
    </Box>
  )
}

// The desktop and mobile also draw the agents on an SVG time axis under the panels.
function agentsSvgLanes(ui: any, e: any, now: number) {
  if (!isRich(ui, e) || !agents.length) return null
  const shown = agents.slice(-10)
  const rowH = 18
  const pxW = 520
  const start = Math.min(...shown.map(a => a.startedAt), now)
  const span = Math.max(1, now - start)
  const rects = shown
    .map((a, i) => {
      const x = 150 + ((a.startedAt - start) / span) * (pxW - 160)
      const wpx = Math.max(3, (((a.endedAt ?? now) - a.startedAt) / span) * (pxW - 160))
      const fill = a.endedAt === undefined ? SVG_COLORS.running : a.failed ? SVG_COLORS.failed : SVG_COLORS.done
      return `<text x="4" y="${i * rowH + 13}" font-family="${MONO}" font-size="11" fill="${SVG_COLORS.label}">${esc(shorten(a.desc || a.type, 22))}</text><rect x="${x}" y="${i * rowH + 4}" width="${wpx}" height="10" rx="3" fill="${fill}"/>`
    })
    .join('')
  const svgH = shown.length * rowH + 4
  // No width or height on the element: it takes the markup's own width up to the pane's and scales down to fit.
  return <ui.Svg key="lanes" source={`<svg xmlns="http://www.w3.org/2000/svg" width="${pxW}" height="${svgH}" viewBox="0 0 ${pxW} ${svgH}">${rects}</svg>`} alt={`${agents.length} agents on a time axis`} />
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

function cacheKeeperToggle($: any, keeping: boolean) {
  return $.command.run({ command: 'keepwarm', args: keeping ? 'off' : '' })
}

export async function cacheKeeperUiRenderAbovePrompt($: any, e: any, next: any) {
  if (e.props.hasSurvey || lastTouch === 0) return next(e)
  const now = await $.clock.now()
  const left = TTL - (now - lastTouch)
  const warm = left > 0
  const calm = left >= WARN_BEFORE // the band shows only when the cache is about to go cold, or already is
  const keeping = warmUntil > now
  const spec: BandSpec = {
    title: warm ? `Cache warm · ${mins(left)} left` : 'Cache cold',
    tone: calm ? 'ok' : !warm ? 'err' : 'warn',
    pct: warm ? Math.max(0, (left / TTL) * 100) : 100,
    busy: !warm,
    detail: warm ? `${fmtTok(cacheKeeperTokens)} ctx · next send ${cacheCost(1)}` : `${fmtTok(cacheKeeperTokens)} ctx · next send rewrites it ${cacheCost(0)} (warm ${cacheCost(1)})`,
    chips: keeping ? [`keepwarm ${mins(warmUntil - now)}`] : [],
    right: keeping ? lastPing || 'no ping yet' : undefined,
    buttons: [{ key: 'kw', label: keeping ? 'Stop keepwarm' : 'Keep warm', onPress: () => void cacheKeeperToggle($, keeping) }],
  }
  const nested = await below(next, e)
  if (!calm) return band($.ui.resolve(e), e, nested, spec)
  quiet({ key: 'cache', text: `Cache ${mins(left)}` })
  return nested
}

function cacheKeeperPaneRow($: any, ui: any, w: number, now: number) {
  if (lastTouch === 0) return null
  const { Box, Button } = ui
  const left = TTL - (now - lastTouch)
  const keeping = warmUntil > now
  const color = left >= WARN_BEFORE ? C.gate : left > 0 ? C.amber : C.warn
  return (
    <Box key="cache" columnGap={1}>
      <Box flexGrow={1} flexShrink={1}>
        {line(ui, [
          { spans: left > 0 ? gaugeSpans((left / TTL) * 100, 5, color, 'cache') : [{ text: 'cache ', dim: true }, { text: 'cold', color: C.warn, bold: true }] },
          { spans: [{ text: left > 0 ? `${mins(left)} · next ${cacheCost(1)}` : `next send ${cacheCost(0)} (warm ${cacheCost(1)})`, dim: true }] },
          keeping ? { spans: [{ text: `keepwarm ${mins(warmUntil - now)}${lastPing ? ` · ${lastPing}` : ''}`, color: C.cleared }] } : null,
        ], w - 18, 2)}
      </Box>
      <Button key="kw" plain hotkey="k" label={keeping ? 'stop warm' : 'keep warm'} onPress={() => void cacheKeeperToggle($, keeping)} />
    </Box>
  )
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
let compactions = 0 // the main conversation's compactions this session (⟲)

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
  return yield* tap(next(e), async (chunk: any) => {
    if (startedAt === null) startedAt = await $.clock.now()
    if (chunk.kind === 'stop' && chunk.usage) {
      const secs = ((await $.clock.now()) - startedAt) / 1000
      const rate = chunk.usage.output_tokens / secs
      if (chunk.usage.output_tokens >= 50 && secs >= 1 && rate <= 400) speed = Math.round(rate)
    }
  })
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

export async function contextHealthSessionCompact($: any, e: any, next: any) {
  const done = await next(e)
  if (e.agentId === undefined && e.trigger !== 'precompute') compactions += 1
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

const ctxChips = () => [
  ...(turnNo ? [`turn ${turnNo}`] : []),
  ...(speed ? [`${speed} tok/s`] : []),
  ...(costNow ? [`${fmtCost(Math.max(0, costNow - costAtStart))} · ${fmtCost(costNow)}`] : []),
  ...(auto ? [`auto @${threshold}%`] : []),
]

export async function contextHealthUiRenderAbovePrompt($: any, e: any, next: any) {
  if (e.props.hasSurvey || percent === 0 || bandHidden) return next(e)
  const high = percent >= threshold
  const limits = contextHealthRates.map(r => `${r.kind.replace('five_hour', '5h').replace('seven_day', '7d')} ${Math.round(r.percentUsed)}%`).join(' · ')
  const ctxTone = zoneTone(percent, threshold - 10, threshold)
  const spec: BandSpec = {
    title: `Context ${percent}%`,
    tone: ctxTone,
    pct: percent,
    detail: high ? 'quality may drop: hand off or start fresh' : `${fmtTok(contextHealthTokens)} of ${fmtTok(windowSize)} tokens`,
    right: limits || undefined,
    chips: ctxChips(),
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
  quiet({ key: 'context', text: `Context ${percent}%` })
  return nested
}

function contextHealthPaneRow($: any, ui: any, w: number) {
  if (percent === 0) return null
  const { Box, Button } = ui
  const high = percent >= threshold
  const color = percent >= threshold ? C.warn : percent >= threshold - 10 ? C.amber : C.main
  return (
    <Box key="ctx" flexDirection="column">
      {line(ui, [
        { spans: gaugeSpans(percent, 10, color, 'ctx') },
        { spans: [{ text: `${fmtTok(contextHealthTokens)}/${fmtTok(windowSize)}`, dim: true }] },
        compactions ? { spans: [{ text: `⟲${compactions}`, color: C.amber }], lead: 1 } : null,
      ], w - 4)}
      {ctxChips().length ? line(ui, ctxChips().map((c, i): Piece => ({ key: `k${i}`, spans: [{ text: i ? `· ${c}` : c, dim: true }] })), w - 4) : null}
      {high ? (
        <Box columnGap={1}>
          <Box flexGrow={1}>{line(ui, [{ spans: [{ text: 'quality may drop: hand off or start fresh', color: C.warn }], fill: true }], w - 26)}</Box>
          <Button key="ho" plain hotkey="h" label="handoff" onPress={() => startHandoff($)} />
          <Button key="fr" plain label="fresh" onPress={() => void $.command.run({ command: 'clear', args: '' })} />
        </Box>
      ) : null}
    </Box>
  )
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
// One colour per kind of activity: reads in the architect's colour, edits in Claude's, commits in the gate's.
const famColor = (s: State) => (s === 'reading' || s === 'opened' ? C.arch : s === 'committed' ? C.gate : C.main)
const FAMILY_LABEL: Record<State, string> = { reading: 'Reading', opened: 'Opened', editing: 'Editing', edited: 'Edited', committed: 'Committed' }
const gitColor = (st: string) => (({ M: C.amber, T: C.amber, A: C.gate, '?': C.gate, R: C.agent, C: C.agent, D: C.warn, U: C.warn }) as Record<string, string>)[st]
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

// Per-character shimmer: a bright band sweeping along the name, the rest of it dim.
const isHot = (i: number, len: number) => Math.abs(i - (((phase * 1.4) % (len + 8)) - 4)) < 1.8

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

// What the drawing needs from the hook: the callbacks (they close over `$`, which cannot cross an import
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

// A highlighted row is one Claude is working on right now (or did in the last few seconds), or just committed.
const rowState = (path: string, now: number): Touch | undefined => {
  const t = touched.get(path)
  return t && (now - t.at < GLOW_MS || t.state === 'reading' || t.state === 'editing') ? t : undefined
}

const nameEl = (ui: any, r: Row, name: string, t: Touch | undefined, own: Change | undefined, isSel: boolean) => {
  const { Text } = ui
  if (t) {
    const color = famColor(t.state)
    return <Text>{[...name].map((c, i) => <Text bold={isHot(i, name.length)} dimColor={!isHot(i, name.length)} color={color}>{c}</Text>)}</Text>
  }
  const gc = own ? gitColor(own.st) : undefined
  return <Text color={gc ?? (r.name.startsWith('.') ? C.dim : undefined)} bold={isSel || r.isDir} strikethrough={own?.st === 'D'}>{name}</Text>
}

// One flightdeck-style drawing for every surface: a FILES box (branch, what Claude is doing, legend), the buttons,
// the search field, what Claude touched, then the tree rows (windowed around the selection on the terminal).
const drawTree = (ui: any, e: any, a: Actions) => {
  const { Box, Text, Button, Input } = ui
  const now = Date.now()
  const W = Math.max(24, (e.props.bodyColumns ?? 60) - 1)
  const isTerminal = e.surface === 'terminal'
  const act = activity && (activity.running || now - activity.at < 6_000) ? activity : undefined
  const addAll = [...changes.values()].reduce((n, c) => n + c.add, 0)
  const delAll = [...changes.values()].reduce((n, c) => n + c.del, 0)
  const all = counts(root)
  const recent = [...touched.entries()].sort((x, y) => y[1].at - x[1].at)
  const room = isTerminal ? Math.max(5, (e.viewport?.rows ?? 30) - 12) : MAX_ROWS
  const idx = Math.max(0, list.findIndex(r => r.path === selected))
  const from = isTerminal ? Math.max(0, Math.min(idx - Math.floor(room / 2), list.length - room)) : 0
  const btn = (key: string, label: string, onPress: () => void) => <Button key={key} plain label={label} onPress={onPress} />
  return (
    <Box flexDirection="column" width={W}>
      {box(ui, {
        color: C.main,
        title: 'FILES',
        state: base(root || cwd),
        right: changes.size === 0 ? (committedSet.size ? `${committedSet.size} committed` : 'clean') : `${changes.size} not committed${committedSet.size ? ` · ${committedSet.size} committed` : ''}`,
        children: (
          <Box flexDirection="column">
            {line(ui, [
              { spans: [{ text: `⎇ ${branch || base(root)}`, color: C.agent, bold: true }, ...(ahead ? [{ text: ` ↑${ahead}`, color: C.cleared }] : []), ...(behind ? [{ text: ` ↓${behind}`, color: C.agent }] : [])] },
              upstream ? { spans: [{ text: upstream, dim: true }] } : null,
              addAll + delAll > 0 ? { spans: [{ text: `+${addAll}`, color: C.gate }, { text: ` −${delAll}`, color: C.warn }], lead: 1 } : null,
              all.n ? { spans: [{ text: `${all.n} new`, color: C.gate }] } : null,
              all.m ? { spans: [{ text: `${all.m} mod`, color: C.amber }] } : null,
              all.d ? { spans: [{ text: `${all.d} del`, color: C.warn }] } : null,
            ], W - 4)}
            {act ? (
              <Text color={act.failed ? C.warn : famColor(act.state)} bold={act.running} wrap="truncate">
                {`${act.running ? SPIN[phase % SPIN.length] : act.failed ? '✗' : '✓'} ${act.running ? `${act.label}…` : act.label}${act.target ? ` in ${act.target}` : ''}`}
              </Text>
            ) : (
              <Text dimColor wrap="truncate">{`◌ Claude is idle · ${activity ? `last: ${activity.label.toLowerCase()}` : 'nothing touched yet'}`}</Text>
            )}
            {line(ui, [
              { spans: [{ text: '● ', color: C.arch }, { text: 'read', dim: true }] },
              { spans: [{ text: '● ', color: C.main }, { text: 'edited', dim: true }] },
              { spans: [{ text: '● ', color: C.gate }, { text: 'new', dim: true }] },
              { spans: [{ text: '● ', color: C.amber }, { text: 'modified', dim: true }] },
              { spans: [{ text: '● ', color: C.warn }, { text: 'deleted', dim: true }] },
              { spans: [{ text: '● ', color: C.cleared }, { text: 'committed, not pushed', dim: true }] },
            ], W - 4, 2)}
          </Box>
        ),
      })}
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        {btn('refresh', '↻ refresh', a.refresh)}
        {btn('collapse', '⊟ collapse', a.collapse)}
        {btn('size', showSize ? 'Σ dates' : 'Σ sizes', a.size)}
        {btn('up', '↑ up', a.up)}
        {btn('home', '⌂ project', a.home)}
        {btn('hidden', showHidden ? '.* hide' : '.* show', a.hidden)}
        {selected ? btn('unselect', '⊘ clear', a.unselect) : null}
      </Box>
      <Input key="q" label="/ " placeholder="find a file" value={query} onInput={(v: string) => a.search(v)} onSubmit={() => undefined} />
      {recent.length && !query ? (
        <Box flexDirection="column">
          {sectionLabel(ui, 'Claude touched', plural(recent.length, 'file'))}
          {recent.slice(0, isTerminal ? 3 : 6).map(([path, t]) => (
            <Box key={`t:${path}`} flexDirection="row" columnGap={1}>
              {fileBadge(ui, e, base(path))}
              <Button key={`tb:${path}`} plain onPress={() => a.reveal(path)}>
                <Text bold>{base(path)}</Text>
                <Text dimColor>{` ${base(dirOf(path))}`}</Text>
              </Button>
              <Box flexGrow={1} />
              {pill(ui, e, FAMILY_LABEL[t.state].toLowerCase(), famColor(t.state))}
            </Box>
          ))}
        </Box>
      ) : null}
      {sectionLabel(ui, 'All files', base(root))}
      {list.length === 0 ? <Text dimColor>{query ? 'no matches' : 'empty'}</Text> : null}
      {list.slice(from, from + room).map(r => {
        const t = rowState(r.path, now)
        const own = changes.get(r.path)
        const dc = r.isDir ? counts(r.path) : undefined
        const isSel = r.path === selected
        const kids = r.isDir ? [...touched.keys()].find(p => p.startsWith(`${r.path}/`) && rowState(p, now)) : undefined
        const kt = kids ? rowState(kids, now) : undefined
        return (
          <Box key={r.path} flexDirection="row" height={1} overflow="hidden">
            <Button key={`b:${r.path}`} plain onPress={() => a.toggle(r)}>
              <Text color={C.main}>{isSel ? '›' : ' '}</Text>
              <Text>{query ? '' : '  '.repeat(r.depth)}</Text>
              <Text dimColor>{r.isDir ? (open.has(r.path) ? '▾ ' : '▸ ') : '  '}</Text>
              {r.isDir ? <Text color={kt ? famColor(kt.state) : own ? gitColor(own.st) : r.name.startsWith('.') ? C.dim : C.agent}>{'■ '}</Text> : fileBadge(ui, e, r.name)}
              {nameEl(ui, r, query ? rel(r.path) : r.name, t ?? kt, own, isSel)}
            </Button>
            <Box flexGrow={1} />
            <Box flexDirection="row" flexShrink={0} columnGap={1}>
              {t ? pill(ui, e, FAMILY_LABEL[t.state].toLowerCase(), famColor(t.state)) : null}
              {!t && dc && dc.n > 0 ? <Text color={C.gate}>{`${dc.n} new`}</Text> : null}
              {!t && dc && dc.m > 0 ? <Text color={C.amber}>{`${dc.m} mod`}</Text> : null}
              {!t && dc && dc.d > 0 ? <Text color={C.warn}>{`${dc.d} del`}</Text> : null}
              {!t && dc && dc.c > 0 ? <Text color={C.cleared}>{`${dc.c} committed`}</Text> : null}
              {!t && own && own.add + own.del > 0 ? <Text><Text color={C.gate}>{`+${own.add}`}</Text><Text color={C.warn}>{` −${own.del}`}</Text></Text> : null}
              {!t && own ? <Text bold color={gitColor(own.st)}>{WORD[own.st] ?? own.st}</Text> : null}
              {!t && !own && !r.isDir && committedSet.has(r.path) ? <Text bold color={C.cleared}>committed</Text> : null}
              <Text dimColor>{r.isDir ? '' : showSize ? fmtSize(r.size) : ago(now - r.mtime)}</Text>
            </Box>
          </Box>
        )
      })}
      {selected ? <Text dimColor wrap="truncate-start">{`selected: ${rel(selected)} · sent to Claude with your next prompt`}</Text> : null}
    </Box>
  )
}

// What Claude is doing to which file: shown while it runs, kept in "Claude touched" after.
// selected file goes to Claude as context; @path mentions reveal the file
// A way in: as soon as Claude has read or edited a file, offer the tree on the summary line above the prompt.

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
  return drawTree(ui, e, actions)
}

export async function filetreeUiRenderAbovePrompt($: any, e: any, next: any) {
  if (e.props.hasSurvey || touched.size === 0) return next(e)
  if (await paneIsOpen($, 'filetree')) return next(e)
  const open = () => $.ui.open({ id: 'filetree', title: `Files: ${base(root || cwd)}` })
  const nested = await below(next, e)
  quiet({ key: 'files', text: `${touched.size} file${touched.size > 1 ? 's' : ''}`, onPress: open })
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

const usageRates = () => [...usageLimitRates].sort((a, b) => (a.kind === 'five_hour' ? -1 : 0) - (b.kind === 'five_hour' ? -1 : 0))

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
  const rates = usageRates()
  const peak = Math.max(...rates.map(r => r.percentUsed))
  const spec: BandSpec = {
    title: 'Usage limits',
    tone: zoneTone(peak, 70, 90),
    detail: rates.map(r => `${LIMIT_SHORT[r.kind]} ${left(r) > 0 ? `${usageLeft(left(r))} (${usagePace(r, left(r)).replace('pace ', '')})` : 'reset pending'}`).join(' · '),
    bars: rates.map(r => ({ pct: r.percentUsed, label: LIMIT_SHORT[r.kind], tone: zoneTone(r.percentUsed, 70, 90) })),
  }
  const nested = await below(next, e)
  if (peak >= 70) return band($.ui.resolve(e), e, nested, spec)
  quiet({ key: 'usage', text: rates.map(r => `${LIMIT_SHORT[r.kind]} ${Math.round(r.percentUsed)}%`).join(' · ') })
  return nested
}

function usageLimitsPaneRow(ui: any, w: number, now: number) {
  if (!usageLimitRates.length) return null
  const left = (r: { resetsAt?: string }) => (r.resetsAt ? Date.parse(r.resetsAt) - now : 0)
  return line(ui, usageRates().map((r, i): Piece => ({
    key: r.kind,
    lead: i ? 1 : 0,
    spans: [
      ...gaugeSpans(r.percentUsed, 5, P[zoneTone(r.percentUsed, 70, 90)], LIMIT_SHORT[r.kind]),
      ...(w >= 56 && left(r) > 0 ? [{ text: ` ↻${usageLeft(left(r))} ${usagePace(r, left(r))}`, dim: true }] : []),
    ],
  })), w - 4, 2)
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
let tmCost = 0
let tmOpen = false // the pane's token details (t)

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
  return yield* tap(next(e), (chunk: any) => {
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
  })
}

export async function tokenMeterTurnComplete($: any, e: any, next: any) {
  const done = await next(e)
  if (e.agentId === undefined) tmLastTurnCost = Math.max(0, ((await $.session.usage()).cost?.usd ?? 0) - tmCostAtStart)
  return done
}

export async function tokenMeterUiRenderAbovePrompt($: any, e: any, next: any) {
  if (e.props.hasSurvey) return next(e)
  tmCost = (await $.session.usage()).cost?.usd ?? tmCost
  const nested = await below(next, e)
  quiet({ key: 'tokens', text: `${fmtTok(tmSum(tmSession))} tok` })
  return nested
}

function tokenMeterPaneRows($: any, ui: any, w: number) {
  const { Box, Button } = ui
  const total = tmSum(tmSession)
  const project = tmScan.tokens + (total - tmLiveAtScan)
  const models = Object.entries(tmModels).sort((a, b) => b[1] - a[1]).map(([m, n]) => `${m} ${fmtTok(n)}`).join(' · ')
  return (
    <Box key="tokens" flexDirection="column">
      <Box columnGap={1}>
        <Box flexGrow={1} flexShrink={1}>
          {line(ui, [
            { spans: [{ text: 'tokens ', dim: true }, { text: fmtTok(total), bold: true }] },
            { spans: [{ text: fmtCost(tmCost), color: C.text }] },
            { spans: [{ text: `in ${fmtTok(tmSession.input)} · out ${fmtTok(tmSession.output)} · cache r ${fmtTok(tmSession.cacheRead)} w ${fmtTok(tmSession.cacheWrite)}`, dim: true }], fill: true },
          ], w - 16, 2)}
        </Box>
        <Button key="tm" plain hotkey="t" label={tmOpen ? 'less' : 'details'} onPress={() => { tmOpen = !tmOpen; $.ui.invalidate('ui.render') }} />
      </Box>
      {tmOpen ? (
        <Box flexDirection="column">
          <Box columnGap={1}>
            <Box flexGrow={1} flexShrink={1}>
              {line(ui, [
                { spans: [{ text: 'project ', dim: true }, { text: tmScan.done ? `${fmtTok(project)} tokens` : 'scanning…', bold: true }] },
                tmScan.done ? { spans: [{ text: `${tmScan.files} sessions${tmScan.skipped ? ` (${tmScan.skipped} too large, not counted)` : ''}`, dim: true }], fill: true } : null,
              ], w - 16, 2)}
            </Box>
            <Button key="rescan" plain hotkey="r" label={tmScan.scanning ? 'scanning…' : 'rescan'} onPress={() => void tmRescan($)} />
          </Box>
          {line(ui, [{ spans: [{ text: 'cost ', dim: true }, { text: `${fmtCost(tmCost)} this session · last turn ${fmtCost(tmLastTurnCost)}${tmTurns ? ` · ${fmtCost(tmCost / tmTurns)}/turn` : ''}`, dim: true }], fill: true }], w - 4)}
          {models ? line(ui, [{ spans: [{ text: 'models ', dim: true }, { text: models, dim: true }], fill: true }], w - 4) : null}
        </Box>
      ) : null}
    </Box>
  )
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
      .catch(() => undefined)
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

// ===== architect =====
// The on-call architect: spawns of a matching agent type, or a matching server tool (Claude Code's advisor), on a timeline.
type Consult = { id: string; at: number; endAt: number | null; moment: string; via: string }
let archPattern = /advisor|architect/i
let archLabel = 'ARCHITECT'
let archMoments = true
let archMatchDesc = false
let archConsults: Consult[] = []
let archIds: string[] = [] // subagent ids that are consults
let archSeen: string[] = [] // server tool ids already counted
let archTypes: string[] = [] // agent types offered whose description matched
let archAdvice = ''
const archAdvising = () => archConsults.some(c => c.endAt === null)
const archShown = () => archConsults.length > 0 || archIds.length > 0
// Which moment a consult falls at, inferred from this turn so far.
const archMoment = () => (deckTurn.errorStreak >= 2 ? 'error repeats' : deckTurn.edits === 0 ? 'before a plan' : 'before done')
// The advice line a pane shows for a report: its first real line, markdown markers stripped.
const adviceLine = (report: string) => {
  const first = report.split('\n').map(l => l.trim()).find(l => l && !l.startsWith('[') && !l.startsWith('<')) ?? ''
  return shorten(first.replace(/\*\*|__/g, '').replace(/^[#>*\s-]+/, ''), 160)
}
// A subagent's hand-back message: who sent it and its first line after the framing header.
const handbackOf = (text: string) => {
  const from = /^\s*<agent-message\s+from="([^"]+)"/.exec(text)?.[1]
  if (!from) return null
  const rest = text.split(/The report follows:\s*\n/)[1] ?? text.replace(/^\s*<agent-message[^>]*>/, '')
  const body = rest.split('\n').map(l => l.trim()).find(l => l && !l.startsWith('[') && !l.startsWith('<')) ?? ''
  return body ? { from, body } : null
}

async function archStart($: any, id: string, via: string) {
  if (archConsults.some(c => c.id === id)) return
  const moment = archMoment()
  archConsults = [...archConsults, { id, at: await $.clock.now(), endAt: null, moment, via }].slice(-40)
  if (moment === 'before done') deckTurn = { ...deckTurn, isReviewing: true }
  logSay(archLabel.toLowerCase(), archMoments ? `${moment} · ${via}` : `consulted · ${via}`, 'consult')
  $.ui.invalidate('ui.render')
}

async function archEnd($: any, advice: string | null, id?: string) {
  const at = await $.clock.now()
  const open = [...archConsults].reverse().find(c => c.endAt === null && (id === undefined || c.id === id))
  archConsults = archConsults.map(c => (c === open ? { ...c, endAt: at } : c))
  const text = advice ? adviceLine(advice) : ''
  if (text) archAdvice = text
  deckTurn = { ...deckTurn, isReviewing: false }
  logSay(archLabel.toLowerCase(), text ? `advice: ${shorten(text, 60)}` : 'advice returned', 'consult')
  $.ui.invalidate('ui.render')
}

function archNote(advice: string) {
  if (!advice || advice === archAdvice) return
  archAdvice = advice
  logSay(archLabel.toLowerCase(), `advice: ${shorten(advice, 60)}`, 'consult')
}

export async function architectAgentOffer($: any, e: any, next: any) {
  const offered = await next(e)
  if ((archPattern.test(e.agent) || (archMatchDesc && archPattern.test(e.description))) && !archTypes.includes(e.agent)) archTypes = [...archTypes, e.agent].slice(-20)
  return offered
}

export async function architectAgentSpawn($: any, e: any, next: any) {
  const started = await next(e)
  if (started.deny === undefined && started.agentId && (archPattern.test(e.subagentType) || archTypes.includes(e.subagentType))) {
    archIds = [...archIds, started.agentId].slice(-40)
    await archStart($, started.agentId, e.subagentType.split(':').pop() ?? 'agent')
  }
  return started
}

export async function architectTurnStart($: any, e: any, next: any) {
  // A background architect's report reaches the main loop as the text opening a turn; SubagentHandback usually carries it first.
  const back = e.agentId === undefined && e.text ? handbackOf(e.text) : null
  if (back && archIds.includes(back.from)) archNote(adviceLine(back.body))
  return next(e)
}

export async function architectTurnComplete($: any, e: any, next: any) {
  const done = await next(e)
  if (e.agentId !== undefined && archIds.includes(e.agentId)) await archEnd($, e.answer ?? null, e.agentId)
  return done
}

export async function architectToolCall($: any, e: any, next: any) {
  const ran = await next(e)
  const message = (e as { message?: unknown }).message
  if (String(e.tool) === 'SubagentHandback' && e.agentId && archIds.includes(e.agentId) && typeof message === 'string') archNote(adviceLine(message))
  return ran
}

// A server-side review tool never reaches tool.call: it shows only in the assistant's rows.
export async function architectSessionAppend($: any, e: any, next: any) {
  if (e.agentId === undefined && e.message?.type === 'assistant' && Array.isArray(e.message.content)) {
    for (const block of e.message.content as { type: string; id?: string; name?: string; tool_use_id?: string }[]) {
      if (block.type === 'server_tool_use' && block.name && block.id && archPattern.test(block.name) && !archSeen.includes(block.id)) {
        archSeen = [...archSeen, block.id].slice(-60)
        await archStart($, block.id, `${block.name} tool`)
      } else if (block.type.endsWith('_tool_result') && block.tool_use_id && archConsults.some(c => c.id === block.tool_use_id && c.endAt === null)) {
        await archEnd($, null, block.tool_use_id)
      }
    }
  }
  return next(e)
}

// A one-row timeline of consults: ◆ a consult, ━ while it ran.
const archTimeline = (now: number, width: number) => {
  if (archConsults.length === 0 || width < 4) return '─'.repeat(Math.max(0, width))
  const first = archConsults[0].at
  const span = Math.max(1, now - first)
  const cells = Array.from({ length: width }, () => '─')
  for (const c of archConsults) {
    const from = Math.min(width - 1, Math.floor(((c.at - first) / span) * (width - 1)))
    const to = Math.min(width - 1, Math.floor((((c.endAt ?? now) - first) / span) * (width - 1)))
    for (let i = from + 1; i <= to; i += 1) cells[i] = '━'
    cells[from] = '◆'
  }
  return cells.join('')
}

function architectPanel(ui: any, w: number, now: number) {
  const { Box, Text } = ui
  const lastC = archConsults[archConsults.length - 1]
  return box(ui, {
    key: 'architect',
    color: C.arch,
    title: archLabel,
    state: archAdvising() ? 'advising' : 'on call',
    right: `consults ${archConsults.length}`,
    w,
    children: (
      <Box flexDirection="column">
        <Text color={C.arch} wrap="truncate-middle">{archTimeline(now, Math.max(8, w - 4))}</Text>
        <Text dimColor wrap="truncate">
          {!lastC ? 'not consulted yet' : archAdvising() ? `consulting since ${fmtClock(lastC.at)}` : `last ${fmtDur(now - (lastC.endAt ?? lastC.at))} ago · took ${fmtDur((lastC.endAt ?? now) - lastC.at)}`}
        </Text>
        {archMoments ? (
          <Box flexWrap="wrap" columnGap={2}>
            {['before a plan', 'error repeats', 'before done'].map(mo => <Box key={mo}><Text color={lastC?.moment === mo ? C.arch : C.dim} bold={lastC?.moment === mo}>{`${lastC?.moment === mo ? '◆' : '◇'} ${mo}`}</Text></Box>)}
            <Text color={C.faint}>(inferred)</Text>
          </Box>
        ) : null}
        {archAdvice ? <Text color={C.arch} wrap="truncate">{`» ${archAdvice}`}</Text> : null}
      </Box>
    ),
  })
}

// ===== permission-gate =====
// One cell per permission check: allowed by a rule, approved by guardrails' local decision model, cleared by the decider
// (you or the auto-mode classifier), pending, denied.
type Bucket = 'file' | 'shell' | 'other'
type Verdict = 'rule' | 'local' | 'ask' | 'cleared' | 'deny'
type Check = { id: string; tool: string; bucket: Bucket; verdict: Verdict; inSubagent: boolean; detail: string; at: number }
const gateZero = (): Record<Bucket, Record<Verdict, number>> => ({ file: { rule: 0, local: 0, ask: 0, cleared: 0, deny: 0 }, shell: { rule: 0, local: 0, ask: 0, cleared: 0, deny: 0 }, other: { rule: 0, local: 0, ask: 0, cleared: 0, deny: 0 } })
const LOCAL_REASON = 'guardrails: approved by local decision model'
let gateLabel = 'GATE'
let gateRecent: Check[] = []
let gateTotals = gateZero()
let gateOpen: Bucket | null = null
const FILE_TOOLS = new Set(['Read', 'Edit', 'Write', 'NotebookEdit', 'Glob', 'Grep'])
const bucketOf = (tool: string): Bucket => (FILE_TOOLS.has(tool) ? 'file' : tool === 'Bash' || tool === 'PowerShell' ? 'shell' : 'other')
const gateDecider = () => (deckMode === 'auto' ? 'classifier' : 'you')
const gateSummary = () => {
  const s = { rule: 0, local: 0, ask: 0, cleared: 0, deny: 0 }
  for (const b of ['file', 'shell', 'other'] as const) for (const v of ['rule', 'local', 'ask', 'cleared', 'deny'] as const) s[v] += gateTotals[b][v]
  return { ...s, total: s.rule + s.local + s.ask + s.cleared + s.deny }
}
// What a drill-down row or a log line may keep: one line saying what a call was about, credentials masked.
const describeInput = (tool: string, input: any) => {
  const i = input && typeof input === 'object' ? input : {}
  const path = typeof i.file_path === 'string' ? i.file_path.split(/[\\/]/).slice(-2).join('/') : ''
  const what = typeof i.command === 'string' ? i.command : path || (typeof i.pattern === 'string' ? i.pattern : typeof i.url === 'string' ? i.url : typeof i.description === 'string' ? i.description : '')
  return shorten(maskSecrets(what ? `${tool} → ${what}` : tool), 90)
}
const gateColor = (c: Check) => (c.verdict === 'rule' ? C.gate : c.verdict === 'local' ? C.arch : c.verdict === 'cleared' ? C.cleared : c.verdict === 'ask' ? C.amber : C.warn)
const gateMarks = (ui: any, list: Check[]) => list.map(c => <ui.Text color={gateColor(c)} dimColor={c.inSubagent}>{c.verdict === 'deny' ? '✗' : '■'}</ui.Text>)

export async function permissionGateToolCheck($: any, e: any, next: any) {
  const verdict = await next(e)
  if (e.tool_use_id) {
    const v: Verdict = verdict.decision === 'allow' ? (String(verdict.reason ?? '').startsWith(LOCAL_REASON) ? 'local' : 'rule') : verdict.decision
    const c: Check = { id: e.tool_use_id, tool: e.tool, bucket: bucketOf(e.tool), verdict: v, inSubagent: e.agentId !== undefined, detail: describeInput(e.tool, e.input), at: await $.clock.now() }
    // Keep the last 80, but never drop a pending ask: its settle must still find it.
    let extra = gateRecent.length + 1 - 80
    gateRecent = [...gateRecent, c].filter(x => !(extra > 0 && x.verdict !== 'ask' && extra-- > 0))
    gateTotals[c.bucket][v] += 1
    if (v === 'deny') logSay('gate', `denied by rule · ${c.detail}`, 'error')
    $.ui.invalidate('ui.render')
  }
  return verdict
}

// An ask settled by the call that followed it: it ran (cleared) or was refused (deny).
export async function permissionGateToolCall($: any, e: any, next: any) {
  const ran = await next(e)
  const c = gateRecent.find(r => r.id === e.tool_use_id && r.verdict === 'ask')
  if (c) {
    const v: Verdict = ran.deny === undefined ? 'cleared' : 'deny'
    gateRecent = gateRecent.map(r => (r === c ? { ...r, verdict: v } : r))
    gateTotals[c.bucket].ask = Math.max(0, gateTotals[c.bucket].ask - 1)
    gateTotals[c.bucket][v] += 1
    $.ui.invalidate('ui.render')
  }
  return ran
}

// guardrails may sit beneath this hook, its approval then landing after the check was counted as allowed or pending:
// its `decisions` state names the checks it approved, which are retagged local here.
function gateRetag(rows: any[]) {
  const ids = new Set(rows.filter(r => r?.kind === 'gate' && r.id && r.verdict === 'allow').map(r => r.id))
  gateRecent = gateRecent.map(c => {
    if (!ids.has(c.id) || (c.verdict !== 'rule' && c.verdict !== 'ask')) return c
    gateTotals[c.bucket][c.verdict] = Math.max(0, gateTotals[c.bucket][c.verdict] - 1)
    gateTotals[c.bucket].local += 1
    return { ...c, verdict: 'local' }
  })
}

function gatePanel($: any, ui: any, e: any, w: number) {
  const { Box, Text, Button } = ui
  const s = gateSummary()
  const isTerminal = e.surface === 'terminal'
  // A graphical surface draws ■ wider than a cell (about 1.4): fewer marks fit, the newest still show.
  const strip = gateRecent.slice(-Math.max(8, isTerminal ? w - 4 : Math.floor((w - 4) / 1.5)))
  const totals = (short: boolean): Piece[] => [
    { key: 'r', spans: [{ text: '■', color: C.gate }, { text: short ? ` ${s.rule}` : ` ${s.rule} allowed`, dim: true }] },
    ...(s.local ? [{ key: 'l', spans: [{ text: '■', color: C.arch }, { text: short ? ` ${s.local}` : ` ${s.local} local`, dim: true }] }] : []),
    { key: 'c', spans: [{ text: '■', color: C.cleared }, { text: short ? ` ${s.cleared}` : ` ${s.cleared} ${gateDecider()}`, dim: true }] },
    ...(s.ask ? [{ key: 'a', spans: [{ text: short ? `■ ${s.ask}` : `■ ${s.ask} pending`, color: C.amber }] }] : []),
    { key: 'd', spans: [{ text: short ? `✗ ${s.deny}` : `✗ ${s.deny} denied`, color: s.deny ? C.warn : C.dim }] },
  ]
  const words = totals(false)
  return box(ui, {
    key: 'gate',
    color: C.gate,
    title: gateLabel,
    state: 'permissions',
    right: plural(s.total, 'check'),
    w,
    children: (
      <Box flexDirection="column">
        <Box overflow="hidden"><Text wrap="truncate-start">{gateMarks(ui, strip)}</Text></Box>
        {line(ui, wordsFit(words, w) ? words : totals(true), w - 4, 2)}
        <Box columnGap={2} flexWrap="wrap">
          {(['file', 'shell', 'other'] as const).map(b => {
            const t = gateTotals[b]
            const n = t.rule + t.local + t.ask + t.cleared + t.deny
            return <Button key={`gate-${b}`} plain hotkey={b[0]} dimColor={n === 0} label={`${b} ${n}${gateOpen === b ? ' ▾' : ''}`} onPress={() => { gateOpen = gateOpen === b ? null : b; $.ui.invalidate('ui.render') }} />
          })}
        </Box>
        {gateOpen
          ? gateRecent.filter(c => c.bucket === gateOpen).slice(-5).map(c => (
              <Box key={`g-${c.id}`} columnGap={1}>
                <Box width={12} flexShrink={0}><Text><Text color={gateColor(c)}>{c.verdict === 'deny' ? '✗ ' : '■ '}</Text><Text color={C.dim}>{c.verdict === 'rule' ? 'allowed' : c.verdict === 'local' ? 'local' : c.verdict === 'cleared' ? gateDecider() : c.verdict === 'ask' ? 'pending' : 'denied'}</Text></Text></Box>
                <Box flexShrink={1}><Text dimColor={c.inSubagent} wrap="truncate">{c.detail}</Text></Box>
              </Box>
            ))
          : null}
      </Box>
    ),
  })
}
// Totals in words where they all fit on the row, in numbers alone where they don't.
const wordsFit = (pieces: Piece[], w: number) => pieces.reduce((n, p) => n + p.spans.reduce((m, s) => m + [...s.text].length, 0) + 2, 0) <= w - 4

// ===== decisions =====
// guardrails' local decision models, read from its `decisions` state: the local tokens they spent, what they decided, and
// what that saved: the Claude tokens the same decisions would have cost, and the round trips through you they avoided.
let dmLast: any = null // the latest GuardrailsDecisions
let dmOpen = false

export async function decisionsStateSet($: any, e: any, next: any, retag: boolean) {
  const v = e.value
  if (v && typeof v === 'object') {
    const u = await $.session.usage().catch(() => null)
    ctxTokens = u?.context?.tokens ?? ctxTokens
    cost = u?.cost?.usd ?? cost
    dmLast = v
    if (retag) gateRetag(Array.isArray(v.recent) ? v.recent : [])
    $.ui.invalidate('ui.render')
  }
  return next(e)
}

const dmCounts = (v: any) => {
  const auto = (v.gate?.auto ?? 0) + (v.answers?.auto ?? 0) + (v.models?.picked ?? 0)
  const asked = (v.gate?.asked ?? 0) + (v.answers?.asked ?? 0)
  const kept = v.models?.kept ?? 0 // the model picker left the subagent's model as asked: a decision, not a question
  return { auto, asked, kept, total: auto + asked + kept }
}

function decisionsPanel($: any, ui: any, w: number) {
  const { Box, Text, Button } = ui
  const v = dmLast
  const n = dmCounts(v)
  const tok = tmSum(tmSession)
  // The session's average rate; with no cost or tokens yet the $ is left out.
  const usd = cost > 0 && tok > 0 ? ` · ${fmtCost(((v.llmTokens ?? 0) * cost) / tok)}` : ''
  const recent: any[] = Array.isArray(v.recent) ? v.recent.slice(-3).reverse() : []
  const row = (label: string, text: string) => line(ui, [{ spans: [{ text: `${label} `, dim: true }, { text, dim: true }], fill: true }], w - 4)
  return box(ui, {
    key: 'decisions',
    color: v.offline ? C.amber : C.arch,
    title: 'DECISIONS',
    state: v.offline ? 'offline' : 'local',
    right: plural(v.calls ?? 0, 'call'),
    w,
    children: (
      <Box flexDirection="column">
        <Box columnGap={1}>
          <Box flexGrow={1} flexShrink={1}>
            <Text color={v.offline ? C.amber : C.text} wrap="truncate">{v.offline ? 'decision models offline · prompts as usual' : `local ${fmtTok(v.tokens ?? 0)} tok · ${plural(n.total, 'decision')} (${n.auto} auto · ${n.asked} asked)`}</Text>
          </Box>
          <Button key="dm" plain hotkey="d" label={dmOpen ? 'less' : 'details'} onPress={() => { dmOpen = !dmOpen; $.ui.invalidate('ui.render') }} />
        </Box>
        {dmOpen ? (
          <Box flexDirection="column">
            {row('local', `${fmtTok(v.tokens ?? 0)} tok · ${plural(v.calls ?? 0, 'call')}`)}
            {row('saved (est)', `${fmtTok(v.llmTokens ?? 0)} tok${usd} as Claude decisions`)}
            {row('round trips avoided (est)', `${fmtTok(dmLast.avoided ?? 0)} tok`)}
            {n.kept ? row('subagent models', `${n.kept} kept`) : null}
            {row('tiers', `fast ${v.fast || '—'} · strong ${v.strong || '—'}`)}
            {recent.map((r, i) => (
              <Box key={`dm-${i}`} columnGap={1}>
                <Text color={C.arch}>◆</Text>
                <Box flexShrink={0}><Text dimColor>{`${r.kind} ${r.verdict} ${Number(r.confidence ?? 0).toFixed(2)}`}</Text></Box>
                <Box flexShrink={1}><Text wrap="truncate">{r.text}</Text></Box>
              </Box>
            ))}
          </Box>
        ) : null}
      </Box>
    ),
  })
}

// ===== loops =====
// Model loops no card claims: workflow agents, compactions, memory forks.
type Loop = { id: string; steps: number; firstAt: number; lastAt: number; isDone: boolean }
let loopsList: Loop[] = []
const loopClaimed = new Set<string>() // subagent ids an agent.spawn started
const loopActive = (l: Loop, now: number) => !l.isDone && now - l.lastAt < 15_000

export async function loopsAgentSpawn($: any, e: any, next: any) {
  const started = await next(e)
  if (started.agentId) {
    loopClaimed.add(started.agentId)
    loopsList = loopsList.filter(l => l.id !== started.agentId)
  }
  return started
}

export async function* loopsTurnStep($: any, e: any, next: any) {
  const result = yield* next(e)
  if (e.agentId !== undefined && !loopClaimed.has(e.agentId)) {
    const at = await $.clock.now()
    const found = loopsList.find(l => l.id === e.agentId)
    loopsList = (found ? loopsList.map(l => (l === found ? { ...l, steps: l.steps + 1, lastAt: at } : l)) : [...loopsList, { id: e.agentId, steps: 1, firstAt: at, lastAt: at, isDone: false }]).slice(-60)
    $.ui.invalidate('ui.render')
  }
  return result
}

export async function loopsTurnComplete($: any, e: any, next: any) {
  const done = await next(e)
  if (e.agentId !== undefined && loopsList.some(l => l.id === e.agentId)) {
    const at = await $.clock.now()
    loopsList = loopsList.map(l => (l.id === e.agentId ? { ...l, isDone: true, lastAt: at } : l))
  }
  return done
}

function loopsPanel(ui: any, e: any, w: number, now: number) {
  const { Box, Text } = ui
  const active = loopsList.filter(l => loopActive(l, now)).length
  const dots = loopsList.slice(-Math.max(4, e.surface === 'terminal' ? w - 38 : Math.floor((w - 38) / 1.5)))
  return (
    <Box key="loops" width={w} columnGap={1}>
      <Text bold>{w < 40 ? 'loops' : 'other loops'}</Text>
      <Text dimColor>{`${loopsList.length} seen · ${active} active`}</Text>
      <Box overflow="hidden" flexShrink={1}>
        <Text wrap="truncate-start">{dots.map(l => <Text color={loopActive(l, now) ? C.agent : l.isDone ? C.dim : C.faint}>{loopActive(l, now) ? '●' : l.isDone ? '✓' : '○'}</Text>)}</Text>
      </Box>
    </Box>
  )
}

// ===== turn-receipt =====
// The running turn, or the last one: duration, agents, edits, errors, cost added.
type Receipt = { durationMs: number; agents: number; edits: number; errors: number; costDelta: number | null; reason: string }
let receiptLast: Receipt | null = null
let receiptSpawns: number[] = [] // when each subagent started, to count this turn's

const receiptText = (r: Receipt) => `last turn ${fmtDur(r.durationMs)} · ${plural(r.agents, 'agent')} · ${plural(r.edits, 'edit')} · ${plural(r.errors, 'error')}${r.costDelta !== null ? ` · +${fmtCost(r.costDelta)}` : ''}`

export async function turnReceiptAgentSpawn($: any, e: any, next: any) {
  receiptSpawns = [...receiptSpawns, await $.clock.now()].slice(-200)
  return next(e)
}

export async function turnReceiptTurnComplete($: any, e: any, next: any) {
  const done = await next(e)
  if (e.agentId === undefined) {
    const now = (await $.session.usage().catch(() => null))?.cost?.usd ?? null
    const delta = now !== null && deckTurn.costAtStart !== null ? now - deckTurn.costAtStart : null
    receiptLast = {
      durationMs: e.durationMs ?? 0,
      agents: receiptSpawns.filter(t => t >= deckTurn.startedAt).length,
      edits: deckTurn.edits,
      errors: deckTurn.errors,
      costDelta: delta !== null && delta >= 0.005 ? delta : null,
      reason: e.reason,
    }
    $.ui.invalidate('ui.render')
  }
  return done
}

function receiptPanel(ui: any, e: any, w: number, now: number) {
  const { Box, Text } = ui
  const r = receiptLast
  return (
    <Box key="receipt" flexDirection="column" borderStyle="round" borderColor={C.main} borderDimColor={!deckRunning && !deckTurn.isReviewing} paddingX={1} width={w}>
      {deckRunning ? (
        <Box columnGap={1}>
          <Text color={C.main} wrap="truncate">{`◐ back to ${prettyModel(deckModel).toLowerCase()} · turn`}</Text>
          <Box flexShrink={0}>{liveClock(ui, e, 'turn-clock', deckTurn.startedAt, now, null, C.main)}</Box>
          {w >= 60 ? <Text dimColor wrap="truncate">{`· ${plural(deckTurn.edits, 'edit')} · ${plural(deckTurn.errors, 'error')}`}</Text> : null}
        </Box>
      ) : r ? (
        line(ui, [
          { spans: [{ text: r.reason === 'answer' ? '✓' : '✗', color: r.reason === 'answer' ? C.gate : C.warn }] },
          { spans: [{ text: `last turn ${fmtDur(r.durationMs)} · ${plural(r.agents, 'agent')} · ${plural(r.edits, 'edit')} · ${plural(r.errors, 'error')}` }], fill: true },
          r.costDelta !== null ? { spans: [{ text: `· +${fmtCost(r.costDelta)}`, color: C.main }] } : null,
        ], w - 4)
      ) : (
        <Text color={C.faint}>no turn finished yet</Text>
      )}
      {deckTurn.isReviewing ? <Text color={C.arch} wrap="wrap">{`${archLabel.toLowerCase()} reviewing before done (inferred)`}</Text> : null}
    </Box>
  )
}

// ===== session-log =====
// Prompts, spawns, completions, consults, edits, errors and denials; filtered to one agent while its transcript is in view.
type LogLine = { at: number; who: string; text: string; kind: 'info' | 'error' | 'consult' | 'done'; agentId: string | null }
let logLines: LogLine[] = []
let logOn = true

function logSay(who: string, text: string, kind: LogLine['kind'] = 'info', agentId: string | null = null) {
  if (logOn) logLines = [...logLines, { at: Date.now(), who, text, kind, agentId }].slice(-60)
}

// What a turn's opening text was: the person's words, or for a turn the engine opened with a tagged message, its kind.
const promptLine = (text: string) => {
  const tag = /^\s*<([a-z][\w-]*)/i.exec(text)?.[1]
  if (!tag) return { who: 'you', text: shorten(text, 70) }
  const from = /\bfrom="([^"]+)"/.exec(text)?.[1]
  return { who: 'engine', text: shorten(`${tag.replace(/[-_]/g, ' ')}${from ? ` from ${from.slice(0, 8)}` : ''}`, 70) }
}

export async function sessionLogTurnStart($: any, e: any, next: any) {
  if (e.agentId === undefined && e.text) {
    const p = promptLine(e.text)
    logSay(p.who, p.text)
  }
  return next(e)
}

export async function sessionLogAgentSpawn($: any, e: any, next: any) {
  const started = await next(e)
  if (started.deny === undefined && started.agentId) logSay(shorten(e.description || e.subagentType, 12), `spawned · ${e.subagentType}`, 'info', started.agentId)
  return started
}

export async function sessionLogTurnComplete($: any, e: any, next: any) {
  const done = await next(e)
  if (e.agentId !== undefined && !archIds.includes(e.agentId) && !loopsList.some(l => l.id === e.agentId)) {
    const ok = e.reason === 'answer'
    logSay(agentName(e.agentId), ok ? `done · ${fmtDur(e.durationMs ?? 0)}` : e.reason === 'aborted' ? 'stopped' : 'failed', ok ? 'done' : 'error', e.agentId)
  }
  return done
}

// The log keeps what is worth a glance: refusals, errors and edits; the rest is on the cards.
export async function sessionLogToolCall($: any, e: any, next: any) {
  const ran = await next(e)
  const t = String(e.tool)
  if (t === 'Agent' || t === 'SubagentHandback') return ran
  const text = shorten(describeInput(t, e), 64)
  const who = agentName(e.agentId)
  if (ran.deny !== undefined) logSay(who, `${text}  denied`, 'error', e.agentId ?? null)
  else if (ran.isError === true) logSay(who, `${text}  ✗`, 'error', e.agentId ?? null)
  else if (['Edit', 'Write', 'NotebookEdit'].includes(t)) logSay(who, text, 'info', e.agentId ?? null)
  return ran
}

export async function sessionLogSessionCompact($: any, e: any, next: any) {
  const done = await next(e)
  if (e.agentId === undefined && e.trigger !== 'precompute') logSay('main', `context compacted (${e.trigger})`)
  return done
}

function logPanel(ui: any, e: any, w: number) {
  const { Box, Text } = ui
  const viewed = e.props.view?.agentId ?? null
  // Whatever rows the panels above leave, 4 to 8.
  const n = Math.max(4, Math.min(8, (e.props.scroll?.bodyRows ?? 40) - 30))
  const shown = (viewed ? logLines.filter(l => l.agentId === viewed) : logLines).slice(-n)
  const colorOf = (l: LogLine) => (l.kind === 'error' ? C.warn : l.kind === 'consult' ? C.arch : l.who === 'main' ? C.main : l.who === 'gate' ? C.gate : l.who === 'you' ? C.text : C.agent)
  return (
    <Box key="log" flexDirection="column" borderStyle="round" borderColor={C.faint} paddingX={1} marginTop={1} width={w}>
      <Text dimColor wrap="truncate">{viewed ? 'session log · this agent' : 'session log'}</Text>
      {shown.length === 0 ? <Text color={C.faint}>nothing yet</Text> : null}
      {shown.map((l, i) => (
        <Box key={`log${i}`}>
          <Box width={w < 40 ? 6 : 9} flexShrink={0}><Text color={C.faint}>{w < 40 ? fmtClock(l.at).slice(0, 5) : fmtClock(l.at)}</Text></Box>
          <Box width={w < 40 ? 9 : 13} flexShrink={0}><Text color={colorOf(l)} bold wrap="truncate">{l.who}</Text></Box>
          <Box flexShrink={1}><Text color={l.kind === 'error' ? C.warn : undefined} wrap="truncate">{l.text}</Text></Box>
        </Box>
      ))}
    </Box>
  )
}

// Each mod is on unless its userConfig flag is false (toggle in the config menu; the module reloads).
export const register: Register = (on, options) => {
  usePalette(options.palette, options.motion)
  const str = (k: string, d: string) => (typeof options[k] === 'string' && options[k] !== '' ? (options[k] as string) : d)
  const num = (k: string, d: number) => (typeof options[k] === 'number' && Number.isFinite(options[k]) ? Math.round(options[k] as number) : d)
  cockpitCfg = {
    layout: ['compact', 'wide', 'mini'].includes(str('layout', 'auto')) ? str('layout', 'auto') : 'auto',
    maxCards: Math.min(6, Math.max(1, num('maxCards', 3))),
    paneColumns: Math.max(40, num('paneColumns', 66)), // the body clamps at 40 columns, a narrower dock only clips it
    openOnStart: options.openOnStart !== false,
  }
  try {
    archPattern = new RegExp(str('architectPattern', 'advisor|architect'), 'i')
  } catch {
    archPattern = /advisor|architect/i
  }
  archLabel = str('architectLabel', 'ARCHITECT')
  gateLabel = str('gateLabel', 'GATE')
  archMoments = options.moments !== false
  archMatchDesc = options.matchDescriptions === true
  logOn = options.sessionLog !== false
  const off = (k: string) => options[k] === false

  on('session.start', ($, e, next) => {
    const n7 = (x: any) => next(x)
    const n6 = (x: any) => (off('tokenMeter') ? n7(x) : tokenMeterSessionStart($, x, n7))
    const n5 = (x: any) => (off('usageLimits') ? n6(x) : usageLimitsSessionStart($, x, n6))
    const n4 = (x: any) => (off('filetree') ? n5(x) : filetreeSessionStart($, x, n5))
    const n3 = (x: any) => (off('contextHealth') ? n4(x) : contextHealthSessionStart($, x, n4))
    const n2 = (x: any) => (off('cacheKeeper') ? n3(x) : cacheKeeperSessionStart($, x, n3))
    const n1 = (x: any) => (off('agentsProgress') ? n2(x) : agentsProgressSessionStart($, x, n2))
    return cockpitSessionStart($, e, n1)
  })
  on('session.end', cockpitSessionEnd)
  on('classic.UserPromptSubmit', cockpitUserPromptSubmit)
  on('command.run', { command: 'cockpit' }, cockpitCommandRun)
  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e) => cockpitUiRenderPane($, e, options)).catch(($, e, next) => {
    // Without this a failed draw leaves the engine's empty pane.
    const ui = $.ui.resolve(e)
    return (
      <ui.Box flexDirection="column">
        <ui.Text bold>COCKPIT</ui.Text>
        <ui.Text color={C.warn} wrap="wrap">{`draw failed (${next.error.kind}): ${next.error.message ?? 'no message'}`}</ui.Text>
      </ui.Box>
    )
  })
  on('ui.fault', ($, e, next) => {
    const key = `${e.surface}:${e.module.split(/[\\/]/).pop()}`
    if (!faulted.has(key)) {
      faulted.add(key)
      $.ui.log(`cockpit: ${e.module} faulted on ${e.surface} (${e.phase}: ${e.reason}); drawing it without animation`)
      $.ui.invalidate('ui.render')
    }
    return next(e)
  })
  if (!off('agentsProgress')) on('command.run', { command: 'agents-info' }, agentsProgressCommandRunAgentsInfo)
  if (!off('agentsProgress')) on('classic.Stop', agentsProgressStop)
  on('agent.spawn', ($, e, next) => {
    const n5 = (x: any) => next(x)
    const n4 = (x: any) => (off('sessionLog') ? n5(x) : sessionLogAgentSpawn($, x, n5))
    const n3 = (x: any) => (off('turnReceipt') ? n4(x) : turnReceiptAgentSpawn($, x, n4))
    const n2 = (x: any) => (off('loops') ? n3(x) : loopsAgentSpawn($, x, n3))
    const n1 = (x: any) => (off('architect') ? n2(x) : architectAgentSpawn($, x, n2))
    return off('agentsProgress') ? n1(e) : agentsProgressAgentSpawn($, e, n1)
  })
  if (!off('architect')) on('agent.offer', architectAgentOffer)
  if (!off('architect')) on('session.append', architectSessionAppend)
  if (!off('permissionGate')) on('tool.check', permissionGateToolCheck)
  if (!off('decisions')) on('state.set', { plugin: 'guardrails', key: 'decisions' }, ($, e, next) => decisionsStateSet($, e, next, !off('permissionGate')))
  on('session.compact', ($, e, next) => {
    const n1 = (x: any) => (off('sessionLog') ? next(x) : sessionLogSessionCompact($, x, next))
    return off('contextHealth') ? n1(e) : contextHealthSessionCompact($, e, n1)
  })
  on('tool.call', ($, e, next) => {
    const n8 = (x: any) => next(x)
    const n7 = (x: any) => (off('sessionLog') ? n8(x) : sessionLogToolCall($, x, n8))
    const n6 = (x: any) => (off('architect') ? n7(x) : architectToolCall($, x, n7))
    const n5 = (x: any) => (off('permissionGate') ? n6(x) : permissionGateToolCall($, x, n6))
    const n4 = (x: any) => cockpitToolCall($, x, n5)
    const n3 = (x: any) => (off('contextHealth') ? n4(x) : contextHealthToolCall($, x, n4))
    const n2 = (x: any) => (off('filetree') ? n3(x) : filetreeToolCall($, x, n3))
    return off('agentsProgress') ? n2(e) : agentsProgressToolCall($, e, n2)
  })
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    beginPass()
    const n7 = (x: any) => next(x)
    const n6 = (x: any) => (off('nextSteps') ? n7(x) : nextStepsUiRenderAbovePrompt($, x, n7))
    const n5 = (x: any) => (off('tokenMeter') ? n6(x) : tokenMeterUiRenderAbovePrompt($, x, n6))
    const n4 = (x: any) => (off('usageLimits') ? n5(x) : usageLimitsUiRenderAbovePrompt($, x, n5))
    const n3 = (x: any) => (off('filetree') ? n4(x) : filetreeUiRenderAbovePrompt($, x, n4))
    const n2 = (x: any) => (off('contextHealth') ? n3(x) : contextHealthUiRenderAbovePrompt($, x, n3))
    const n1 = (x: any) => (off('cacheKeeper') ? n2(x) : cacheKeeperUiRenderAbovePrompt($, x, n2))
    const drawn = await (off('agentsProgress') ? n1(e) : agentsProgressUiRenderAbovePrompt($, e, n1))
    // The calm segments live in the pane while it is open; with it closed they are one summary line with an Open button.
    if (await paneIsOpen($, PANE)) return drawn
    return quietLine($.ui.resolve(e), e, drawn, { name: 'cockpit', open: () => void cockpitOpen($) })
  })
  if (!off('cacheKeeper')) on('command.run', { command: 'keepwarm' }, cacheKeeperCommandRunKeepwarm)
  if (!off('cacheKeeper')) on('command.run', { command: 'cache-tax' }, cacheKeeperCommandRunCacheTax)
  on('prompt.submit', ($, e, next) => {
    const n4 = (x: any) => next(x)
    const n3 = (x: any) => (off('contextHealth') ? n4(x) : contextHealthPromptSubmit($, x, n4))
    const n2 = (x: any) => (off('nextSteps') ? n3(x) : nextStepsPromptSubmit($, x, n3))
    const n1 = (x: any) => (off('filetree') ? n2(x) : filetreePromptSubmit($, x, n2))
    return off('cacheKeeper') ? n1(e) : cacheKeeperPromptSubmit($, e, n1)
  })
  on('turn.start', ($, e, next) => {
    const n5 = (x: any) => next(x)
    const n4 = (x: any) => (off('sessionLog') ? n5(x) : sessionLogTurnStart($, x, n5))
    const n3 = (x: any) => (off('architect') ? n4(x) : architectTurnStart($, x, n4))
    const n2 = (x: any) => cockpitTurnStart($, x, n3)
    const n1 = (x: any) => (off('tokenMeter') ? n2(x) : tokenMeterTurnStart($, x, n2))
    return off('contextHealth') ? n1(e) : contextHealthTurnStart($, e, n1)
  })
  // Every generator here returns the result of the stream beneath it, so the hooks above still read it.
  on('turn.step', async function* ($, e, next) {
    const n4 = (x: any) => cockpitTurnStep($, x, next)
    const n3 = (x: any) => (off('loops') ? n4(x) : loopsTurnStep($, x, n4))
    const n2 = (x: any) => (off('agentsProgress') ? n3(x) : agentsProgressTurnStep($, x, n3))
    const n1 = (x: any) => (off('tokenMeter') ? n2(x) : tokenMeterTurnStep($, x, n2))
    return yield* (off('contextHealth') ? n1(e) : contextHealthTurnStep($, e, n1))
  })
  on('turn.complete', ($, e, next) => {
    const n10 = (x: any) => next(x)
    const n9 = (x: any) => cockpitTurnComplete($, x, n10)
    const n8 = (x: any) => (off('sessionLog') ? n9(x) : sessionLogTurnComplete($, x, n9))
    const n7 = (x: any) => (off('turnReceipt') ? n8(x) : turnReceiptTurnComplete($, x, n8))
    const n6 = (x: any) => (off('loops') ? n7(x) : loopsTurnComplete($, x, n7))
    const n5 = (x: any) => (off('architect') ? n6(x) : architectTurnComplete($, x, n6))
    const n4 = (x: any) => (off('agentsProgress') ? n5(x) : agentsProgressTurnComplete($, x, n5))
    const n3 = (x: any) => (off('tokenMeter') ? n4(x) : tokenMeterTurnComplete($, x, n4))
    const n2 = (x: any) => (off('nextSteps') ? n3(x) : nextStepsTurnComplete($, x, n3))
    const n1 = (x: any) => (off('contextHealth') ? n2(x) : contextHealthTurnComplete($, x, n2))
    return off('cacheKeeper') ? n1(e) : cacheKeeperTurnComplete($, e, n1)
  })
  if (!off('contextHealth')) on('command.run', { command: 'ctx-handoff' }, contextHealthCommandRunHandoff)
  if (!off('contextHealth')) on('command.run', { command: 'autohandoff' }, contextHealthCommandRunAutohandoff)
  if (!off('usageLimits')) on('session.measure', usageLimitsSessionMeasure)
  if (!off('filetree')) on('command.run', { command: 'filetree' }, filetreeCommandRunFiletree)
  if (!off('filetree')) on('ui.render', { component: 'Pane', requestId: 'filetree' }, filetreeUiRenderPaneFiletree)
}
