import type { Register } from 'claude-code'

// Destructive shell patterns worth a human look.
const RISKY: [RegExp, string][] = [
  [/\brm\s+(-[a-zA-Z]*[rf][a-zA-Z]*\s+)+/, 'deletes files or folders'],
  [/\bgit\s+push\b[^\n;&|]*(--force\b|--force-with-lease\b|\s-f\b)/, 'force-pushes'],
  [/\bgit\s+reset\s+--hard\b/, 'discards uncommitted changes'],
  [/\bgit\s+clean\s+-[a-zA-Z]*f/, 'deletes untracked files'],
  [/\bgit\s+(checkout|restore)\s+(--\s+)?\.(\s|$)/, 'throws away working-tree edits'],
  [/\bgit\s+branch\s+-D\b/, 'force-deletes a branch'],
  [/\b(mkfs|dd\s+if=)/, 'writes raw to a device'],
  [/\bfind\b[^\n]*\s-delete\b/, 'deletes files via find'],
  [/\bDROP\s+(TABLE|DATABASE)\b/i, 'drops a database object'],
]

export const register: Register = on => {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const hit = RISKY.find(([re]) => re.test(e.command))
    if (!hit) return next(e)

    const answer = await $.ui.ask(
      `Blast Radius: this command ${hit[1]}:\n${e.command.slice(0, 300)}\nProceed?`,
      ['Proceed', 'Cancel'],
    )

    return answer === 'Proceed'
      ? next(e)
      : { deny: `${$.plugin.name}: user cancelled (${hit[1]}).` }
  }).catch(($, e, next) =>
    // ask rejects when nobody can answer (-p run): refuse rather than run it
    next.called ? next(e) : { deny: `${$.plugin.name}: could not confirm a destructive command.` },
  )
}
