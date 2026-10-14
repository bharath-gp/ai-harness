import type { Register } from 'claude-code'

type Agent = { id: string; type: string; desc: string; model?: string; startedAt: number; endedAt?: number; failed?: boolean }

const secs = (ms: number) => (ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`)

let agents: Agent[] = []
let subTools = 0 // tool calls made inside subagents; ponytail: not split per agent, no id link on spawn

const redraw = ($: any) => $.ui.invalidate('ui.render')
const running = () => agents.filter(a => a.endedAt === undefined)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'agents-info', description: 'Show the subagents panel' })
    $.clock.every(1000, () => running().length && redraw($)) // elapsed-time tick
    return next(e)
  })

  on('command.run', { command: 'agents-info' }, async $ => {
    await $.ui.open({ id: 'agents', title: 'Agents' })
    return { text: 'Agents panel opened.' }
  })

  on('agent.spawn', async ($, e, next) => {
    const a: Agent = { id: e.tool_use_id, type: e.subagentType, desc: e.description, startedAt: await $.clock.now() }
    agents = [...agents, a].slice(-50)
    redraw($)
    const r = await next(e)
    a.endedAt = await $.clock.now()
    a.failed = r.deny !== undefined
    a.model = r.model
    redraw($)
    return r
  })

  on('tool.call', ($, e, next) => {
    if (e.agentId !== undefined) subTools += 1
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const live = running()
    if (e.props.hasSurvey || live.length === 0) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    return (
      <Box>
        <Text color="claude">⚙ {live.length} agent{live.length > 1 ? 's' : ''} running </Text>
        <Text dimColor>({agents.length} total, {subTools} tool calls) </Text>
        <Button key="open" label="Panel" onPress={() => $.ui.open({ id: 'agents', title: 'Agents' })} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: 'agents' }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const now = await $.clock.now()
    return (
      <Box flexDirection="column">
        {agents.length === 0 && <Text dimColor>No subagents yet.</Text>}
        {[...agents].reverse().map(a => (
          <Box key={a.id} flexDirection="column" marginBottom={1}>
            <Text color={a.endedAt === undefined ? 'claude' : a.failed ? 'error' : 'success'}>
              {a.endedAt === undefined ? '● running' : a.failed ? '✗ failed' : '✓ done'} {a.type}
            </Text>
            <Text dimColor>  {a.desc.slice(0, 60)}  {secs((a.endedAt ?? now) - a.startedAt)}{a.model ? `  ${a.model}` : ''}</Text>
          </Box>
        ))}
      </Box>
    )
  })
}
