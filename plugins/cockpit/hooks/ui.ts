// Shared drawing kit. Single source: scripts/sync-ui.sh copies it to plugins/*/hooks/ui.ts.
// The look follows claude-flightdeck (MIT, see THIRD_PARTY_NOTICES.md): mono text in rounded, role-coloured boxes,
// ▰▱ gauges, colours named after the person's Claude Code theme so light, dark and colour-blind themes all read.

// Roles, as flightdeck names them: main (Claude's own), agent, gate, cleared, arch(itect), amber, warn, dim, faint, text.
type Role = 'main' | 'agent' | 'gate' | 'cleared' | 'arch' | 'amber' | 'warn' | 'dim' | 'faint' | 'text'
const THEME: Record<Role, string> = {
  main: 'claude', agent: 'suggestion', gate: 'success', cleared: 'permission', arch: 'merged',
  amber: 'warning', warn: 'error', dim: 'inactive', faint: 'subtle', text: 'text',
}
// Fixed hex tuned for dark terminals: the `palette: pastel` option.
const PASTEL: Record<Role, string> = {
  main: '#7dd3fc', agent: '#93c5fd', gate: '#86efac', cleared: '#5eead4', arch: '#c4b5fd',
  amber: '#fcd34d', warn: '#fca5a5', dim: '#6b7280', faint: '#3f4654', text: '#e5e7eb',
}

// The live palette every mod reads. `usePalette` swaps it in place at register time, so imports stay valid.
export const C: Record<Role, string> = { ...THEME }
export type Tone = 'accent' | 'ok' | 'warn' | 'err' | 'info' | 'purple'
// A mod's tone, as a role colour: accent is Claude's own, info an agent's, purple the architect's.
export const P: Record<Tone | 'teal' | 'muted' | 'faint' | 'text', string> = { ...toneColors() }
// Motion and palette options, set once per load by the bundle's register.
export const DECK = { motion: true, palette: 'theme' as 'theme' | 'pastel' }

function toneColors() {
  return { accent: C.main, ok: C.gate, warn: C.amber, err: C.warn, info: C.agent, purple: C.arch, teal: C.cleared, muted: C.dim, faint: C.faint, text: C.text }
}

export const usePalette = (palette: unknown, motion: unknown) => {
  DECK.palette = palette === 'pastel' ? 'pastel' : 'theme'
  DECK.motion = motion !== 'off'
  Object.assign(C, DECK.palette === 'pastel' ? PASTEL : THEME)
  Object.assign(P, toneColors())
}

// SVG cannot name theme keys: mid-tone colours that read on light and dark backgrounds (the desktop time axis).
export const SVG_COLORS = { running: '#3b82f6', done: '#16a34a', failed: '#dc2626', other: '#8b5cf6', label: '#6b7280' }
export const MONO = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace"

export const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)

export const fmtTok = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${n}`)
export const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB` : `${(n / 1048576).toFixed(1)} MB`)

// `git status --porcelain -z` output (no header) -> rows. A rename or copy carries its old path as an extra field: skipped.
export const parsePorcelain = (out: string) => {
  const parts = out.split('\0')
  const rows: { st: string; path: string }[] = []
  for (let i = 0; i < parts.length; i++) {
    const l = parts[i]
    if (l.length < 4) continue
    rows.push({ st: l.slice(0, 2), path: l.slice(3) })
    if (/[RC]/.test(l.slice(0, 2))) i++
  }
  return rows
}

export const fmtCost = (usd: number) => (usd < 0.01 ? '<$0.01' : usd < 10 ? `$${usd.toFixed(2)}` : `$${Math.round(usd)}`)
export const fmtDur = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s` : `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`
}
// A running clock as flightdeck's cards draw it: m:ss, or XhYY past an hour.
export const fmtTimer = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}:${String(s % 60).padStart(2, '0')}` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
}
export const fmtClock = (ms: number) => (ms > 0 ? new Date(ms).toTimeString().slice(0, 8) : '--:--:--')
export const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
export const shorten = (s: string, n: number) => {
  const one = s.replace(/\s+/g, ' ').trim()
  return n <= 0 ? '' : one.length > n ? `${one.slice(0, Math.max(0, n - 1)).trimEnd()}…` : one
}

// Green below `warnAt`, amber below `errAt`, red above (percent scales).
export const zone = (pct: number, warnAt = 60, errAt = 85) => (pct >= errAt ? C.warn : pct >= warnAt ? C.amber : C.gate)
export const zoneTone = (pct: number, warnAt = 60, errAt = 85): Tone => (pct >= errAt ? 'err' : pct >= warnAt ? 'warn' : 'ok')

// A gauge of `width` cells: ▰ filled, ▱ empty.
export const gauge = (pct: number, width: number) => {
  const full = Math.max(0, Math.min(width, Math.round((pct / 100) * width)))
  return { on: '▰'.repeat(full), off: '▱'.repeat(width - full) }
}

// "claude-opus-5-5[1m]" -> "Opus 5.5 1M"; anything else as given, cut to 22.
export const prettyModel = (id: string) => {
  if (!id) return '—'
  const cap = (f: string) => f.charAt(0).toUpperCase() + f.slice(1)
  const big = /\[1m\]|-1m\b/i.test(id) ? ' 1M' : ''
  const now = /claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(?![\d])/i.exec(id)
  if (now?.[1] && !/^\d/.test(now[1])) return `${cap(now[1].toLowerCase())} ${now[2]}${now[3] ? `.${now[3]}` : ''}${big}`
  const old = /claude-(\d+)(?:-(\d))?-([a-z]+)/i.exec(id)
  if (old?.[3]) return `${cap(old[3].toLowerCase())} ${old[1]}${old[2] ? `.${old[2]}` : ''}${big}`
  return shorten(id, 22)
}

// The desktop and mobile draw Svg; the terminal's element table carries a stub that draws nothing: test the surface too.
export const isRich = (ui: object, e: { surface: string }) => e.surface !== 'terminal' && 'Svg' in ui

// AbovePrompt is one strip shared by every mod: a hook that returns a tree hides the mods beneath it
// unless it nests what `next(e)` drew. Call this first, put the result in your column. Claude Code's
// own placeholder ({ type: 'engine' }) is never nested: the desktop drops a band that nests it.
export const below = async (next: (e: any) => unknown, e: unknown) => {
  const drawn = await Promise.resolve(next(e)).catch(() => null)
  return drawn && typeof drawn === 'object' && (drawn as { type?: string }).type !== 'engine' ? drawn : null
}

// Age in a few characters, as the filetree draws it: now, 12m, 3h, 5d.
export const age = (ms: number) => {
  const m = Math.floor(ms / 60_000)
  return m < 1 ? 'now' : m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`
}

// Credentials in a command or URL, masked before a line is shown or handed to a local decision model.
const SECRET_PATTERNS: [RegExp, string][] = [
  [/(authorization\s*[:=]\s*)(bearer\s+|basic\s+)?\S+/gi, '$1$2•••'],
  [/\b(bearer)\s+[A-Za-z0-9._~+/-]{8,}=*/gi, '$1 •••'],
  [/\b(sk|pk|rk|ghp|gho|ghs|github_pat|xox[abprs])[-_][A-Za-z0-9_-]{8,}/g, '•••'],
  [/((?:api[_-]?key|access[_-]?token|token|secret|password|passwd|pwd)\s*[=:]\s*)("[^"]*"|'[^']*'|\S+)/gi, '$1•••'],
  [/(--(?:token|password|api-key|secret)[= ])\S+/gi, '$1•••'],
  [/(\b[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)=)\S+/g, '$1•••'],
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:)[^\s@]+@/gi, '$1•••@'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '•••'],
  [/((?:^|\s)(?:-u|--user)[\s=]+['"]?[^\s:'"]+:)[^\s'"]+/g, '$1•••'],
]
export const maskSecrets = (s: string) => SECRET_PATTERNS.reduce((t, [re, to]) => t.replace(re, to), s)
