# toolbox

General-purpose skills for everyday git and GitHub work. Plain `SKILL.md` folders, so besides Claude Code they install into Cursor, Codex, Gemini CLI, Copilot and others via the `skills` installer.

```
/plugin marketplace add bharath-gp/ai-harness
/plugin install toolbox@ai-harness
```

Other agents:

```
npx skills add bharath-gp/ai-harness --skill commit-changes --agent codex cursor -g
```

Skills trigger from plain requests ("commit this", "open a PR", "harden this repo"), and agents invoke them at plan steps that say to commit or open a PR. You can also name one explicitly, e.g. `/toolbox:commit-changes`.

| Skill | Use it to |
| --- | --- |
| [commit-changes](#commit-changes) | commit the session's work with a why-first Conventional Commits message |
| [create-pr](#create-pr) | open or update a PR a reviewer can read without the diff |
| [github-repo-setup](#github-repo-setup) | create or harden a repo: protection, CI, scanning |

## commit-changes

Writes the commit message and makes the commits.

**Ask:** "commit this", "commit everything", "wrap up and commit".

**Does:**
1. Scopes to the files edited this session (or all uncommitted work for "commit everything", stopping if it contains secrets or build output). Other dirty files stay unstaged and are named in the report.
2. Splits unrelated changes into atomic commits, staging by explicit path or `git add -p`. Tests and docs travel with their code.
3. Matches the repo's title style from `git log`, defaulting to Conventional Commits (`type(scope): subject`, under 50 characters, up to 72).
4. Writes a body that opens with why (the problem or cause), then what it achieves and any non-obvious choice.
5. Adds ticket references from the branch name or request: `PROJ-123: ...` prefix with `Refs:` / `Closes` footers for Jira keys or `#123`.
6. Runs hooks (never `--no-verify`), commits, and reports each `<hash> <title>`. It does not push.

## create-pr

Opens a pull request, or updates the open one.

**Ask:** "open a PR", "create a pull request", "push and PR this", "ship it".

**Does:**
1. Finds base and head branches, sends uncommitted work through `commit-changes` first, and reads the real commits and diff.
2. Detects commits already merged to base by squash or rebase and drops them (asking first if the branch is pushed, since that needs a force-push).
3. Uses the repo's PR template (`.github/pull_request_template.md`, a template folder, etc.) verbatim, filling every section, or a built-in one: Summary, Why, What changed, How it was verified, Review focus, Related.
4. Always includes verification (the command run and its result, or `Not tested`) and review focus. Checklist items are ticked only if verified this session.
5. Titles to match recent merged PRs, pushes the branch, and creates the PR with `gh`. `--draft` on request.
6. If a PR already exists for the branch, it rewrites only the sections the new commits changed and leaves the rest, human edits included.

Needs `gh` authenticated.

## github-repo-setup

Sets up or hardens a GitHub repo entirely through `gh`.

**Ask:** "set up this repo properly", "add branch protection and CI", "create a new repo with best-practice settings".

**Does, in order:**
1. **Plan gate:** checks that rulesets and secret scanning are available (private repos on the free plan are not) and asks before upgrading or changing visibility. Scans history for secrets before going public.
2. Creates the repo if new (initial README, LICENSE, `.gitignore`).
3. Sets repo options: squash-only merges and similar.
4. Adds CI (using your project's own test and lint commands), CodeQL, Dependabot, CODEOWNERS, a PR template, LICENSE and SECURITY.md from the bundled `assets/`, delivered through a PR.
5. Turns on secret scanning and push protection.
6. Adds a branch-protection ruleset: PR required, no direct push to the default branch, linear history, required CI check.
7. Optionally requires signed commits (asks first), then summarises what is set and what you must do yourself.

It asks only what it cannot infer: visibility, license (default MIT), required checks, and whether to require signed commits. Needs admin permission on the repo.

## Evals

`evals/` holds trigger and behaviour evals for each skill (fires when it should, stays silent on explain-only requests, follows the repo template, updates an existing PR, asks before changing visibility).
