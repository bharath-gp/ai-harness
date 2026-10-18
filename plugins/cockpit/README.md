# cockpit

Live panes and bands for session awareness. Six mods that show what your agents are doing, what your cache and context cost, where your plan limits stand, and which files are changing. Needs Claude Code 2.1.287+.

```
/plugin marketplace add bharath-gp/ai-harness
/plugin install cockpit@ai-harness
```

Every mod is on by default. Turn one off in the plugin config menu (boolean fields `agentsProgress`, `cacheKeeper`, `contextHealth`, `filetree`, `nextSteps`, `usageLimits`); the plugin reloads. Mods are not sandboxed: read `hooks/register.tsx` first.

Bands stack in the strip above the prompt; panes open beside the conversation.

| Mod | Shows | Commands |
| --- | --- | --- |
| [agents-progress](#agents-progress) | subagent panel, running-agents band, todo band | `/agents-info` |
| [cache-keeper](#cache-keeper) | cache countdown, cold-send dialog | `/keepwarm`, `/cache-tax` |
| [context-health](#context-health) | context fill band | `/ctx-handoff`, `/autohandoff` |
| [usage-limits](#usage-limits) | 5h and 7d plan limits | none |
| [filetree](#filetree) | file tree pane with git and activity | `/filetree` |
| [next-steps](#next-steps) | three suggested prompts | none |

## agents-progress

Watch subagents and your main task list.

**Use:** while subagents run, a band above the prompt shows how many are running and the main session's todo/task progress. `/agents-info` opens the **Agents** panel: every spawned subagent (last 50) with type, description, model, elapsed time, status (running, done, failed), plus session cost, context tokens and tool-call counts. Each subagent type gets a stable colour. The panel can hide finished agents.

## cache-keeper

Keeps you from silently paying to rewrite a cold prompt cache.

The cache lives 1 hour. In its last 5 minutes, or once cold, a band shows time left, context size and the cost of the next send (warm vs cold).

**Use:**
- `/keepwarm 90m` (or `2h`, `2h30m`) sends cheap cache-read pings starting 50 minutes after your last turn, for the window you give. It stops itself if a ping shows the cache was already cold. `/keepwarm off` stops; `/keepwarm status` reports what is armed and the last ping. The band also has a `Keep warm` / `Stop keepwarm` button.
- `/cache-tax` prints cache state, context tokens and cold vs warm send cost.
- **Cold-send dialog:** the first prompt after the cache went cold opens a dialog with the estimated rewrite cost. `Continue here` sends it anyway; `New session` clears and drops the prompt (send it again). Dismissing the dialog drops the prompt.
- A toast warns when the cache will go cold in under 5 minutes.

Pings are reads, not free: they cost tokens.

## context-health

Tracks how full the context window is.

**Use:** a band shows `Context N%` with turn count, speed, cost and the plan limit percentages, and warns as it fills. Buttons: `Handoff` (hotkey `h`), `Fresh` (`f`, runs `/clear`), and `×` to hide the band.

- `/ctx-handoff` has Claude write a handoff brief to `.claude/handoff.md`, clears the context (only if the turn finished and the file exists; otherwise the context is kept), then pre-fills a prompt to read it and continue. Review before sending.
- `/autohandoff 60` triggers the same handoff automatically at 60% context (accepts 10 to 95; default 50). `/autohandoff off` disables it.

## usage-limits

An always-on band for your plan limits.

**Shows:** session (5h) and weekly (7d) usage as bars, the time until each resets, and pace, which is how far ahead of or behind an even burn rate you are. Colours move to warning at 70% and critical at 90%. A toast fires once per window when it crosses 90%, and re-arms after usage drops back under.

No commands. Appears only when the account reports limits.

## filetree

A file tree pane with git status and live agent activity.

**Use:** `/filetree` (or the `Open file tree` button on the band) opens the pane for the session's folder. It shows:
- Git status per file (modified, added, untracked, deleted, renamed) with +/- line counts, plus branch, upstream and ahead/behind.
- Colour highlights for files Claude touches: purple for reading and opened, orange for editing and edited, green for committed. Highlights fade after a few seconds. Files you `@mention` in a prompt count as opened.
- Search over all files, folder expand and collapse, optional size column, and moving up a directory.

`node_modules`, `dist`, `.next`, `__pycache__`, `.venv` and `.DS_Store` are hidden; the tree is capped at 300 rows.

## next-steps

Suggested follow-ups.

**Use:** after each answer, Haiku proposes three short next prompts in a band. Click one (or press hotkey `1`, `2`, `3`) to put it in the prompt box, edit if you like, then send. `×` dismisses them.

## Develop

Source: `hooks/register.tsx`, one `// ===== <mod> =====` section per mod, wired in the `register` function at the bottom. Shared UI is copied from `shared/` by `./scripts/sync-ui.sh`.

```
claude plugin validate plugins/cockpit
claude plugin test plugins/cockpit
```
