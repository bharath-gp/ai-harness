// Shared band and pane pieces, so every mod looks the same. Single source: scripts/sync-ui.sh copies it to plugins/*/hooks/band.tsx.
import { bar, chip, dot, fit, hbar, isRich, P, ring, svg, svgWidth, text, tw, type Tone } from './ui'

export type Btn = { key: string; label: string; onPress: () => unknown; hotkey?: string; plain?: boolean }
export type RowBtn = { key: string; label: string; hint?: string; hotkey?: string; onPress: () => unknown }
export type BandSpec = {
  title: string
  tone: Tone
  detail?: string
  pct?: number // 0-100: a ring (ring: true) or a pill bar
  bars?: { pct: number; label: string; tone?: Tone }[] // several pill bars in one band (label inside the pill), instead of pct
  pctLabel?: string // text inside the pill bar, e.g. "Review 3/4"
  ring?: boolean
  busy?: boolean // pulse the dot
  chips?: string[]
  right?: string
  buttons?: Btn[]
  rows?: RowBtn[] // one clickable line each, under the card
  maxW?: number
}

const H = 36
// Button column: as wide as the widest button set in the last pass (never under MIN_ACTION_COLS, so it matches across plugins),
// the same in every band so the buttons line up. A render pass is `beginPass()` ... `endPass()` around the AbovePrompt chain.
const MIN_ACTION_COLS = 13
let actionCols = MIN_ACTION_COLS
let needs: Record<string, number> = {}
const widest = () => Math.max(MIN_ACTION_COLS, ...Object.values(needs))
export const beginPass = () => {
  actionCols = widest()
  needs = {}
}
// true when this pass found a different width: the caller redraws once so every band uses it
export const endPass = () => widest() !== actionCols
const RIGHT_PX = 250 // fixed right region (bar, chips, side text): titles truncate at the same x in every band

// The band above the prompt: one card, same anatomy in every mod. `nested` is `await below(next, e)` (the bands beneath),
// `ui` is `$.ui.resolve(e)`: `$` never crosses an import, so the mod passes both in.
export const band = (ui: any, e: any, nested: unknown, s: BandSpec) => {
  const { Box, Text, Button } = ui
  const color = P[s.tone]
  const bars = s.bars ?? (s.pct !== undefined && !s.ring ? [{ pct: s.pct, label: s.pctLabel ?? '', tone: undefined }] : [])
  const bs = s.buttons ?? []
  needs[s.title] = bs.reduce((n, b) => n + b.label.length + (b.plain ? 1 : 2) + (b.hotkey ? 2 : 0) + 1, 1)
  const ACTION_COLS = actionCols
  const buttons = (s.buttons ?? []).map(b => <Button key={b.key} label={b.label} hotkey={b.hotkey} plain={b.plain} onPress={b.onPress} />)
  const rows = (s.rows ?? []).map(r => (
    <Button key={r.key} plain hotkey={r.hotkey} onPress={r.onPress}>
      <Text color={P.muted}>{r.hotkey ? `${r.hotkey} ` : '› '}</Text>
      <Text>{r.label}</Text>
      <Text color={P.muted}>{r.hint ? `  ${r.hint}` : ''}</Text>
    </Button>
  ))

  if (isRich(ui, e)) {
    const { Svg } = ui
    const W = Math.min(s.maxW ?? 1600, svgWidth(e.props.bodyColumns, ACTION_COLS * 8 + 24)) // every band the same width
    let right = W - 12
    let body = `<rect class="c" x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="9"/>`
    for (const c of [...(s.chips ?? [])].reverse()) {
      const k = chip(0, 9, c, color)
      right -= k.w
      body += chip(right, 9, c, color).svg
      right -= 6
    }
    if (s.right) {
      body += text(right - 2, 22, s.right, { size: 11, cls: 'm', anchor: 'end' })
      right -= tw(s.right, 11) + 14
    }
    const tx = 38
    body += s.ring && s.pct !== undefined ? ring(20, 18, 9, s.pct, color, s.busy) : dot(20, 18, color, s.busy)
    const barW = bars.length > 1 ? 130 : bars.length ? 170 : 0
    const hasRight = Boolean(bars.length || s.chips?.length || s.right)
    const textW = Math.max(120, W - tx - 16 - (hasRight ? RIGHT_PX + Math.max(0, bars.length - 1) * (barW + 56) : 0))
    body += text(tx, s.detail ? 16 : 22, fit(s.title, textW, 13), { size: 13, weight: 600 })
    if (s.detail) body += text(tx, 29, fit(s.detail, textW, 11), { size: 11, cls: 'm' })
    for (const b of [...bars].reverse()) {
      // pill bar with its label inside, as in savvy-progress, then the percent
      const bc = b.tone ? P[b.tone] : color
      const bx = right - barW - 44
      const fillW = Math.max(26, (Math.min(100, b.pct) / 100) * barW)
      body += `<defs><clipPath id="pb${bx}"><rect x="${bx}" y="9" width="${barW}" height="18" rx="9"/></clipPath></defs><rect class="k" x="${bx}" y="9" width="${barW}" height="18" rx="9"/><g clip-path="url(#pb${bx})"><rect${s.busy ? ' class="live"' : ''} x="${bx}" y="9" width="${fillW}" height="18" rx="9" fill="${bc}"/></g>`
      if (b.label) body += text(bx + fillW / 2, 22, fit(b.label, fillW - 8, 11), { size: 11, weight: 700, anchor: 'middle', fill: '#1b1d22' })
      body += text(bx + barW + 8, 22, `${Math.round(b.pct)}%`, { size: 12, cls: 'm' })
      right = bx - 12
    }
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" alignItems="center" gap={1}>
          <Svg source={svg(W, H, body)} alt={[s.title, s.detail].filter(Boolean).join(': ')} width={W} height={H} />
          <Box width={ACTION_COLS} flexDirection="row" alignItems="center" gap={1}>
            {buttons}
          </Box>
        </Box>
        {rows}
        {nested}
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1}>
        <Text color={color} bold>● {s.title}</Text>
        {bars.map(b => (
          <Text key={b.label || 'bar'} color={b.tone ? P[b.tone] : color}>{b.label ? `${b.label} ` : ''}{hbar(b.pct, 10)} {Math.round(b.pct)}%</Text>
        ))}
        {s.detail && <Text color={P.muted}>{s.detail}</Text>}
        {(s.chips ?? []).map(c => (
          <Text key={c} color={color}>[{c}]</Text>
        ))}
        {s.right && <Text color={P.muted}>{s.right}</Text>}
        {buttons}
      </Box>
      {rows}
      {nested}
    </Box>
  )
}

// Pane header: title, a muted subtitle, an optional bar on the right.
export const paneHeader = (ui: any, e: any, o: { title: string; sub?: string; pct?: number; tone?: Tone; right?: string }) => {
  const { Box, Text } = ui
  const color = P[o.tone ?? 'accent']
  if (isRich(ui, e)) {
    const { Svg } = ui
    const W = svgWidth(e.props.bodyColumns, 24)
    let body = text(2, 17, o.title, { size: 15, weight: 600 })
    if (o.sub) body += text(2, 33, fit(o.sub, W - 160, 11.5), { size: 11.5, cls: 'm' })
    if (o.pct !== undefined) body += bar(W - 120, 12, 118, 6, o.pct, color)
    if (o.right) body += text(W - 2, 33, o.right, { size: 11, cls: 'm', anchor: 'end' })
    return <Svg source={svg(W, 40, body)} alt={`${o.title}${o.sub ? `: ${o.sub}` : ''}`} width={W} height={40} />
  }
  return (
    <Box flexDirection="row" gap={1}>
      <Text bold color={color}>{o.title}</Text>
      <Text color={P.muted}>{o.sub ?? ''}</Text>
    </Box>
  )
}

const GLYPH: Record<Tone, string> = { accent: '●', ok: '✓', warn: '◐', err: '✗', info: '●', purple: '●' }

// One card in a pane: status dot, title, muted line, a chip or text on the right, optional bar (undefined pct = sliding).
export const item = (ui: any, e: any, o: { key: string; tone: Tone; title: string; sub?: string; subColor?: string; chip?: string; meta?: string; avatar?: string; pct?: number | 'busy'; busy?: boolean }) => {
  const { Box, Text } = ui
  const color = P[o.tone]
  if (isRich(ui, e)) {
    const { Svg } = ui
    const W = svgWidth(e.props.bodyColumns, 24)
    const rowH = o.pct !== undefined ? 64 : 48
    const ax = o.avatar ? 50 : 0 // room for the avatar tile
    let body = `<rect class="c" x="0.5" y="0.5" width="${W - 1}" height="${rowH - 1}" rx="10"/>`
    if (o.avatar) body += `<rect x="10" y="8" width="34" height="34" rx="10" fill="${color}" fill-opacity=".18"/>` + text(27, 31, o.avatar, { size: 15, weight: 700, anchor: 'middle', fill: color })
    else body += `<rect x="0.5" y="6" width="3.5" height="${rowH - 12}" rx="1.75" fill="${color}"/>${dot(20, 18, color, o.busy)}`
    const tx = o.avatar ? ax + 8 : 32
    let right = W - 14
    if (o.chip) {
      const k = chip(0, 8, o.chip, color)
      right -= k.w
      body += chip(right, 8, o.chip, color).svg
    }
    if (o.meta) body += text(W - 14, 38, o.meta, { size: 10.5, cls: 'm', anchor: 'end' })
    body += text(tx, 22, fit(o.title, right - tx - 8, 13), { size: 13, weight: 600 })
    if (o.sub) body += text(tx, 38, fit(o.sub, W - tx - (o.meta ? tw(o.meta, 10.5) + 30 : 20), 11), { size: 11, ...(o.subColor ? { fill: o.subColor } : { cls: 'm' as const }) })
    if (o.pct !== undefined) body += bar(tx, 50, W - tx - 14, 4, o.pct === 'busy' ? undefined : o.pct, color)
    return <Svg key={o.key} source={svg(W, rowH, body)} alt={`${o.title}${o.sub ? `: ${o.sub}` : ''}`} width={W} height={rowH} />
  }
  return (
    <Box key={o.key} flexDirection="column">
      <Text color={color}>{GLYPH[o.tone]} {o.title}<Text color={P.muted}>{o.chip ? `  ${o.chip}` : ''}</Text></Text>
      <Text color={P.muted}>{o.sub ? `  ${o.sub}` : ''}</Text>
    </Box>
  )
}
