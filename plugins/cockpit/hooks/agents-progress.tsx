import { band, item } from './band'
import { tile } from './kit'
import { below, fmtCost, fmtDur, fmtTok, P, type Tone } from './ui'

type Agent = { id: string; type: string; desc: string; model?: string; startedAt: number; endedAt?: number; failed?: boolean }

let agents: Agent[] = []
let subTools = 0 // tool calls made inside subagents; ponytail: not split per agent, no id link on spawn
let cost = 0
let ctxTokens = 0
let showFinished = true

function redraw($: any) { return $.ui.invalidate('ui.render') }
const running = () => agents.filter(a => a.endedAt === undefined)
const finished = () => agents.filter(a => a.endedAt !== undefined)
const pctDone = () => (agents.length ? (finished().length / agents.length) * 100 : 0)
const TIERS = [P.accent, P.info, P.ok, P.warn, P.purple, P.teal]
// A stable colour per subagent type, so "Explore" is always the same tier colour.
const tierColor = (type: string) => TIERS[[...type].reduce((n, c) => n + c.charCodeAt(0), 0) % TIERS.length] as string
const tone = (a: Agent): Tone => (a.endedAt === undefined ? 'accent' : a.failed ? 'err' : 'ok')
const clock = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')}`

async function sync($: any) {
  const u = await $.session.usage()
  cost = u.cost?.usd ?? cost
  ctxTokens = u.context.tokens ?? ctxTokens
  redraw($)
}

export async function agentsProgressSessionStart($: any, e: any, next: any) {
  await $.command.register({ name: 'agents-info', description: 'Show the subagents panel' })
  $.clock.every(1000, () => running().length && redraw($)) // elapsed-time tick
  $.clock.every(8000, () => running().length && void sync($))
  return next(e)
}

export async function agentsProgressCommandRunAgentsInfo($: any) {
  await $.ui.open({ id: 'agents', title: 'Agents' })
  return { text: 'Agents panel opened.' }
}

export async function agentsProgressAgentSpawn($: any, e: any, next: any) {
  const a: Agent = { id: e.tool_use_id, type: e.subagentType, desc: e.description, startedAt: await $.clock.now() }
  agents = [...agents, a].slice(-50)
  redraw($)
  const r = await next(e)
  a.endedAt = await $.clock.now()
  a.failed = r.deny !== undefined
  a.model = r.model
  void sync($)
  return r
}

export function agentsProgressToolCall($: any, e: any, next: any) {
  if (e.agentId !== undefined) subTools += 1
  return next(e)
}

export async function agentsProgressUiRenderAbovePrompt($: any, e: any, next: any) {
  const live = running()
  if (e.props.hasSurvey || live.length === 0) return next(e)
  return band($.ui.resolve(e), e, await below(next, e), {
    title: 'Agents',
    tone: 'accent',
    busy: true,
    pct: pctDone(),
    pctLabel: `${live.length} running · ${finished().length}/${agents.length}`,
    detail: undefined,
    buttons: [{ key: 'open', label: `×${agents.length}`, plain: true, onPress: () => $.ui.open({ id: 'agents', title: 'Agents' }) }],
  })
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
        <Button key="fin" plain label={`${showFinished ? '▾' : '▸'} Finished · ${done.length}`} onPress={() => { showFinished = !showFinished; redraw($) }} />
      ) : null}
      {showFinished ? done.map(card) : null}
      {subTools ? <Text color={P.muted}>{`${subTools} tool calls inside subagents`}</Text> : null}
    </Box>
  )
}
