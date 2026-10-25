// Card pieces shared by the pane mods: pills, file badges, folder marks, stat tiles, section labels, text cards.
// Single source: scripts/sync-ui.sh copies it to plugins/*/hooks/kit.tsx. Mono text in theme colours on every surface,
// as claude-flightdeck draws (MIT, see THIRD_PARTY_NOTICES.md). Every piece takes `ui` (= $.ui.resolve(e)) and `e`.
import { C, P } from './ui'

const EXT: Record<string, [string, keyof typeof P]> = {
  js: ['JS', 'warn'], jsx: ['JSX', 'warn'], mjs: ['JS', 'warn'], ts: ['TS', 'info'], tsx: ['TSX', 'info'],
  json: ['JSON', 'warn'], md: ['MD', 'muted'], pdf: ['PDF', 'err'], csv: ['CSV', 'ok'], py: ['PY', 'ok'],
  sh: ['SH', 'accent'], html: ['HTML', 'err'], css: ['CSS', 'purple'], yml: ['YML', 'purple'], yaml: ['YML', 'purple'],
  go: ['GO', 'teal'], rs: ['RS', 'accent'], txt: ['TXT', 'muted'], png: ['PNG', 'teal'], jpg: ['JPG', 'teal'],
  svg: ['SVG', 'teal'], map: ['MAP', 'muted'], lock: ['LOCK', 'muted'], toml: ['TOML', 'accent'],
}

// "client.test.js" -> ["JS", colour]; no extension -> a plain file mark.
export const extBadge = (name: string): [string, string] => {
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : name.startsWith('.') ? name.slice(1).toLowerCase() : ''
  const hit = EXT[ext]
  return hit ? [hit[0], P[hit[1]]] : [ext ? ext.slice(0, 4).toUpperCase() : 'FILE', P.muted]
}

export const fileBadge = (ui: any, _e: any, name: string) => {
  const [label, color] = extBadge(name)
  return <ui.Text color={color}>{`${label.padEnd(4)} `}</ui.Text>
}

export const folderIcon = (ui: any, _e: any, color: string = P.info) => <ui.Text color={color}>{'■ '}</ui.Text>

// A small bracketed tag: "reading", "edited", "committed".
export const pill = (ui: any, _e: any, label: string, color: string) => <ui.Text color={color} bold>{`[${label}]`}</ui.Text>

// A glyph mark, the "RIGHT NOW" / trash icon.
export const iconTile = (ui: any, _e: any, glyph: string, color: string) => <ui.Text color={color} bold>{`${glyph} `}</ui.Text>

// Stat tile: a dim label and a bold value (Cost, Tokens, Time).
export const tile = (ui: any, _e: any, label: string, value: string) => (
  <ui.Text>
    <ui.Text dimColor>{`${label} `}</ui.Text>
    <ui.Text bold>{value}</ui.Text>
  </ui.Text>
)

// "CLAUDE TOUCHED        1 FILE": dim caps label left, dim count right.
export const sectionLabel = (ui: any, left: string, right?: string) => (
  <ui.Box flexDirection="row">
    <ui.Text bold dimColor>{left.toUpperCase()}</ui.Text>
    <ui.Box flexGrow={1} />
    <ui.Text dimColor>{right ? right.toUpperCase() : ''}</ui.Text>
  </ui.Box>
)

// Rounded bordered panel in the faint colour, or the one given.
export const panel = (ui: any, children: unknown, o: { color?: string } = {}) => (
  <ui.Box flexDirection="column" borderStyle="round" borderColor={o.color ?? C.faint} paddingX={1}>
    {children}
  </ui.Box>
)

// A card whose text wraps in full (no truncation): a rounded border in the card's colour, text, an optional dim line and actions.
export const textCard = (ui: any, o: { key: string; color: string; text: string; sub?: string; children?: unknown }) => (
  <ui.Box key={o.key} flexDirection="column" borderStyle="round" borderColor={o.color} paddingX={1}>
    <ui.Text wrap="wrap">{o.text}</ui.Text>
    {o.sub ? <ui.Text wrap="wrap" dimColor>{o.sub}</ui.Text> : null}
    {o.children}
  </ui.Box>
)
