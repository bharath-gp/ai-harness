# cockpit

Live session dashboard in one side pane. Needs Claude Code 2.1.287+.

```
/plugin marketplace add bharath-gp/ai-harness
/plugin install cockpit@ai-harness
```

`/cockpit` opens the pane: docked beside the transcript in fullscreen, an 8-row summary above the prompt otherwise. Focus it with `ctrl+x tab`; every key is also a button.

| Command | Does |
| --- | --- |
| `/cockpit` | open the pane |
| `/cockpit close` | close it |
| `/cockpit reset` | clear agents, consults, checks, loops, log and the receipt (`/clear` does the same) |
| `/cockpit layout auto\|compact\|wide\|mini` | override the layout for this session |

| Mod | What it shows | Commands |
| --- | --- | --- |
| `agents-progress` | Main activity and task progress, subagents as cards or swimlanes, background shells, monitors and wakeups | `/agents-info` |
| `cache-keeper` | Cache countdown, a band when it is about to go cold, cold-send dialog with cost estimate | `/keepwarm`, `/cache-tax` |
| `context-health` | Context gauge with compactions and a warning band | `/ctx-handoff`, `/autohandoff` |
| `token-meter` | Session tokens and cost, project total, models | none |
| `usage-limits` | 5h and 7d plan limits with reset countdown; a band from 70% | none |
| `filetree` | File tree with git status and highlights for files Claude reads and writes | `/filetree` |
| `next-steps` | Three suggested prompts after each turn | none |
| `architect` | Consult timeline with advice from the on-call architect | none |
| `permission-gate` | One cell per permission check, credentials masked | none |
| `loops` | Model loops no agent claims (workflow agents, compactions, forks) | none |
| `turn-receipt` | The running or last turn: clock, agents, edits, errors, cost | none |
| `session-log` | Prompts, spawns, completions, consults, edits, errors, denials | none |

## Config

Every mod is on by default. Turn one off in the plugin config menu: `agentsProgress`, `cacheKeeper`, `contextHealth`, `tokenMeter`, `usageLimits`, `filetree`, `nextSteps`, `architect`, `permissionGate`, `loops`, `turnReceipt`, `sessionLog`. The plugin reloads.

| Option | Default | Meaning |
| --- | --- | --- |
| `palette` | `theme` | `theme` follows your Claude Code theme; `pastel` uses fixed colours for dark terminals |
| `motion` | `while-active` | `off` keeps connectors still |
| `layout` | `auto` | `mini`, `compact`, `wide` or `auto` |
| `openOnStart` | `true` | open the pane when a session starts (terminals 144+ columns) |
| `paneColumns` | `66` | columns the docked pane asks for (40+) |
| `maxCards` | `3` | agent cards side by side before swimlanes (1-6) |
| `architectPattern` | `advisor\|architect` | regex for agent types and server tools that count as the architect |
| `matchDescriptions` | `false` | also match agent descriptions |
| `moments` | `true` | show each consult's inferred moment |
| `architectLabel`, `gateLabel` | `ARCHITECT`, `GATE` | panel names |

Mods are not sandboxed: read `hooks/register.tsx` first.
