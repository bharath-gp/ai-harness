# ai-harness

Claude Code mods (needs Claude Code 2.1.287+). Inspired by savvy-progress, claude-code-filetree, cache-tax, claude-reflect and the "9 Claude Code Mods" article. The look, the cockpit pane and its animations follow [claude-flightdeck](https://github.com/scasella/claude-flightdeck) (MIT, see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)).

## Install

```
/plugin marketplace add bharath-gp/ai-harness
/plugin install guardrails@ai-harness
/plugin install cockpit@ai-harness
/plugin install toolbox@ai-harness
```

`toolbox` holds general-purpose skills, not mods: `commit-changes`, `create-pr`, `github-repo-setup`.

`guardrails` and `cockpit` are bundles of mods, all on by default; turn individual mods off in the config menu (one boolean `userConfig` field each) and the plugin reloads. Mods are not sandboxed: read the source first. `cockpit` draws into one side pane, `/cockpit`. Both take `palette` (`theme` or `pastel`) and `motion` (`off` keeps animations still).

| Bundle | Mods |
| --- | --- |
| `guardrails` | `blast-radius`, `secret-sentry`, `reflect`, `assumption-tracker`, `self-critique`, `prompt-coach`, `merge-sweep`, `decision-gate`, `auto-answer`, `model-picker` |
| `cockpit` | `agents-progress`, `cache-keeper`, `context-health`, `token-meter`, `usage-limits`, `filetree`, `next-steps`, `architect`, `permission-gate`, `loops`, `turn-receipt`, `session-log`, `decisions` |

Mod and skill tables with commands and options: [guardrails](plugins/guardrails/README.md), [cockpit](plugins/cockpit/README.md), [toolbox](plugins/toolbox/README.md).

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

Each bundle is `plugins/<bundle>/{.claude-plugin/plugin.json, hooks/hooks.json, hooks/register.tsx}`. `register.tsx` holds every mod as a section of named `function` declarations (the engine follows `$` only into declarations in the same file, which is what the desktop app's bundled CLI requires) and wires them: one `on(...)` per event+matcher (a plugin may not register one twice), chaining the mods that share it and skipping any whose `userConfig` flag is false. To add a mod: add a section to `register.tsx`, add a boolean field to `plugin.json`, and wire its hooks. Edit shared UI only in `shared/` (`ui.ts` palette and formatters, `band.tsx` boxes, bands, lines and pane headers, `kit.tsx` pills, badges and cards, `rail.tsx` / `elapsed.tsx` the animated connector and live clock, surface modules from claude-flightdeck), then run `sync-ui.sh`. Colours are Claude Code theme names, so light and dark themes both read; `palette: pastel` swaps in fixed hex. A surface module's path must be a string literal in the hooks module, so each `register.tsx` draws its rails and clocks itself.

Install `reflect` (in `guardrails`) or the Python claude-reflect plugin, not both.
