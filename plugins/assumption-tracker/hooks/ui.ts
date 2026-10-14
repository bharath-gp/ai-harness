// Shared drawing kit. Single source: scripts/sync-ui.sh copies it to plugins/*/hooks/ui.ts.
// Desktop draws Svg (animated, themed through prefers-color-scheme); the terminal gets text.

// One palette for every mod (the filetree and savvy-progress look: One Dark accents on a dark surface).
export const P = {
  accent: '#d97757', ok: '#98c379', warn: '#e5c07b', err: '#e06c75', info: '#61afef', purple: '#c084fc', teal: '#2dd4bf',
  muted: '#8b8f98', selection: '#2c313a', hover: '#232831',
}
export type Tone = 'accent' | 'ok' | 'warn' | 'err' | 'info' | 'purple'
export const C = P // svg and text read the same colours
export const T = P

// Shimmer ramps, dim to bright, from claude-code-filetree.
export const RAMP: Record<string, string[]> = {
  orange: ['#f97316', '#fb923c', '#fdba74', '#ffedd5'],
  green: ['#22c55e', '#4ade80', '#86efac', '#dcfce7'],
  purple: ['#a855f7', '#c084fc', '#d8b4fe', '#f3e8ff'],
  blue: ['#3b82f6', '#60a5fa', '#93c5fd', '#dbeafe'],
  red: ['#ef4444', '#f87171', '#fca5a5', '#fee2e2'],
}

export const FONT = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"

const CSS = `<style>
.t{fill:#1f1f1f}.m{fill:#6f6f6f}.k{fill:#e4e4e2}.c{fill:#f4f4f2;stroke:#dcdcd8}
@media (prefers-color-scheme: dark){.t{fill:#ececec}.m{fill:#9a9a9a}.k{fill:#2c2c2c}.c{fill:#262625;stroke:#3a3a38}}
.live{animation:pulse 1.6s ease-in-out infinite}.slide{animation:slide 1.5s linear infinite}
@keyframes pulse{50%{opacity:.3}}@keyframes slide{from{transform:translateX(-45%)}to{transform:translateX(100%)}}
@media (prefers-reduced-motion: reduce){.live,.slide{animation:none}}
</style>`

export const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)

// Rough text width in px: CJK and emoji advance about 1em, the rest about 0.58em.
export const tw = (s: string, size: number) => [...s].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x2e7f ? size : size * 0.58), 0)

export const fit = (s: string, px: number, size: number) => {
  if (tw(s, size) <= px) return s
  let out = ''
  for (const ch of s) {
    if (tw(out + ch + '…', size) > px) break
    out += ch
  }
  return `${out}…`
}

export const fmtTok = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${n}`)
export const fmtCost = (usd: number) => (usd < 0.01 ? '<$0.01' : usd < 10 ? `$${usd.toFixed(2)}` : `$${Math.round(usd)}`)
export const fmtDur = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s` : `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`
}

// Green below `warnAt`, amber below `errAt`, red above (percent scales).
export const zone = (pct: number, warnAt = 60, errAt = 85) => (pct >= errAt ? P.err : pct >= warnAt ? P.warn : P.ok)
export const zoneT = zone
export const zoneTone = (pct: number, warnAt = 60, errAt = 85): Tone => (pct >= errAt ? 'err' : pct >= warnAt ? 'warn' : 'ok')

// ---- terminal text ----
const EIGHTHS = ' ▏▎▍▌▋▊▉█'
export const hbar = (pct: number, width: number) => {
  const cells = (Math.max(0, Math.min(100, pct)) / 100) * width
  const full = Math.floor(cells)
  const part = EIGHTHS[Math.round((cells - full) * 8)] ?? ''
  return ('█'.repeat(full) + (full < width ? part.trim() : '')).padEnd(width, '░').slice(0, width)
}
export const spark = (vs: number[]) => {
  const max = Math.max(...vs, 1)
  return vs.map(v => '▁▂▃▄▅▆▇█'[Math.min(7, Math.floor((v / max) * 7.99))]).join('')
}

// ---- svg ----
let uid = 0
export const svg = (W: number, H: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${CSS}${body}</svg>`

type TextOpts = { size?: number; cls?: 't' | 'm'; weight?: number; anchor?: 'start' | 'middle' | 'end'; fill?: string }
export const text = (x: number, y: number, s: string, o: TextOpts = {}) =>
  `<text x="${x}" y="${y}" ${o.fill ? `fill="${o.fill}"` : `class="${o.cls ?? 't'}"`} text-anchor="${o.anchor ?? 'start'}" font-family="${FONT}" font-size="${o.size ?? 12.5}" font-weight="${o.weight ?? 400}" font-variant-numeric="tabular-nums">${esc(s)}</text>`

// Rounded track with a fill. `pct` undefined = indeterminate (a bar sliding across while live).
export const bar = (x: number, y: number, w: number, h: number, pct: number | undefined, color: string, opts: { live?: boolean; ticks?: number[] } = {}) => {
  const id = `b${++uid}`
  const r = h / 2
  const fill =
    pct === undefined
      ? `<rect class="slide" x="${x}" y="${y}" width="${w * 0.4}" height="${h}" rx="${r}" fill="${color}"/>`
      : `<rect${opts.live ? ' class="live"' : ''} x="${x}" y="${y}" width="${(Math.max(0, Math.min(100, pct)) / 100) * w}" height="${h}" rx="${r}" fill="${color}"/>`
  const ticks = (opts.ticks ?? []).map(p => `<rect x="${x + (p / 100) * w - 0.5}" y="${y - 2}" width="1" height="${h + 4}" class="m" opacity=".6"/>`).join('')
  return `<defs><clipPath id="${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}"/></clipPath></defs><rect class="k" x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}"/><g clip-path="url(#${id})">${fill}</g>${ticks}`
}

export const dot = (cx: number, cy: number, color: string, live = false) => `<circle${live ? ' class="live"' : ''} cx="${cx}" cy="${cy}" r="4" fill="${color}"/>`

// A filled pill with white text; returns its width via `w` so rows can chain chips.
export const chip = (x: number, y: number, s: string, color: string, size = 11) => {
  const w = Math.ceil(tw(s, size)) + 14
  return { w, svg: `<rect x="${x}" y="${y}" width="${w}" height="18" rx="9" fill="${color}"/>${text(x + w / 2, y + 12.5, s, { size, weight: 600, anchor: 'middle', fill: '#fff' })}` }
}

// Ring gauge, `pct` of the circle filled clockwise from the top.
export const ring = (cx: number, cy: number, r: number, pct: number, color: string, live = false) => {
  const c = 2 * Math.PI * r
  const f = (Math.max(0, Math.min(100, pct)) / 100) * c
  return `<circle class="k" cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke-width="4" style="stroke:currentColor;opacity:.15"/><circle${live ? ' class="live"' : ''} cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-dasharray="${f} ${c}" transform="rotate(-90 ${cx} ${cy})"/>`
}

// Svg px width for a band/pane row: about 8px per column, minus room for buttons.
export const svgWidth = (columns: number | undefined, reserve = 96) => Math.max(180, Math.min(1600, (columns || 100) * 8 - reserve))

// The terminal's element table carries an Svg stub that draws nothing: test the surface too.
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

// Static shapes need no theme CSS: skip it, hundreds of rows would carry it each.
export const svgBare = (W: number, H: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}</svg>`
