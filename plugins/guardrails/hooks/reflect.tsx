import { band } from './band'
import { below } from './ui'


const START = '<!-- reflect:start -->'
const END = '<!-- reflect:end -->'
const SKIP = /^(ok|okay|yes|no|y|n|continue|go on|thanks|thank you|go|sure|proceed)\W*$/i

const PROMPT = (text: string) =>
  `The user sent this message to a coding assistant. Does it state a reusable, durable preference or correction (a rule to follow in future sessions, e.g. "use pnpm not npm", "never mock the db")? One-off task instructions are NOT rules. Any language. Reply with only JSON: {"rule":"<imperative rule in English>"|null,"scope":"global"|"repo"}.\n\n<message>\n${text}\n</message>`

type Found = { rule: string; scope: 'global' | 'repo'; count: number }

const parse = (text: string): { rule: string; scope: 'global' | 'repo' } | undefined => {
  try {
    const j = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))
    return typeof j.rule === 'string' && j.rule ? { rule: j.rule, scope: j.scope === 'global' ? 'global' : 'repo' } : undefined
  } catch {
    return undefined
  }
}

let queue: Found[] = []
let paused = false

function add($: any, rule: string, scope: Found['scope']) {
  const hit = queue.find(q => q.rule.toLowerCase() === rule.toLowerCase())
  if (hit) hit.count += 1
  else queue = [...queue, { rule, scope, count: 1 }]
  $.ui.invalidate('ui.render')
}

async function save($: any, f: Found, scope: Found['scope']) {
  const path = scope === 'global' ? '~/.claude/CLAUDE.md' : `${await $.session.root()}/CLAUDE.md`
  const file = scope === 'global' ? `${await $.env.get('HOME')}/.claude/CLAUDE.md` : path
  const old: string = (await $.fs.exists(file)) ? await $.fs.read(file) : ''
  const bullet = `- ${f.rule}`
  let next: string
  if (old.includes(START) && old.includes(END)) next = old.replace(END, `${bullet}\n${END}`)
  else next = `${old.trimEnd()}${old ? '\n\n' : ''}## Learned rules\n${START}\n${bullet}\n${END}\n`
  await $.fs.write(file, next)
  queue = queue.filter(q => q !== f)
  $.ui.invalidate('ui.render')
  $.ui.toast(`Saved to ${scope === 'global' ? '~/.claude/CLAUDE.md' : './CLAUDE.md'}`)
}

export async function reflectSessionStart($: any, e: any, next: any) {
  await $.command.register({ name: 'reflect-queue', description: 'List rules reflect found in your prompts' })
  await $.command.register({ name: 'reflect-pause', description: 'Pause or resume reflect' })
  return next(e)
}

export function reflectCommandRunReflectQueue() {
  return { text: queue.length ? queue.map(q => `- ${q.rule} (${q.scope}, x${q.count})`).join('\n') : 'Nothing queued.' }
}

export function reflectCommandRunReflectPause() {
  paused = !paused
  return { text: paused ? 'reflect paused.' : 'reflect resumed.' }
}

export async function reflectPromptSubmit($: any, e: any, next: any) {
  const t = e.text.trim()
  if (e.origin.kind === 'plugin' || paused || t.startsWith('/')) return next(e)

  const explicit = /^remember:\s*(.+)$/is.exec(t)
  if (explicit) add($, explicit[1].trim(), 'repo')
  else if (t.length <= 500 && !SKIP.test(t)) {
    void $.model
      .complete({ model: 'haiku', prompt: PROMPT(t), maxTokens: 150, effort: 'low', timeoutMs: 15_000 })
      .then(r => {
        const found = r.isAnswered ? parse(r.text) : undefined
        if (found) add($, found.rule, found.scope)
      })
  }
  return next(e)
}

export async function reflectUiRenderAbovePrompt($: any, e: any, next: any) {
  if (e.props.hasSurvey || queue.length === 0) return next(e)
  const f = queue[0]
  const other = f.scope === 'global' ? 'repo' : 'global'
  const more = queue.length > 1 ? [`+${queue.length - 1} more`] : []
  return band($.ui.resolve(e), e, await below(next, e), {
    title: 'Rule found',
    tone: 'purple',
    detail: f.rule,
    chips: [f.scope, ...(f.count > 1 ? [`×${f.count}`] : []), ...more],
    buttons: [
      { key: 'save', label: 'Save', onPress: () => save($, f, f.scope) },
      { key: 'other', label: other === 'global' ? 'Global instead' : 'This repo instead', onPress: () => save($, f, other) },
      { key: 'skip', label: 'Skip', plain: true, onPress: () => { queue = queue.filter(q => q !== f); $.ui.invalidate('ui.render') } },
    ],
  })
}
