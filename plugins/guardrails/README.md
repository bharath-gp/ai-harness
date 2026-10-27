# guardrails

Safety and review of Claude's output, helped by local decision models. Needs Claude Code 2.1.287+.

```
/plugin marketplace add bharath-gp/ai-harness
/plugin install guardrails@ai-harness
```

| Mod | What it does | Trigger | Commands |
| --- | --- | --- | --- |
| `blast-radius` | Asks before destructive shell commands run (`rm -r`, `git push --force`, `git reset --hard`, `DROP TABLE`, ...) and shows what they do and what they would hit | `Bash` tool call | none |
| `secret-sentry` | Blocks API keys and private keys from being written into files | `Write`, `Edit`, `NotebookEdit` | none |
| `reflect` | Spots corrections in your prompts and saves them as rules in CLAUDE.md | every prompt | `/reflect-queue`, `/reflect-pause` |
| `assumption-tracker` | Lists the assumptions Claude made and sends fixes for the ones you mark wrong | end of each turn | `/assumptions` |
| `self-critique` | Reviews Claude's last answer, with one-click fixes | on demand, or each turn | `/critique` |
| `prompt-coach` | Rewrites your first prompt so Claude grills you about the open questions first | first prompt of a session, including `/skill text` (the command word is kept, the text after it is reworded) | `/sharpen` |
| `merge-sweep` | After a PR you opened is merged, offers to remove its worktree, local branch and remote branch; never forces | `gh pr create`, then every minute, each prompt and each turn end | none |
| `decision-gate` | Lets a local decision model approve a system-affecting tool call it is sure is safe and fits the task (at least `decisionThreshold`); anything else is put to you. Never denies on its own, respects deny rules, is off in bypass and plan mode and never adds an ask in auto mode. On a blast-radius hit its verdict is a line on the blast-radius card | `Bash`, `PowerShell`, `Write`, `Edit`, `NotebookEdit`, non-read-only MCP tool call | `/decide-bench` |
| `auto-answer` | Answers Claude's multiple-choice questions when the model is sure no personal preference is needed; an "Answered for you" band shows for 30s with Override | `AskUserQuestion` | none |
| `model-picker` | Picks haiku, sonnet or opus for built-in subagents spawned without a model, and suggests a session model in the prompt-coach pane with a Switch button (runs `/model`) | subagent spawn without a model, first prompt | none |

`decision-gate`, `auto-answer` and `model-picker` act only while Ollama is running with at least one model that has the `decision` capability (e.g. `tev1:4b`, `nimble-v3:9b-mxfp8`), served at `/v1/systemone`. Models are found automatically and ranked into fast and strong tiers by a built-in benchmark that re-runs monthly; `/decide-bench` re-runs it now. With Ollama offline they fall through to normal behaviour and show a calm band with an x.

## Config

Every mod is on by default. Turn one off in the plugin config menu: `blastRadius`, `secretSentry`, `reflect`, `assumptionTracker`, `selfCritique`, `promptCoach`, `mergeSweep`, `decisionGate`, `autoAnswer`, `modelPicker`. The plugin reloads.

| Option | Default | Meaning |
| --- | --- | --- |
| `palette` | `theme` | `theme` follows your Claude Code theme; `pastel` uses fixed colours for dark terminals |
| `motion` | `while-active` | `off` keeps animations still |
| `decisionThreshold` | `0.85` | how sure (0-1) a decision model must be before its answer is used |
| `decisionTimeoutMs` | `3000` | how long to wait for a warm decision model before asking as usual |
| `ollamaUrl` | `http://localhost:11434` | where the decision models are served |
| `fastModel`, `strongModel` | empty | pin a tier to a model (empty: chosen by the benchmark) |
| `benchEveryDays` | `30` | re-run the benchmark after this many days |
| `benchNonce` | empty | change to re-run the benchmark |
| `subagentModels` | `haiku,sonnet,opus` | models `model-picker` chooses from, cheapest first |

`merge-sweep` needs `gh` signed in and assumes the remote is `origin`. Mods are not sandboxed: read `hooks/register.tsx` first. Install `reflect` or the Python claude-reflect plugin, not both.
