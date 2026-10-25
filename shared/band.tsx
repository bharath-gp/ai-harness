// Shared band and pane pieces, so every mod looks the same: claude-flightdeck's look (MIT, see THIRD_PARTY_NOTICES.md).
// Single source: scripts/sync-ui.sh copies it to plugins/*/hooks/band.tsx. `$` never crosses an import, so every
// piece takes `ui` (= $.ui.resolve(e)) and `e`. Animated pieces (rails, clocks) are drawn in each register.tsx:
// a surface module's path must be a literal in the hooks module itself.
import { C, P, gauge, type Tone } from './ui'

export type Btn = { key: string; label: string; onPress: () => unknown; hotkey?: string; plain?: boolean }
export type RowBtn = { key: string; label: string; hint?: string; hotkey?: string; onPress: () => unknown }
export type BandSpec = {
  title: string
  tone: Tone
  detail?: string
  pct?: number // 0-100: a ▰▱ gauge
  bars?: { pct: number; label: string; tone?: Tone }[] // several gauges in one band, instead of pct
  pctLabel?: string // text before the gauge, e.g. "Review 3/4"
  ring?: boolean // kept for callers: drawn as the same gauge
  busy?: boolean // ◐ instead of ● while live
  chips?: string[]
  right?: string
  buttons?: Btn[]
  rows?: RowBtn[] // one clickable line each, under the band
  maxW?: number
}

// ---- lines of coloured pieces (flightdeck's `line`)
// A Text nesting coloured Texts truncates as one line in a terminal, but the desktop app wraps each nested piece on its
// own and collapses runs of spaces. So pieces sit `gap` cells apart, each keeps its width, and pieces that don't fit in
// `room` are left out from the end; a piece marked `fill` truncates to what the others leave.
export type Span = { text: string; color?: string; dim?: boolean; bold?: boolean }
export type Piece = { spans: Span[]; lead?: number; fill?: boolean; key?: string }
const styleOf = (s: Span) => ({ ...(s.color ? { color: s.color } : {}), ...(s.dim ? { dimColor: true } : {}), ...(s.bold ? { bold: true } : {}) })
const widthOf = (p: Piece) => p.spans.reduce((n, s) => n + [...s.text].length, 0)
export const fits = (pieces: Piece[], room: number, gap: number) => {
  let used = 0
  for (let i = 0; i < pieces.length; i += 1) {
    const next = used + (i > 0 ? gap : 0) + (pieces[i].lead ?? 0) + widthOf(pieces[i])
    if (next > room) return i
    used = next
  }
  return pieces.length
}
export const line = (ui: any, pieces: (Piece | null | false | undefined)[], room: number, gap = 1, justify?: 'center' | 'space-between') => {
  const { Box, Text } = ui
  const all = pieces.filter((p): p is Piece => Boolean(p))
  const shown = all.some(p => p.fill) ? all : all.slice(0, Math.max(1, fits(all, room, gap)))
  return (
    <Box width={Math.max(1, room)} columnGap={gap} overflow="hidden" {...(justify ? { justifyContent: justify } : {})}>
      {shown.map((p, i) => {
        if (p.fill) return <Box key={p.key ?? `p${i}`} flexShrink={1}>{p.spans.length === 1 ? <Text {...styleOf(p.spans[0])} wrap="truncate">{p.spans[0].text}</Text> : <Text wrap="truncate">{p.spans.map(s => <Text {...styleOf(s)}>{s.text}</Text>)}</Text>}</Box>
        return (
          <Box key={p.key ?? `p${i}`} flexShrink={0} {...(p.lead ? { marginLeft: p.lead } : {})}>
            {p.spans.length === 1 ? <Text {...styleOf(p.spans[0])}>{p.spans[0].text}</Text> : <Text>{p.spans.map(s => <Text {...styleOf(s)}>{s.text}</Text>)}</Text>}
          </Box>
        )
      })}
    </Box>
  )
}

// A ▰▱ gauge as spans: coloured fill, faint track, then the percent.
export const gaugeSpans = (pct: number, width: number, color: string, label = ''): Span[] => {
  const g = gauge(pct, width)
  return [...(label ? [{ text: `${label} `, dim: true }] : []), { text: g.on, color }, { text: g.off, color: C.faint }, { text: ` ${Math.round(pct)}%`, bold: true }]
}

// ---- boxes
// A flightdeck panel: rounded border in the role's colour, a "TITLE · state" row with a dim right side, then the body.
export const box = (ui: any, o: { key?: string; color: string; title: string; state?: string; right?: string; w?: number; dim?: boolean; children?: unknown }) => {
  const { Box, Text } = ui
  return (
    <Box key={o.key} flexDirection="column" borderStyle="round" borderColor={o.color} borderDimColor={o.dim} paddingX={1} {...(o.w ? { width: o.w } : {})}>
      <Box justifyContent="space-between">
        <Text color={o.color} bold wrap="truncate">{o.state ? `${o.title} · ${o.state}` : o.title}</Text>
        {o.right ? <Box flexShrink={0}><Text dimColor>{o.right}</Text></Box> : null}
      </Box>
      {o.children}
    </Box>
  )
}

const width = (e: any, maxW?: number) => Math.max(24, Math.min(maxW ?? 400, (e?.props?.bodyColumns ?? e?.viewport?.columns ?? 80) - 1))

// ---- bands above the prompt
// A mod that needs attention: one flightdeck box, same anatomy in every mod. `nested` is `await below(next, e)` (the bands
// beneath), `ui` is `$.ui.resolve(e)`: `$` never crosses an import, so the mod passes both in.
export const band = (ui: any, e: any, nested: unknown, s: BandSpec) => {
  const { Box, Text, Button } = ui
  const color = P[s.tone]
  const W = width(e, s.maxW)
  const bars = s.bars ?? (s.pct !== undefined ? [{ pct: s.pct, label: s.pctLabel ?? '', tone: undefined }] : [])
  const meter = bars.length || s.chips?.length || s.right
  return (
    <Box flexDirection="column">
      <Box flexDirection="column" borderStyle="round" borderColor={color} paddingX={1} width={W}>
        <Box flexDirection="row" alignItems="center" columnGap={1}>
          <Box flexShrink={1} flexGrow={1}>
            {line(ui, [{ spans: [{ text: `${s.busy ? '◐' : '●'} ${s.title}`, color, bold: true }] }, s.detail ? { spans: [{ text: `· ${s.detail}`, dim: true }], fill: true } : null], W - 4 - (s.buttons?.length ?? 0) * 12)}
          </Box>
          {(s.buttons ?? []).map(b => <Button key={b.key} label={b.label} hotkey={b.hotkey} plain={b.plain} onPress={b.onPress} />)}
        </Box>
        {meter
          ? line(
              ui,
              [
                ...bars.map((b, i): Piece => ({ key: `b${i}`, spans: gaugeSpans(b.pct, 10, b.tone ? P[b.tone] : color, b.label) })),
                ...(s.chips ?? []).map((c, i): Piece => ({ key: `c${i}`, spans: [{ text: `· ${c}`, dim: true }] })),
                s.right ? { key: 'r', spans: [{ text: s.right, dim: true }], lead: 1 } : null,
              ],
              W - 4,
              2,
            )
          : null}
        {(s.rows ?? []).map(r => (
          <Button key={r.key} plain hotkey={r.hotkey} onPress={r.onPress}>
            <Text color={color}>{r.hotkey ? '' : '› '}</Text>
            <Text>{r.label}</Text>
            <Text dimColor>{r.hint ? `  ${r.hint}` : ''}</Text>
          </Button>
        ))}
      </Box>
      {nested}
    </Box>
  )
}

// Calm state: a mod adds a short segment to one shared summary line instead of drawing its own band.
export type Seg = { key: string; text: string; tone?: Tone; spec?: BandSpec; more?: BandSpec[]; onPress?: () => unknown }
let segs: Seg[] = []
export const beginPass = () => {
  segs = []
}
// Bands are drawn inner-first, so a new segment goes to the front to keep the outermost mod on the left.
export const quiet = (s: Seg) => {
  segs.unshift(s)
}
export const quietSegs = () => segs

// The one summary line above the prompt, flightdeck's inline "mini" look: NAME · every calm segment · an Open button.
// `nested` is what the bands beneath drew.
export const quietLine = (ui: any, e: any, nested: unknown, o: { name: string; open?: () => unknown; label?: string }) => {
  if (!segs.length) return nested
  const { Box, Text, Button } = ui
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" alignItems="center" columnGap={1} width={width(e)}>
        <Text bold color={C.main}>{o.name}</Text>
        {segs.map(s => {
          const label = <Text color={s.tone ? P[s.tone] : undefined} dimColor={!s.tone}>{`· ${s.text}`}</Text>
          return s.onPress ? <Button key={s.key} plain onPress={s.onPress}>{label}</Button> : <Box key={s.key} flexShrink={0}>{label}</Box>
        })}
        <Box flexGrow={1} />
        {o.open ? <Button key="open" plain label={o.label ?? 'Open'} onPress={o.open} /> : null}
      </Box>
      {nested}
    </Box>
  )
}

// ---- panes
// A pane's header, flightdeck's: "TITLE · state" in the tone's colour, a dim right side or a gauge.
export const paneHeader = (ui: any, e: any, o: { title: string; sub?: string; pct?: number; tone?: Tone; right?: string }) => {
  const color = P[o.tone ?? 'accent']
  const W = width(e)
  return line(
    ui,
    [
      { spans: [{ text: o.title.toUpperCase(), color, bold: true }] },
      o.sub ? { spans: [{ text: `· ${o.sub}`, bold: true }], fill: true } : null,
      o.pct !== undefined ? { spans: gaugeSpans(o.pct, 8, color), lead: 1 } : null,
      o.right ? { spans: [{ text: o.right, dim: true }], lead: 1 } : null,
    ],
    W,
  )
}

const GLYPH: Record<Tone, string> = { accent: '◐', ok: '✓', warn: '◐', err: '✗', info: '●', purple: '●' }

// One row in a pane list: status glyph, title, a dim chip and a right-hand meta; an optional dim line under it.
export const item = (ui: any, e: any, o: { key: string; tone: Tone; title: string; sub?: string; chip?: string; meta?: string; glyph?: string }) => {
  const { Box, Text } = ui
  const color = P[o.tone]
  return (
    <Box key={o.key} flexDirection="column">
      <Box columnGap={1}>
        <Text color={color}>{o.glyph ?? GLYPH[o.tone]}</Text>
        <Box flexShrink={1} flexGrow={1}><Text wrap="truncate">{o.title}</Text></Box>
        {o.chip ? <Box flexShrink={0}><Text color={color}>{o.chip}</Text></Box> : null}
        {o.meta ? <Box flexShrink={0}><Text dimColor>{o.meta}</Text></Box> : null}
      </Box>
      {o.sub ? <Text dimColor wrap="truncate">{`  ${o.sub}`}</Text> : null}
    </Box>
  )
}
