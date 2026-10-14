import type { Register } from 'claude-code'

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

const add = ($: any, rule: string, scope: Found['scope']) => {
  const hit = queue.find(q => q.rule.toLowerCase() === rule.toLowerCase())
  if (hit) hit.count += 1
  else queue = [...queue, { rule, scope, count: 1 }]
  $.ui.invalidate('ui.render')
}

const save = async ($: any, f: Found, scope: Found['scope']) => {
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

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'reflect-queue', description: 'List rules reflect found in your prompts' })
    await $.command.register({ name: 'reflect-pause', description: 'Pause or resume reflect' })
    return next(e)
  })

  on('command.run', { command: 'reflect-queue' }, () => ({
    text: queue.length ? queue.map(q => `- ${q.rule} (${q.scope}, x${q.count})`).join('\n') : 'Nothing queued.',
  }))

  on('command.run', { command: 'reflect-pause' }, () => {
    paused = !paused
    return { text: paused ? 'reflect paused.' : 'reflect resumed.' }
  })

  on('prompt.submit', async ($, e, next) => {
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
  })

  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    if (e.props.hasSurvey || queue.length === 0) return next(e)
    const f = queue[0]
    const other = f.scope === 'global' ? 'repo' : 'global'
    const { Box, Text, Button } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Text color="remember">Rule: {f.rule}{f.count > 1 ? ` ×${f.count}` : ''} ({f.scope})</Text>
        <Box gap={1}>
          <Button key="save" variant="primary" label="Save" onPress={() => save($, f, f.scope)} />
          <Button key="other" label={`Save ${other === 'global' ? 'globally' : 'in this repo'}`} onPress={() => save($, f, other)} />
          <Button key="skip" label="Skip" onPress={() => { queue = queue.filter(q => q !== f); $.ui.invalidate('ui.render') }} />
        </Box>
      </Box>
    )
  })
}
