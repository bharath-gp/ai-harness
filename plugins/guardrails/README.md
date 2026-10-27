# guardrails

Safety and review of Claude's output. Needs Claude Code 2.1.287+.

```
/plugin marketplace add bharath-gp/ai-harness
/plugin install guardrails@ai-harness
```

| Mod | What it does | Trigger | Commands |
| --- | --- | --- | --- |
| `blast-radius` | Asks before destructive shell commands run (`rm -r`, `git push --force`, `git reset --hard`, `DROP TABLE`, ...) and shows what they would hit | `Bash` tool call | none |
| `secret-sentry` | Blocks API keys and private keys from being written into files | `Write`, `Edit`, `NotebookEdit` | none |
| `reflect` | Spots corrections in your prompts and saves them as rules in CLAUDE.md | every prompt | `/reflect-queue`, `/reflect-pause` |
| `assumption-tracker` | Lists the assumptions Claude made and sends fixes for the ones you mark wrong | end of each turn | `/assumptions` |
| `self-critique` | Reviews Claude's last answer, with one-click fixes | on demand, or each turn | `/critique` |
| `prompt-coach` | Rewrites your first prompt so Claude grills you about the open questions first | first prompt of a session | `/sharpen` |
| `merge-sweep` | After a PR you opened is merged, offers to remove its worktree, local branch and remote branch; never forces | `gh pr create`, then every minute, each prompt and each turn end | none |

## Config

Every mod is on by default. Turn one off in the plugin config menu: `blastRadius`, `secretSentry`, `reflect`, `assumptionTracker`, `selfCritique`, `promptCoach`, `mergeSweep`. The plugin reloads.

| Option | Default | Meaning |
| --- | --- | --- |
| `palette` | `theme` | `theme` follows your Claude Code theme; `pastel` uses fixed colours for dark terminals |
| `motion` | `while-active` | `off` keeps animations still |

`merge-sweep` needs `gh` signed in and assumes the remote is `origin`. Mods are not sandboxed: read `hooks/register.tsx` first. Install `reflect` or the Python claude-reflect plugin, not both.
