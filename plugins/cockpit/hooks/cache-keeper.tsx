import { band } from './band'
import { below, fmtCost, fmtTok, type Tone } from './ui'

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
let tokens = 0
let rates = [4, 0.2]

async function sync($: any) {
  const { context } = await $.session.usage()
  tokens = context.tokens ?? tokens
  rates = price(await $.session.model())
  $.ui.invalidate('ui.render')
}

async function touch($: any) {
  lastTouch = await $.clock.now()
  warnedCold = false
  warnedSoon = false
  await sync($)
}

export async function cacheKeeperSessionStart($: any, e: any, next: any) {
  await $.command.register({ name: 'keepwarm', description: 'Keep the prompt cache warm: /keepwarm [90m|2h|off|status]' })
  await $.command.register({ name: 'cache-tax', description: 'Show prompt cache state and rewrite cost' })
  lastTouch = await $.clock.now()
  void sync($)

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
  await sync($)
  const now = await $.clock.now()
  const left = TTL - (now - lastTouch)
  return {
    text: `cache ${left > 0 ? `warm ${mins(left)} left` : 'cold'} | context ${tokens} tok | cold send ≈ $${((tokens * rates[0]) / 1e6).toFixed(2)} vs warm $${((tokens * rates[1]) / 1e6).toFixed(2)}`,
  }
}

export async function cacheKeeperPromptSubmit($: any, e: any, next: any) {
  const now = await $.clock.now()
  const isSlash = e.text.trimStart().startsWith('/')
  const isCold = lastTouch > 0 && now - lastTouch >= TTL
  if (isCold && !warnedCold && !isSlash && e.origin.kind !== 'plugin') {
    await sync($)
    if (tokens >= MIN_GUARD_TOKENS) {
      warnedCold = true
      return {
        drop: `cache-keeper: the cache went cold ${mins(now - lastTouch - TTL)} ago. Sending rewrites up to ${tokens} tokens ≈ $${((tokens * rates[0]) / 1e6).toFixed(2)} (warm: $${((tokens * rates[1]) / 1e6).toFixed(2)}). Send again to pay it, or /clear.`,
      }
    }
  }
  return next(e)
}

export async function cacheKeeperTurnComplete($: any, e: any, next: any) {
  if (e.agentId === undefined) await touch($)
  return next(e)
}

export async function cacheKeeperUiRenderAbovePrompt($: any, e: any, next: any) {
  if (e.props.hasSurvey || lastTouch === 0) return next(e)
  const now = await $.clock.now()
  const left = TTL - (now - lastTouch)
  if (left >= WARN_BEFORE) return next(e) // only when the cache is about to go cold, or already is
  const warm = left > 0
  const tone: Tone = !warm ? 'err' : left < WARN_BEFORE ? 'warn' : 'ok'
  const keeping = warmUntil > now
  const cold$ = fmtCost((tokens * rates[0]) / 1e6)
  const warm$ = fmtCost((tokens * rates[1]) / 1e6)
  return band($.ui.resolve(e), e, await below(next, e), {
    title: warm ? `Cache warm · ${mins(left)} left` : 'Cache cold',
    tone,
    ring: true,
    pct: warm ? Math.max(0, (left / TTL) * 100) : 100,
    busy: !warm,
    detail: warm ? `${fmtTok(tokens)} ctx · next send ${warm$}` : `${fmtTok(tokens)} ctx · next send rewrites it ${cold$} (warm ${warm$})`,
    chips: keeping ? [`keepwarm ${mins(warmUntil - now)}`] : [],
    right: keeping ? lastPing || 'no ping yet' : undefined,
    buttons: [{ key: 'kw', label: keeping ? 'Stop keepwarm' : 'Keep warm', onPress: () => void $.command.run({ command: 'keepwarm', args: keeping ? 'off' : '' }) }],
  })
}
