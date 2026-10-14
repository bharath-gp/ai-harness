import type { Register } from 'claude-code'

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

const touch = async ($: any) => {
  lastTouch = await $.clock.now()
  warnedCold = false
  warnedSoon = false
  $.ui.invalidate('ui.render')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'keepwarm', description: 'Keep the prompt cache warm: /keepwarm [90m|2h|off|status]' })
    await $.command.register({ name: 'cache-tax', description: 'Show prompt cache state and rewrite cost' })
    lastTouch = await $.clock.now()

    $.clock.every(60_000, async () => {
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
          lastPing = `read ${r.usage.cache_read_input_tokens} tok`
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
  })

  on('command.run', { command: 'keepwarm' }, async ($, e) => {
    const now = await $.clock.now()
    const arg = e.args.trim()
    if (arg === 'off') {
      warmUntil = 0
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
  })

  on('command.run', { command: 'cache-tax' }, async $ => {
    const now = await $.clock.now()
    const { context } = await $.session.usage()
    const [w, r] = price(await $.session.model())
    const tok = context.tokens ?? 0
    const left = TTL - (now - lastTouch)
    return {
      text: `cache ${left > 0 ? `warm ${mins(left)} left` : 'cold'} | context ${tok} tok | cold send ≈ $${((tok * w) / 1e6).toFixed(2)} vs warm $${((tok * r) / 1e6).toFixed(2)}`,
    }
  })

  on('prompt.submit', async ($, e, next) => {
    const now = await $.clock.now()
    const isSlash = e.text.trimStart().startsWith('/')
    const isCold = lastTouch > 0 && now - lastTouch >= TTL
    if (isCold && !warnedCold && !isSlash && e.origin.kind !== 'plugin') {
      const { context } = await $.session.usage()
      const tok = context.tokens ?? 0
      if (tok >= MIN_GUARD_TOKENS) {
        const [w, r] = price(await $.session.model())
        warnedCold = true
        return {
          drop: `cache-keeper: the cache went cold ${mins(now - lastTouch - TTL)} ago. Sending rewrites up to ${tok} tokens ≈ $${((tok * w) / 1e6).toFixed(2)} (warm: $${((tok * r) / 1e6).toFixed(2)}). Send again to pay it, or /clear.`,
        }
      }
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) await touch($)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || lastTouch === 0) return next(e)
    const now = await $.clock.now()
    const left = TTL - (now - lastTouch)
    const { Box, Text } = $.ui.resolve(e)
    const warm = left > 0
    return (
      <Box>
        <Text color={warm ? 'success' : 'warning'} bold>◆ cache </Text>
        <Text color={warm ? 'success' : 'warning'}>{warm ? `warm ${mins(left)}` : 'cold'}</Text>
        {warmUntil > now && <Text dimColor>  keepwarm {mins(warmUntil - now)}{lastPing && ` · ${lastPing}`}</Text>}
      </Box>
    )
  })
}
