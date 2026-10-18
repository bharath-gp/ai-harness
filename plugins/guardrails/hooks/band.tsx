// Shared band and pane pieces, so every mod looks the same. Single source: scripts/sync-ui.sh copies it to plugins/*/hooks/band.tsx.
import { bar, chip, dot, fit, hbar, isRich, P, svg, svgWidth, text, tw, type Tone } from './ui'

export type Btn = { key: string; label: string; onPress: () => unknown; hotkey?: string; plain?: boolean }
export type RowBtn = { key: string; label: string; hint?: string; hotkey?: string; onPress: () => unknown }
export type BandSpec = {
  title: string
  tone: Tone
  detail?: string
  pct?: number // 0-100: a percent (ring: true) or a text bar
  bars?: { pct: number; label: string; tone?: Tone }[] // several text bars in one band, instead of pct
  pctLabel?: string // text before the bar, e.g. "Review 3/4"
  ring?: boolean
  busy?: boolean // unused in text bands
  chips?: string[]
  right?: string
  buttons?: Btn[]
  rows?: RowBtn[] // one clickable line each, under the card
  maxW?: number // unused in text bands
}

// Host colour names, so bands follow the terminal/desktop theme like the rest of the UI.
const HOST: Record<Tone, string> = { accent: 'suggestion', info: 'suggestion', purple: 'suggestion', ok: 'success', warn: 'warning', err: 'error' }

// Calm state: a mod adds a short segment to one shared line instead of drawing its own band. `detail` shows when expanded.
export type Seg = { key: string; text: string; tone?: Tone; detail?: string; onPress?: () => unknown }
let segs: Seg[] = []
export const beginPass = () => {
  segs = []
}
// Bands are drawn inner-first, so a new segment goes to the front to keep the outermost mod on the left.
export const quiet = (s: Seg) => {
  segs.unshift(s)
}

// The one line above the prompt: every calm segment, plus a toggle for their details. `nested` is what the bands beneath drew.
export const quietLine = (ui: any, nested: unknown, expanded: boolean, toggle: () => unknown) => {
  if (!segs.length) return nested
  const { Box, Text, Button } = ui
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" alignItems="center" gap={2}>
        {segs.map(s => {
          const label = <Text color={s.tone ? HOST[s.tone] : undefined} dimColor={!s.tone}>{s.text}</Text>
          return s.onPress ? <Button key={s.key} plain onPress={s.onPress}>{label}</Button> : <Box key={s.key}>{label}</Box>
        })}
        <Box flexGrow={1} />
        <Button key="details" plain label={expanded ? 'Less' : 'Details'} onPress={toggle} />
      </Box>
      {expanded && segs.filter(s => s.detail).map(s => <Box key={`d-${s.key}`}><Text dimColor>{`${s.text}: ${s.detail}`}</Text></Box>)}
      {nested}
    </Box>
  )
}

// A mod that needs attention: one plain text row, same anatomy in every mod. `nested` is `await below(next, e)` (the bands beneath),
// `ui` is `$.ui.resolve(e)`: `$` never crosses an import, so the mod passes both in.
export const band = (ui: any, _e: any, nested: unknown, s: BandSpec) => {
  const { Box, Text, Button } = ui
  const color = HOST[s.tone]
  const bars = s.bars ?? (s.pct !== undefined && !s.ring ? [{ pct: s.pct, label: s.pctLabel ?? '', tone: undefined }] : [])
  const buttons = (s.buttons ?? []).map(b => <Button key={b.key} label={b.label} hotkey={b.hotkey} plain={b.plain} onPress={b.onPress} />)
  const rows = (s.rows ?? []).map(r => (
    <Button key={r.key} plain hotkey={r.hotkey} onPress={r.onPress}>
      <Text dimColor>{r.hotkey ? `${r.hotkey} ` : '› '}</Text>
      <Text>{r.label}</Text>
      <Text dimColor>{r.hint ? `  ${r.hint}` : ''}</Text>
    </Button>
  ))
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" alignItems="center" gap={2}>
        <Text color={color} bold>● {s.title}</Text>
        {s.pct !== undefined && s.ring ? <Text color={color}>{Math.round(s.pct)}%</Text> : null}
        {bars.map(b => (
          <Text key={b.label || 'bar'} color={b.tone ? HOST[b.tone] : color}>{b.label ? `${b.label} ` : ''}{hbar(b.pct, 10)} {Math.round(b.pct)}%</Text>
        ))}
        {s.detail && <Text dimColor>{s.detail}</Text>}
        {(s.chips ?? []).map(c => (
          <Text key={c} color={color}>[{c}]</Text>
        ))}
        {s.right && <Text dimColor>{s.right}</Text>}
        <Box flexGrow={1} />
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
