import type { Register } from 'claude-code'

const HANDOFF_FILE = '.claude/handoff.md'
const HANDOFF_PROMPT = `Write a handoff brief to ${HANDOFF_FILE} so a fresh session can continue this work: goal, decisions made, files touched, current state, exact next steps. Keep it under 60 lines. Reply "handoff written" when done.`

let percent = 0
let threshold = 50 // ponytail: stored per session; persist via $.store if wanted across sessions
let auto = false
let handingOff = false

const refresh = async ($: any) => {
  const { context } = await $.session.usage()
  percent = Math.round(context.percent ?? 0)
  $.ui.invalidate('ui.render')
}

const startHandoff = ($: any) => {
  handingOff = true
  void $.prompt.submit({ text: HANDOFF_PROMPT })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'handoff', description: 'Write a handoff brief, clear, and continue in a fresh context' })
    await $.command.register({ name: 'autohandoff', description: 'Auto handoff at a context %: /autohandoff [percent|off]' })
    return next(e)
  })

  on('command.run', { command: 'handoff' }, async $ => {
    startHandoff($)
    return { text: 'Writing handoff…' }
  })

  on('command.run', { command: 'autohandoff' }, async (_$, e) => {
    const n = Number(e.args.trim())
    if (e.args.trim() === 'off') auto = false
    else {
      auto = true
      if (n >= 10 && n <= 95) threshold = n
    }
    return { text: auto ? `Auto handoff at ${threshold}% context.` : 'Auto handoff off.' }
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const done = await next(e)
    if (handingOff) {
      handingOff = false
      await $.command.run({ command: 'clear', args: '' })
      await $.prompt.fill({ text: `Read ${HANDOFF_FILE} and continue from there.` })
      $.ui.toast('Handoff ready: press Enter to continue in the fresh session.')
    } else {
      await refresh($)
      if (auto && percent >= threshold) startHandoff($)
    }
    return done
  })

  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    if (e.props.hasSurvey || percent === 0) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const high = percent >= threshold
    return (
      <Box>
        <Text color={high ? 'warning' : 'success'}>ctx {percent}% </Text>
        {high && (
          <>
            <Text color="warning">quality may drop  </Text>
            <Button key="h" label="Handoff" hotkey="h" onPress={() => startHandoff($)} />
            <Button key="f" label="Fresh" hotkey="f" onPress={() => void $.command.run({ command: 'clear', args: '' })} />
          </>
        )}
      </Box>
    )
  })
}
