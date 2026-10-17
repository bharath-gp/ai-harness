# guardrails

Safety and review of Claude's output. Five mods that stop damage before it happens, catch leaks, learn your preferences, and make Claude's answers easy to audit. Needs Claude Code 2.1.287+.

```
/plugin marketplace add bharath-gp/ai-harness
/plugin install guardrails@ai-harness
```

Every mod is on by default. Turn one off in the plugin config menu (boolean fields `blastRadius`, `secretSentry`, `reflect`, `assumptionTracker`, `selfCritique`); the plugin reloads. Mods are not sandboxed: read `hooks/register.tsx` first.

| Mod | Trigger | Commands |
| --- | --- | --- |
| [blast-radius](#blast-radius) | `Bash` tool call | none |
| [secret-sentry](#secret-sentry) | `Write` and `Edit` tool calls | none |
| [reflect](#reflect) | every prompt you send | `/reflect-queue`, `/reflect-pause` |
| [assumption-tracker](#assumption-tracker) | end of each turn | `/assumptions` |
| [self-critique](#self-critique) | on demand, or each turn | `/critique` |

## blast-radius

Holds destructive shell commands until you confirm, and shows what they would hit.

**Matches:** `rm -r/-f`, `git push --force` / `--force-with-lease` / `-f`, `git reset --hard`, `git clean -f`, `git checkout .` / `git restore .`, `git branch -D`, `mkfs` / `dd if=`, `find ... -delete`, `DROP TABLE` / `DROP DATABASE`.

**Use:** nothing to do. When Claude runs one of these, an impact card appears above a Proceed/Cancel dialog: the files affected (for `rm`, the targets; for discards, everything uncommitted), their total size, and how many are untracked and so unrecoverable from git. Pick the proceed option (`Delete N files`, `Discard N files`, `Proceed`) or `Cancel`. Cancel denies the call and Claude is told you declined.

**Limits:** `rm` targets are parsed plainly (no globs or quoting tricks); scanning stops at 3000 files. In non-interactive runs (`-p`) nobody can answer, so the command is refused.

## secret-sentry

Blocks Claude from writing credentials into files.

**Detects:** AWS access keys, Anthropic and OpenAI-style API keys, GitHub tokens, Slack tokens, PEM private keys, and hard-coded `api_key` / `secret` / `token` / `password` assignments with long string values.

**Use:** nothing to do. A matching `Write` or `Edit` is denied with a message telling Claude to read the value from an env var; a toast and a status-line counter (`🛡 Secret Sentry · N blocked`) tell you it fired. `.env`, `.env.*`, `*.example` and `*.sample` files are exempt, since that is where secrets belong or placeholders live.

**Limits:** it checks file writes only, not shell commands or what Claude prints.

## reflect

Turns your corrections into permanent rules.

**Use:** just work normally. Each prompt (up to 500 characters, excluding slash commands and replies like "ok") is classified by Haiku: if it states a durable preference ("use pnpm not npm", "never mock the db") a **Rule found** band appears above the prompt with the rule and its scope.

- `Save` writes it to the suggested scope.
- `Global instead` / `This repo instead` writes it to the other scope.
- `Skip` discards it.

Repo rules go to `./CLAUDE.md`, global rules to `~/.claude/CLAUDE.md`, both under a `## Learned rules` section between `reflect:start` / `reflect:end` markers. Prefix a prompt with `remember: ...` to queue a rule explicitly, with no classification.

**Commands:** `/reflect-queue` lists pending rules with scope and repeat count; `/reflect-pause` toggles detection off and on.

Do not run this alongside the Python claude-reflect plugin.

## assumption-tracker

Surfaces what Claude decided without asking.

**Use:** after each answer, Haiku lists up to 8 assumptions Claude made that you did not specify (defaults, resolved ambiguities, scope calls). A band says "Claude made N assumptions"; press `Review` (hotkey `0`) or run `/assumptions` to open the panel. Mark each **Right** or **Wrong**. When any are wrong, `Fix N wrong` sends Claude a prompt to redo only the parts that depend on them, while keeping the ones you marked right. `×` on the band dismisses the list.

## self-critique

A second opinion on Claude's last answer.

**Use:** run `/critique` to open a panel with a verdict (strong, mixed or weak), strengths, and flaws. Each flaw has a `Make this fix` button that sends Claude a prompt to repair it. Panel buttons: `Rerun`, `Auto on/off` (critique every answer automatically) and `Model` (cycles `session`, `opus`, `sonnet`, `haiku`).

**Arguments:** `/critique auto` toggles auto-critique; `/critique opus|sonnet|haiku|session` picks the reviewing model, then critiques.

## Develop

Source: `hooks/register.tsx`, one `// ===== <mod> =====` section per mod, wired in the `register` function at the bottom. Shared UI is copied from `shared/` by `./scripts/sync-ui.sh`.

```
claude plugin validate plugins/guardrails
claude plugin test plugins/guardrails
```
