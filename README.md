# ai-harness

Claude Code mods (needs Claude Code 2.1.287+). Inspired by savvy-progress, claude-code-filetree, cache-tax, claude-reflect and the "9 Claude Code Mods" article.

## Install

```
/plugin marketplace add bharath-gp/ai-harness
/plugin install cache-keeper@ai-harness
```

Install only what you want; install the same line on any machine. Mods are not sandboxed: read the source first.

| Mod | What it does |
| --- | --- |
| `agents-progress` | Live subagent panel and a running-agents band above the prompt |
| `assumption-tracker` | Lists the assumptions Claude made and sends fixes for the ones you mark wrong |
| `blast-radius` | Asks before destructive shell commands run |
| `cache-keeper` | Cache countdown band (shown in the last 5 minutes or when cold), /keepwarm pings and a cold-send guard with cost estimate |
| `context-health` | Context fill band with warnings, /handoff and /autohandoff |
| `filetree` | File tree pane with git status and highlights for files Claude reads and writes |
| `next-steps` | Suggests three next prompts after each turn |
| `reflect` | Spots corrections in your prompts and saves them as rules in CLAUDE.md |
| `secret-sentry` | Blocks API keys and private keys from being written into files |
| `self-critique` | /critique panel that reviews Claude's last answer, with one-click fixes |

## Develop

```
./scripts/sync-ui.sh                  # copy shared/ into each plugins/<mod>/hooks/ (commit the copies)
./scripts/dev-sync.sh <mods-folder>   # rsync plugins/ into a hot-reloaded mods folder
claude plugin validate plugins/<mod>
claude plugin test plugins/<mod>      # blast-radius, secret-sentry, cache-keeper, assumption-tracker, self-critique, agents-progress
claude --plugin-dir plugins/<mod>
```

Each mod is `plugins/<mod>/{.claude-plugin/plugin.json, hooks/hooks.json, hooks/register.tsx}`. Edit shared UI only in `shared/` (`ui.ts` palette, `band.tsx` band/pane header/item, `kit.tsx` pills/badges/tiles), then run `sync-ui.sh`. The palette is dark-only for now.

Install `reflect` or the Python claude-reflect plugin, not both.
