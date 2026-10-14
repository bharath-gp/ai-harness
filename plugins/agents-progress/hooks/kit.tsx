// Card pieces shared by the pane mods: pills, file badges, folder icons, stat tiles, icon tiles, section labels.
// Single source: scripts/sync-ui.sh copies it to plugins/*/hooks/kit.tsx. `$` never crosses an import, so every
// piece takes `ui` (= $.ui.resolve(e)) and `e`.
import { esc, FONT, isRich, P, svg, svgBare, text, tw } from './ui'

const EXT: Record<string, [string, string]> = {
  js: ['JS', '#e5c07b'], jsx: ['JSX', '#e5c07b'], mjs: ['JS', '#e5c07b'], ts: ['TS', '#61afef'], tsx: ['TSX', '#61afef'],
  json: ['JSON', '#e5c07b'], md: ['MD', '#8aa0b8'], pdf: ['PDF', '#e06c75'], csv: ['CSV', '#98c379'], py: ['PY', '#98c379'],
  sh: ['SH', '#d19a66'], html: ['HTML', '#e06c75'], css: ['CSS', '#c678dd'], yml: ['YML', '#c678dd'], yaml: ['YML', '#c678dd'],
  go: ['GO', '#56b6c2'], rs: ['RS', '#d19a66'], txt: ['TXT', P.muted], png: ['PNG', '#56b6c2'], jpg: ['JPG', '#56b6c2'],
  svg: ['SVG', '#56b6c2'], map: ['MAP', P.muted], lock: ['LOCK', P.muted], toml: ['TOML', '#d19a66'],
}

// "client.test.js" -> ["JS", colour]; no extension -> a plain file mark.
export const extBadge = (name: string): [string, string] => {
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : name.startsWith('.') ? name.slice(1).toLowerCase() : ''
  return EXT[ext] ?? [ext ? ext.slice(0, 4).toUpperCase() : 'FILE', P.muted]
}

const badgeCache = new Map<string, string>()
const badgeSvg = (label: string, color: string) => {
  const k = `${label}${color}`
  let s = badgeCache.get(k)
  if (!s) {
    const W = Math.max(24, Math.ceil(tw(label, 8.5)) + 10)
    s = svgBare(W, 16, `<rect x="0.5" y="0.5" width="${W - 1}" height="15" rx="4" fill="${color}" fill-opacity=".16" stroke="${color}" stroke-opacity=".45"/>${text(W / 2, 11.5, label, { size: 8.5, weight: 700, anchor: 'middle', fill: color })}`)
    badgeCache.set(k, s)
  }
  return { s, W: Math.max(24, Math.ceil(tw(label, 8.5)) + 10) }
}

export const fileBadge = (ui: any, e: any, name: string) => {
  const [label, color] = extBadge(name)
  if (!isRich(ui, e)) return <ui.Text color={color}>{`${label} `}</ui.Text>
  const b = badgeSvg(label, color)
  return <ui.Svg source={b.s} alt={label} width={b.W} height={16} />
}

const FOLDER = (color: string) => svgBare(18, 16, `<path d="M1.5 3.5h5l1.6 1.8h8.4v8.2a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1z" fill="none" stroke="${color}" stroke-width="1.4" stroke-linejoin="round"/>`)
export const folderIcon = (ui: any, e: any, color: string = '#61afef') =>
  isRich(ui, e) ? <ui.Svg source={FOLDER(color)} alt="folder" width={18} height={16} /> : <ui.Text color={color}>{'■ '}</ui.Text>

// A small outlined pill: "Reading", "Edited", "committed".
export const pill = (ui: any, e: any, label: string, color: string) => {
  if (!isRich(ui, e)) return <ui.Text color={color} bold>{` ${label} `}</ui.Text>
  const W = Math.ceil(tw(label, 11)) + 20
  const body = `<rect x="0.5" y="0.5" width="${W - 1}" height="21" rx="11" fill="${color}" fill-opacity=".16" stroke="${color}" stroke-opacity=".35"/>${text(W / 2, 15, label, { size: 11, weight: 700, anchor: 'middle', fill: color })}`
  return <ui.Svg source={svgBare(W, 22, body)} alt={label} width={W} height={22} />
}

// Rounded tile with a glyph, the "RIGHT NOW" / trash icon.
export const iconTile = (ui: any, e: any, glyph: string, color: string, size = 48) => {
  if (!isRich(ui, e)) return <ui.Text color={color} bold>{`${glyph} `}</ui.Text>
  const body = `<rect width="${size}" height="${size}" rx="${size * 0.3}" fill="${color}" fill-opacity=".16"/><text x="${size / 2}" y="${size * 0.65}" text-anchor="middle" font-family="${FONT}" font-size="${size * 0.46}" fill="${color}">${esc(glyph)}</text>`
  return <ui.Svg source={svgBare(size, size, body)} alt="" width={size} height={size} />
}

// Stat tile: a muted label over a bold value (Cost, Tokens, Time). Themed, so it uses the CSS-carrying svg().
export const tile = (ui: any, e: any, label: string, value: string, W = 118) => {
  if (!isRich(ui, e)) return <ui.Text>{`${label} `}<ui.Text bold>{value}</ui.Text></ui.Text>
  const body = `<rect class="c" x="0.5" y="0.5" width="${W - 1}" height="45" rx="9"/>${text(12, 18, label, { size: 11, cls: 'm' })}${text(12, 37, value, { size: 15, weight: 700 })}`
  return <ui.Svg source={svg(W, 46, body)} alt={`${label} ${value}`} width={W} height={46} />
}

// "CLAUDE TOUCHED        1 FILE": small caps label left, muted count right.
export const sectionLabel = (ui: any, left: string, right?: string) => (
  <ui.Box flexDirection="row">
    <ui.Text bold color={P.muted}>{left.toUpperCase()}</ui.Text>
    <ui.Box flexGrow={1} />
    <ui.Text bold color={P.muted}>{right ? right.toUpperCase() : ''}</ui.Text>
  </ui.Box>
)

// Rounded bordered panel.
export const panel = (ui: any, children: unknown, o: { color?: string; bg?: string } = {}) => (
  <ui.Box flexDirection="column" borderStyle="round" borderColor={o.color ?? '#30343c'} backgroundColor={o.bg} paddingX={1}>
    {children}
  </ui.Box>
)

// A card whose text wraps in full (no truncation): a coloured stripe on the left, text, optional muted line and actions.
export const textCard = (ui: any, o: { key: string; color: string; text: string; sub?: string; children?: unknown }) => (
  <ui.Box key={o.key} flexDirection="row" borderStyle="round" borderColor="#30343c" backgroundColor="#212226">
    <ui.Box width={1} backgroundColor={o.color} />
    <ui.Box flexDirection="column" paddingX={1} flexGrow={1} flexShrink={1}>
      <ui.Text wrap="wrap">{o.text}</ui.Text>
      {o.sub ? <ui.Text wrap="wrap" color={P.muted}>{o.sub}</ui.Text> : null}
      {o.children}
    </ui.Box>
  </ui.Box>
)
