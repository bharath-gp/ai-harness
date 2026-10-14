import type { Register } from 'claude-code'

const SECRETS: [RegExp, string][] = [
  [/AKIA[0-9A-Z]{16}/, 'AWS access key'],
  [/sk-ant-[A-Za-z0-9_-]{20,}/, 'Anthropic API key'],
  [/sk-[A-Za-z0-9]{32,}/, 'OpenAI-style API key'],
  [/gh[pousr]_[A-Za-z0-9]{36,}/, 'GitHub token'],
  [/xox[abprs]-[A-Za-z0-9-]{10,}/, 'Slack token'],
  [/-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/, 'private key'],
  [/(api[_-]?key|secret|token|passwd|password)["']?\s*[:=]\s*["'][A-Za-z0-9/+_=-]{20,}["']/i, 'hard-coded credential'],
]

// .env files are where secrets belong; example files hold placeholders.
const ALLOWED_PATH = /(^|\/)\.env(\.|$)|\.example$|\.sample$/

const scan = (text: string) => SECRETS.find(([re]) => re.test(text))?.[1]

let blocked = 0

const guard = ($: any, path: string, text: string) => {
  if (ALLOWED_PATH.test(path)) return undefined
  const kind = scan(text)
  if (!kind) return undefined
  blocked += 1
  $.ui.status(`🛡 Secret Sentry · ${blocked} blocked`)
  $.ui.toast(`Secret Sentry blocked a ${kind} in ${path.split('/').pop()}`)
  return { deny: `${$.plugin.name}: refused to write a ${kind} into ${path}. Read it from an env var instead.` }
}

export const register: Register = on => {
  on('tool.call', { tool: 'Write' }, ($, e, next) => guard($, e.file_path, e.content) ?? next(e)).catch(
    ($, e, next) => (next.called ? next(e) : { deny: `${$.plugin.name}: guard failed.` }),
  )

  on('tool.call', { tool: 'Edit' }, ($, e, next) => guard($, e.file_path, e.new_string) ?? next(e)).catch(
    ($, e, next) => (next.called ? next(e) : { deny: `${$.plugin.name}: guard failed.` }),
  )
}
