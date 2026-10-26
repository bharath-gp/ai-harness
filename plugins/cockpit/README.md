# cockpit

A live session dashboard in one side pane, styled after [claude-flightdeck](https://github.com/scasella/claude-flightdeck). Twelve mods show what your agents are doing, what your cache and context cost, where your plan limits stand, every permission check, the on-call architect, and which files are changing. Needs Claude Code 2.1.287+.

```
/plugin marketplace add bharath-gp/ai-harness
/plugin install cockpit@ai-harness
```

Every mod is on by default. Turn one off in the plugin config menu (boolean fields `agentsProgress`, `cacheKeeper`, `contextHealth`, `filetree`, `nextSteps`, `tokenMeter`, `usageLimits`, `architect`, `permissionGate`, `loops`, `turnReceipt`, `sessionLog`); the plugin reloads and its panel disappears. Mods are not sandboxed: read `hooks/register.tsx` first.

## The pane

`/cockpit` opens the **Cockpit** pane. With `openOnStart` it opens by itself when a session starts, in terminals at least 144 columns wide. Where it sits:

- **Fullscreen terminal:** docked beside the transcript. Two columns from 110 columns wide: main, architect and gate on the left; agents, loops and receipt on the right. The session log runs below both.
- **Main-screen terminal:** inline above the prompt as a summary of at most 8 rows: model and context, limits and cache, the gate strip, up to 3 agents, loops and the last turn.
- **Desktop app and mobile:** the same panels, plus the agents drawn on an SVG time axis.

Panels with nothing to show take no room. Connectors between panels animate only while work flows (a turn, an agent, a consult). Clocks tick on the surface's own frame clock. Where a surface cannot run them (VS Code, mobile, a surface module that faulted), they are drawn still and a dim `cockpit:` line says why.

| Command | Does |
| --- | --- |
| `/cockpit` | open the pane |
| `/cockpit close` | close it |
| `/cockpit reset` | clear agents, consults, checks, loops, log and the receipt; cost, limits and the cache stay. `/clear` does the same |
| `/cockpit layout auto\|compact\|wide\|mini` | override the layout for this session |

Focus the pane with `ctrl+x tab`, then use these keys. Every one is also a button.

| Key | Does |
| --- | --- |
| `1`-`6` | expand an agent card or lane: task, type, model, status, last 3 tool calls, start of its answer |
| `a` | show or hide finished agents |
| `f` `s` `o` | open the gate's file, shell or other drill-down: the last 5 checks and their verdicts |
| `h` | hand off (context-health) |
| `k` | keep the cache warm, or stop (cache-keeper) |
| `t`, then `r` | token details, then rescan the project total (token-meter) |

**Above the prompt:** with the pane closed, the calm mods share one summary line (`cockpit · Cache 42m · 5h 27% · 7d 23% · 1.2M tok … Open`). Click a segment or `Open` to open the pane. Bands appear only when something needs you: cache about to go cold, context filling, limits at 70%+, and the next-steps suggestions.

| Option | Default | Meaning |
| --- | --- | --- |
| `palette` | `theme` | `theme` follows your Claude Code theme (light, dark, colour-blind); `pastel` uses fixed colours for dark terminals |
| `motion` | `while-active` | `off` keeps connectors still |
| `layout` | `auto` | `mini`, `compact`, `wide`, or `auto` |
| `openOnStart` | `true` | open the pane when a session starts |
| `paneColumns` | `66` | columns the docked pane asks for (40+); a width you dragged it to wins |
| `maxCards` | `3` | agent cards side by side before swimlanes (1-6) |
| `architectPattern` | `advisor\|architect` | case-insensitive regex for agent types and server tools that count as the architect |
| `matchDescriptions` | `false` | also match agent descriptions |
| `moments` | `true` | show each consult's inferred moment |
| `architectLabel`, `gateLabel` | `ARCHITECT`, `GATE` | panel names |

| Mod | Shows | Commands |
| --- | --- | --- |
| [agents-progress](#agents-progress) | main activity, agents (cards or swimlanes), background tasks | `/agents-info` |
| [cache-keeper](#cache-keeper) | cache row, countdown band, cold-send dialog | `/keepwarm`, `/cache-tax` |
| [context-health](#context-health) | context gauge, warning band | `/ctx-handoff`, `/autohandoff` |
| [token-meter](#token-meter) | session tokens, project total, cost, models | none |
| [usage-limits](#usage-limits) | 5h and 7d plan limits | none |
| [filetree](#filetree) | file tree pane with git and activity | `/filetree` |
| [next-steps](#next-steps) | three suggested prompts | none |
| [architect](#architect) | consult timeline and advice | none |
| [permission-gate](#permission-gate) | one cell per permission check | none |
| [loops](#loops) | model loops no agent claims | none |
| [turn-receipt](#turn-receipt) | the running or last turn | none |
| [session-log](#session-log) | what happened, in order | none |

## agents-progress

Follow the main session, its subagents and its background work in one panel.

**Use:** the **agents** panel is always in the cockpit pane, in three sections:
- **main:** working or idle, the tool the main loop runs now (`Edit → hooks/register.tsx`), its request count and the turn's clock. The todo/task progress is a gauge under it and a segment of the summary line.
- **agents:** each subagent as a card while they fit: task, type and model (tagged `bg` for a background agent, `wf` for a workflow's), context and output tokens, steps, its current tool, a live clock, and `max_tokens` in red. Animated rails fan out to the cards and merge back while any card runs. With more agents than `maxCards`, they switch to swimlanes on one time axis, with the current tool under each running lane. Below are session cost, context tokens, elapsed time and the tool calls made inside subagents. `1`-`6` expand a card, `a` folds the finished ones.
- **background:** shells started with `run_in_background` (or moved there with ctrl+B or a timeout), monitors, and wakeups from `CronCreate`, `ScheduleWakeup` and `/loop` with when they fire next, from the main loop or any subagent. A shell or monitor ends when the session's `Stop` no longer lists it, or on `TaskStop` (✗).

Running agents and background tasks are also counted in the summary line above the prompt. `/agents-info` opens the pane with finished agents shown. An agent ends on its own `turn.complete`, so background agents stay running until they finish. Other sessions (side sessions) are not shown: a plugin sees only its own session.

## cache-keeper

Keeps you from silently paying to rewrite a cold prompt cache.

The cache lives 1 hour. The main panel's cache row shows a gauge of the time left and the cost of the next send. In its last 5 minutes, or once cold, a band above the prompt shows time left, context size and the cost of the next send (warm vs cold).

**Use:**
- `/keepwarm 90m` (or `2h`, `2h30m`) sends cheap cache-read pings starting 50 minutes after your last turn, for the window you give. It stops itself if a ping shows the cache was already cold. `/keepwarm off` stops; `/keepwarm status` reports what is armed and the last ping. The band's `Keep warm` / `Stop keepwarm` button and the pane's `k` do the same.
- `/cache-tax` prints cache state, context tokens and cold vs warm send cost.
- **Cold-send dialog:** the first prompt after the cache went cold opens a dialog with the estimated rewrite cost. `Continue here` sends it anyway; `New session` clears and drops the prompt (send it again). Dismissing the dialog drops the prompt.
- A toast warns when the cache will go cold in under 5 minutes.

Pings are reads, not free: they cost tokens.

## context-health

Tracks how full the context window is.

**Use:** the main panel shows a `ctx ▰▰▱▱ N%` gauge with tokens of the window, compactions (`⟲`), turn count, speed, cost and the auto-handoff threshold. As it fills, a `Context N%` band above the prompt warns, with `Handoff` (hotkey `h`), `Fresh` (`f`, runs `/clear`) and `×` to hide the band. The pane has the same `handoff` and `fresh` buttons.

- `/ctx-handoff` has Claude write a handoff brief to `.claude/handoff.md`, clears the context (only if the turn finished and the file exists; otherwise the context is kept), then pre-fills a prompt to read it and continue. Review before sending.
- `/autohandoff 60` triggers the same handoff automatically at 60% context (accepts 10 to 95; default 50). `/autohandoff off` disables it.

## token-meter

Token usage for the session and the project.

**Shows:** the main panel's tokens row and the summary line carry the tokens used this session (input, output, cache read and cache write added together) and the session cost. `details` (`t`) adds the project total (every past session of this folder, read from `~/.claude/projects/<folder>/*.jsonl`, plus this session's new tokens; `rescan` re-reads it), session cost with last turn and average per turn, and tokens per model.

No commands. Limits: the session count starts when the mod loads (a hot reload resets it); cost is the total Claude Code reports, so there is no project cost; transcript files over 4 MiB are skipped and flagged.

## usage-limits

Your plan limits, always in view.

**Shows:** session (5h) and weekly (7d) usage as gauges in the main panel, each with the time until it resets (`↻`) and pace, which is how far ahead of or behind an even burn rate you are. The summary line shows them as percentages. At 70% a band appears above the prompt; colours move to warning at 70% and critical at 90%. A toast fires once per window when it crosses 90%, and re-arms after usage drops back under.

No commands. Appears only when the account reports limits.

## filetree

A file tree pane with git status and live agent activity.

**Use:** `/filetree` (or the `N files` segment on the summary line) opens the pane for the session's folder. A `FILES` box shows branch, upstream, ahead/behind, line counts, what Claude is doing right now and a colour legend. Below it:
- Git status per file (new, modified, deleted, renamed) with +/- line counts, and counts per folder; committed-but-not-pushed files are marked too.
- Highlights for files Claude touches: reads in the architect's colour, edits in Claude's, commits in the gate's, with a shimmer while they are live. Files you `@mention` in a prompt count as opened. "Claude touched" lists the latest, click one to reveal it.
- Buttons: refresh, collapse all, sizes or dates, up a folder, back to the project, hidden files on or off, clear selection. Search over all files.
- A selected file is sent to Claude as context with your next prompt.

`node_modules`, `dist`, `.next`, `__pycache__`, `.venv` and `.DS_Store` are hidden; the tree is capped at 300 rows (on the terminal, a window around the selection).

## next-steps

Suggested follow-ups.

**Use:** after each answer, Haiku proposes three short next prompts in a band. Click one (or press hotkey `1`, `2`, `3`) to put it in the prompt box, edit if you like, then send. `×` dismisses them.

## architect

The on-call architect.

**Shows:** an **ARCHITECT** panel once you consult one: subagent types matching `architectPattern` (or offered with a matching description when `matchDescriptions` is on), and server tools such as Claude Code's `advisor`. It draws consults on a timeline (`◆`, `━` while running), whether one is running, how long the last took, and its inferred moment (before a plan, error repeats, before done). Turn moments off with `moments: false`. The advice line is the first line of a subagent architect's report; server-side advice is encrypted, so it is only counted and timed.

## permission-gate

Every permission check, at a glance.

**Shows:** a **GATE** panel with one cell per check. Green: allowed by a rule. Blue: decided by you or the auto-mode classifier, then run. Amber: pending. Red ✗: denied. Dim: made inside a subagent. Totals follow, and `f` / `s` / `o` open the last 5 checks for file, shell and other tools. Credentials in commands and paths are masked before anything is kept. It only watches: verdicts pass through unchanged.

## loops

Model loops that no agent card claims: workflow agents, compactions, memory forks. **Shows:** `other loops N seen · M active` with one dot per loop.

## turn-receipt

**Shows:** while a turn runs, its live clock with edits and errors so far; after it, `last turn 6s · 0 agents · 2 edits · 0 errors · +$0.22`, with ✓ or ✗ for how it ended.

## session-log

**Shows:** a **session log** panel with the last 4-8 events: your prompts, spawns, completions, consults, edits, errors, denials and compactions. While you view an agent's transcript it shows only that agent's lines.

## Develop

Source: `hooks/register.tsx`, a `// ===== cockpit pane =====` section with the pane shell, then one `// ===== <mod> =====` section per mod, wired in the `register` function at the bottom. Shared UI is copied from `shared/` by `./scripts/sync-ui.sh`: `rail.tsx` and `elapsed.tsx` are surface modules taken from claude-flightdeck (MIT, see `THIRD_PARTY_NOTICES.md`).

```
claude plugin validate plugins/cockpit
claude plugin test plugins/cockpit
```
