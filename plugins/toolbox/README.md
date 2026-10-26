# toolbox

Everyday git and GitHub skills. Plain `SKILL.md` folders, so besides Claude Code they install into Cursor, Codex, Gemini CLI, Copilot and others via the `skills` installer.

```
/plugin marketplace add bharath-gp/ai-harness
/plugin install toolbox@ai-harness
npx skills add bharath-gp/ai-harness --skill commit-changes --agent codex cursor -g   # other agents
```

Skills trigger from plain requests, or name one: `/toolbox:commit-changes`.

| Skill | What it does | Ask | Needs |
| --- | --- | --- | --- |
| `commit-changes` | Commits the session's work as atomic Conventional Commits with a why-first message; adds ticket refs; never pushes | "commit this" | `git` |
| `create-pr` | Opens or updates a PR using the repo's template (or a built-in one) with why, what, verification and review focus | "open a PR" | `gh` signed in |
| `github-repo-setup` | Creates or hardens a repo: branch protection, squash-only merges, CI, CodeQL, Dependabot, secret scanning, optional signed commits | "set up this repo properly" | `gh`, repo admin |

`evals/` holds trigger and behaviour evals for each skill.
