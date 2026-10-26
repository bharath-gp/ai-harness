# ai-harness

Claude Code mods (needs Claude Code 2.1.287+). Inspired by savvy-progress, claude-code-filetree, cache-tax, claude-reflect and the "9 Claude Code Mods" article. The look, the cockpit pane and its animations follow [claude-flightdeck](https://github.com/scasella/claude-flightdeck) (MIT, see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)).

## Install

```
/plugin marketplace add bharath-gp/ai-harness
/plugin install guardrails@ai-harness
/plugin install cockpit@ai-harness
/plugin install toolbox@ai-harness
```

`toolbox` holds general-purpose skills, not mods. Today: `commit-changes`, which writes a Conventional Commits message (why, not just what) and commits the session's changes, splitting unrelated work and adding ticket refs; `create-pr`, which opens a PR using the repo's template (or a built-in one) with why, what, verification and review focus; and `github-repo-setup`, which sets up or hardens a GitHub repo (new or existing) with branch protection, CI, CodeQL, Dependabot, secret scanning and optional signed commits via `gh`.

The other two plugins are bundles of mods. Every mod is on by default; turn individual mods off in the config menu (each is a boolean `userConfig` field, e.g. `cacheKeeper`) and the plugin reloads. Mods are not sandboxed: read the source first. `cockpit` draws into one side pane, `/cockpit`, docked beside the transcript in fullscreen and an 8-row summary inline otherwise. Both bundles take `palette` (`theme` follows your Claude Code theme, `pastel` uses fixed colours) and `motion` (`off` keeps animations still).

| Bundle | Mod | What it does |
| --- | --- | --- |
| `guardrails` | `blast-radius` | Asks before destructive shell commands run |
| | `secret-sentry` | Blocks API keys and private keys from being written into files |
| | `reflect` | Spots corrections in your prompts and saves them as rules in CLAUDE.md |
| | `assumption-tracker` | Lists the assumptions Claude made and sends fixes for the ones you mark wrong |
| | `self-critique` | /critique panel that reviews Claude's last answer, with one-click fixes |
| | `prompt-coach` | On the first prompt of a session only, rewrites it into a better prompt that makes Claude grill you about the open questions first; `/sharpen` on demand |
| | `merge-sweep` | When a PR you opened in the session is merged, offers to remove its worktree, local branch and remote branch (never forces, keeps anything unsafe) |
| `cockpit` | `agents-progress` | One panel in the cockpit pane: main-session activity and task progress, agents as cards or swimlanes with their current tool, and background shells, monitors and wakeups |
| | `cache-keeper` | Cache countdown in the pane (a band in the last 5 minutes or when cold), /keepwarm pings and a cold-send dialog with cost estimate |
| | `context-health` | Context gauge with compactions and a warning band, /ctx-handoff and /autohandoff |
| | `token-meter` | Session tokens and cost; details: token types, project total, cost per turn, models |
| | `usage-limits` | Session (5h) and weekly (7d) limit gauges with reset countdown and pace, a band from 70% |
| | `filetree` | File tree pane with git status and highlights for files Claude reads and writes |
| | `next-steps` | Suggests three next prompts after each turn |
| | `architect` | The on-call architect: consults on a timeline, their inferred moment and advice |
| | `permission-gate` | One cell per permission check with file/shell/other drill-downs, credentials masked |
| | `loops` | Model loops no agent claims (workflow agents, compactions, forks) |
| | `turn-receipt` | The running turn's clock, or the last turn's duration, agents, edits, errors, cost |
| | `session-log` | Prompts, spawns, completions, consults, edits, errors and denials |

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

Each bundle is `plugins/<bundle>/{.claude-plugin/plugin.json, hooks/hooks.json, hooks/register.tsx}`. `register.tsx` holds every mod as a section of named `function` declarations (the engine follows `$` only into declarations in the same file, which is what the desktop app's bundled CLI requires) and wires them: one `on(...)` per event+matcher (a plugin may not register one twice), chaining the mods that share it and skipping any whose `userConfig` flag is false. To add a mod: add a section to `register.tsx`, add a boolean field to `plugin.json`, and wire its hooks. Edit shared UI only in `shared/` (`ui.ts` palette and formatters, `band.tsx` boxes, bands, lines and pane headers, `kit.tsx` pills, badges and cards, `rail.tsx` / `elapsed.tsx` the animated connector and live clock, surface modules from claude-flightdeck), then run `sync-ui.sh`. Colours are Claude Code theme names, so light and dark themes both read; `palette: pastel` swaps in fixed hex. A surface module's path must be a string literal in the hooks module, so each `register.tsx` draws its rails and clocks itself.

Install `reflect` (in `guardrails`) or the Python claude-reflect plugin, not both.
