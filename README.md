# ai-harness

Claude Code mods (needs Claude Code 2.1.287+). Inspired by savvy-progress, claude-code-filetree, cache-tax, claude-reflect and the "9 Claude Code Mods" article.

## Install

```
/plugin marketplace add bharath-gp/ai-harness
/plugin install guardrails@ai-harness
/plugin install cockpit@ai-harness
/plugin install toolbox@ai-harness
```

`toolbox` holds general-purpose skills, not mods. Today: `commit-changes`, which writes a Conventional Commits message (why, not just what) and commits the session's changes, splitting unrelated work and adding ticket refs; `create-pr`, which opens a PR using the repo's template (or a built-in one) with why, what, verification and review focus; and `github-repo-setup`, which sets up or hardens a GitHub repo (new or existing) with branch protection, CI, CodeQL, Dependabot, secret scanning and optional signed commits via `gh`.

The other two plugins are bundles of mods. Every mod is on by default; turn individual mods off in the config menu (each is a boolean `userConfig` field, e.g. `cacheKeeper`) and the plugin reloads. Mods are not sandboxed: read the source first.

| Bundle | Mod | What it does |
| --- | --- | --- |
| `guardrails` | `blast-radius` | Asks before destructive shell commands run |
| | `secret-sentry` | Blocks API keys and private keys from being written into files |
| | `reflect` | Spots corrections in your prompts and saves them as rules in CLAUDE.md |
| | `assumption-tracker` | Lists the assumptions Claude made and sends fixes for the ones you mark wrong |
| | `self-critique` | /critique panel that reviews Claude's last answer, with one-click fixes |
| `cockpit` | `agents-progress` | Live subagent panel and a running-agents band above the prompt |
| | `cache-keeper` | Cache countdown band (shown in the last 5 minutes or when cold), /keepwarm pings and a cold-send dialog with cost estimate |
| | `context-health` | Context fill band with warnings, /ctx-handoff and /autohandoff |
| | `token-meter` | Session token count in the status line; Details: token types, project total, cost, models |
| | `usage-limits` | Always-on band: session (5h) and weekly (7d) limit usage, reset countdown, pace |
| | `filetree` | File tree pane with git status and highlights for files Claude reads and writes |
| | `next-steps` | Suggests three next prompts after each turn |

Per-plugin guides with usage for every mod and skill: [guardrails](plugins/guardrails/README.md), [cockpit](plugins/cockpit/README.md), [toolbox](plugins/toolbox/README.md).

## Other coding agents

The `toolbox` skills are plain `SKILL.md` folders, so the open [`skills`](https://github.com/vercel-labs/skills) installer puts them into Cursor, Codex, Gemini CLI, GitHub Copilot, OpenCode and other agents. Claude Code users keep using `/plugin install` above.

```
npx skills add bharath-gp/ai-harness                 # pick skills and agents interactively
npx skills add bharath-gp/ai-harness --skill github-repo-setup --agent codex cursor -g
```

Only skills install this way; the `guardrails` and `cockpit` mods are Claude Code only.

## License

MIT, see [LICENSE](LICENSE). Security reports: [SECURITY.md](SECURITY.md).

## Develop

```
./scripts/sync-ui.sh                  # copy shared/ into each plugins/<bundle>/hooks/ (commit the copies)
./scripts/dev-sync.sh <mods-folder>   # rsync plugins/ into a hot-reloaded mods folder
claude plugin validate plugins/<bundle>
claude plugin test plugins/<bundle>
claude --plugin-dir plugins/<bundle>
```

Each bundle is `plugins/<bundle>/{.claude-plugin/plugin.json, hooks/hooks.json, hooks/register.tsx}`. `register.tsx` holds every mod as a section of named `function` declarations (the engine follows `$` only into declarations in the same file, which is what the desktop app's bundled CLI requires) and wires them: one `on(...)` per event+matcher (a plugin may not register one twice), chaining the mods that share it and skipping any whose `userConfig` flag is false. To add a mod: add a section to `register.tsx`, add a boolean field to `plugin.json`, and wire its hooks. Edit shared UI only in `shared/` (`ui.ts` palette, `band.tsx` band/pane header/item, `kit.tsx` pills/badges/tiles), then run `sync-ui.sh`. The palette is dark-only for now.

Install `reflect` (in `guardrails`) or the Python claude-reflect plugin, not both.
