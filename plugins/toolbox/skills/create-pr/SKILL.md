---
name: create-pr
description: Opens a GitHub pull request for the current branch with a title and body a reviewer can understand without reading the diff. Fills the repo's PR template section by section, or a built-in template when the repo has none. Use whenever a PR is about to be opened, by the user or by an agent: "open a PR", "create a pull request", "gh pr create", "push and PR this", "ship it", or a plan step that says to open a PR. Also handles pushing the branch, ticket links, test evidence and reviewer notes.
---

# Create PR

A reviewer reads the PR body, not the diff, to decide what to look at. The body answers: why this exists, what changed, how it was verified, where to look closely. Every PR from this skill carries the same sections, filled from the real changes.

## 1. Gather the facts

- `gh repo view --json defaultBranchRef,nameWithOwner` gives the base branch. `git branch --show-current` gives the head; on the base branch, stop and ask for a branch name.
- `git status --short`: uncommitted work in scope goes through the `commit-changes` skill first. Unrelated dirty files stay out and get named in the report.
- `git fetch origin`, then read what the PR will contain: `git log origin/<base>..HEAD` and `git diff origin/<base>...HEAD`. The body comes from the diff and commit messages, because those are what land.
- Every commit in that range must be new work. A squash or rebase merge leaves the branch holding commits whose content is already on the base under a different hash: `git cherry origin/<base>` marks rebase-merged ones `-`; for squash merges, match each commit's title against `gh pr list --state merged --search "<title>" --json number,title,headRefName`. Already-merged commits are **stale**.
  - Unpushed branch: `git rebase --onto origin/<base> <last stale commit>` drops them, then re-read the range. Say so in the report.
  - Pushed branch: the rebase needs a force-push, so ask first, naming the stale commits.
  - Range holds only stale commits: report that and stop.
- Existing open PR for this branch (`gh pr list --head <branch>`): **update mode**. Read it (`gh pr view --json number,title,body,url`) and carry on; step 5 updates it instead of creating one.
- Empty range: report that and stop.

## 2. Pick the template

First match wins:

1. `.github/PULL_REQUEST_TEMPLATE/` holding several templates: choose the one matching the change; ask when two fit.
2. `.github/pull_request_template.md`, `.github/PULL_REQUEST_TEMPLATE.md`, `pull_request_template.md`, `docs/pull_request_template.md` (any casing).
3. The built-in template below.

A repo template is law: keep its headings, order and checklist wording verbatim, and fill every section. A section that does not apply gets `N/A` plus a few words why. Sections it lacks stay out, so the built-in sections never get bolted on. Where the repo template is thinner than the bar in step 3, carry each missing fact as a bold-labelled line (`**Verification:** ...`, `**Review focus:** ...`) inside its closest section. Verification always appears, with the command run and its result.

## 3. Fill it to the bar

Whatever the template, the finished body lets a reviewer say, without opening the diff:

- **Why**: the problem or need, and for a bug its cause. Who was affected.
- **What**: the behaviour after the change, grouped by theme, in domain words. File lists are the diff's job.
- **Verification**: what was run (command and result) or observed. Say `Not tested` when nothing ran; an unrun check never gets a tick.
- **Review focus**: risk, breaking changes, migrations, non-obvious choices with the alternative rejected, and the one or two places that deserve a close read. UI changes get before/after screenshots when you can produce them; otherwise ask for them in the report.
- **Links**: the ticket. Find it in the branch name (`feature/PROJ-123-...`, `123-fix-x`), the commits or the session. `Closes #123` when the PR finishes the issue, `Refs PROJ-123` otherwise. No ticket found: leave the line out.

Checklist items: tick only what you verified this session; leave the rest unticked and name them in the report.

### Built-in template

```markdown
## Summary
<one or two sentences: what this PR does, for someone skimming>

## Why
<problem or need; cause for a bug; who it affected>

## What changed
- <behaviour change, grouped by theme>

## How it was verified
- <command run and result, or manual check>

## Review focus
- <risk, breaking change, trade-off, or place to read closely; "None" if routine>

## Related
<Closes #123 | Refs PROJ-123>
```

## 4. Write the title

Match the repo's titles: `gh pr list --state merged --limit 10 --json title`. Conventional Commits is the default (`fix(auth): reject expired tokens`); the title says what changed, imperative, ≤72 characters, no trailing period. A single-commit PR reuses that commit's title. A squash-merge repo turns this title into the commit on the base branch, so make it stand alone.

## 5. Open or update it

**Update mode.** The existing body is the draft: re-check each section against the full range now on the branch, not only the new commits.
- Rewrite what the new commits changed: a section that no longer matches the diff, new verification, new risks, a new ticket. Keep what is still true, human edits and ticks already made included; add a tick only for what you verified this session.
- Retitle only when the title no longer says what the PR does.
- Nothing material changed: leave title and body alone and say so.
- Push the new commits, then `gh pr edit <number> --title "<title>" --body-file <file>`. Skip `--title` when unchanged.
- Done when `gh pr view --json body` shows the edit. Report the URL and what changed in the body, in a few lines.

**New PR.**

- Push when the branch has no upstream or is ahead: `git push -u origin HEAD`.
- Write the body to a temp file and create with `gh pr create --base <base> --title "<title>" --body-file <file>`. Add `--draft` when the user asked for a draft.
- End the body with the attribution line the environment's instructions specify; none specified means none.
- Done when `gh pr view --json url,body` returns the PR and the body matches the file. Report the URL, then any unticked checklist items, untested areas and files left uncommitted, in a few lines.
