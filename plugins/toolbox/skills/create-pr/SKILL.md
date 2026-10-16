---
name: create-pr
description: Opens a GitHub pull request for the current branch with a title and body a reviewer can understand without reading the diff. Fills the repo's PR template section by section, or a built-in template when the repo has none. Use whenever a PR is about to be opened, by the user or by an agent: "open a PR", "create a pull request", "gh pr create", "push and PR this", "ship it", or a plan step that says to open a PR. Also handles pushing the branch, ticket links, test evidence and reviewer notes.
---
# Create PR

Reviewer read PR body, not diff, to decide what look at. Body answer: why exist, what change, how verified, where look close. Every PR from skill carry same sections, filled from real changes.

## 1. Gather the facts

- `gh repo view --json defaultBranchRef,nameWithOwner` give base branch. `git branch --show-current` give head; on base branch, stop and ask for branch name.
- `git status --short`: uncommitted work in scope go through `commit-changes` skill first. Unrelated dirty files stay out, get named in report.
- `git fetch origin`, then read what PR will contain: `git log origin/<base>..HEAD` and `git diff origin/<base>...HEAD`. Body come from diff and commit messages, because those land.
- Every commit in range must be new work. Squash or rebase merge leave branch holding commits whose content already on base under different hash: `git cherry origin/<base>` mark rebase-merged ones `-`; for squash merges, match each commit title against `gh pr list --state merged --search "<title>" --json number,title,headRefName`. Already-merged commits are **stale**.
  - Unpushed branch: `git rebase --onto origin/<base> <last stale commit>` drop them, then re-read range. Say so in report.
  - Pushed branch: rebase need force-push, so ask first, naming stale commits.
  - Range hold only stale commits: report that and stop.
- Existing open PR for branch (`gh pr list --head <branch>`): **update mode**. Read it (`gh pr view --json number,title,body,url`) and carry on; step 5 update it instead of create one.
- Empty range: report that and stop.

## 2. Pick the template

First match win:

1. `.github/PULL_REQUEST_TEMPLATE/` holding several templates: choose one matching change; ask when two fit.
2. `.github/pull_request_template.md`, `.github/PULL_REQUEST_TEMPLATE.md`, `pull_request_template.md`, `docs/pull_request_template.md` (any casing).
3. Built-in template below.

Repo template is law: keep its headings, order, checklist wording verbatim, fill every section. Section not apply get `N/A` plus few words why. Sections it lacks stay out, so built-in sections never bolted on. Where repo template thinner than bar in step 3, carry each missing fact as bold-labelled line (`**Verification:** ...`, `**Review focus:** ...`) inside closest section. Verification always appear, with command run and result.

## 3. Fill it to the bar

Whatever template, finished body let reviewer say, without opening diff:

- **Why**: problem or need, and for bug its cause. Who affected.
- **What**: behaviour after change, grouped by theme, in domain words. File lists are diff's job.
- **Verification**: what run (command and result) or observed. Say `Not tested` when nothing ran; unrun check never get tick.
- **Review focus**: risk, breaking changes, migrations, non-obvious choices with alternative rejected, and one or two places deserve close read. UI changes get before/after screenshots when can produce; otherwise ask for them in report.
- **Links**: ticket. Find in branch name (`feature/PROJ-123-...`, `123-fix-x`), commits or session. `Closes #123` when PR finish issue, `Refs PROJ-123` otherwise. No ticket found: leave line out.

Checklist items: tick only what verified this session; leave rest unticked and name them in report.

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

Match repo titles: `gh pr list --state merged --limit 10 --json title`. Conventional Commits default (`fix(auth): reject expired tokens`); title say what changed, imperative, ≤72 characters, no trailing period. Single-commit PR reuse that commit title. Squash-merge repo turn this title into commit on base branch, so make it stand alone.

## 5. Open or update it

**Update mode.** Existing body is draft: re-check each section against full range now on branch, not only new commits.
- Rewrite what new commits changed: section no longer match diff, new verification, new risks, new ticket. Keep what still true, human edits and ticks already made included; add tick only for what verified this session.
- Retitle only when title no longer say what PR does.
- Nothing material changed: leave title and body alone and say so.
- Push new commits, then `gh pr edit <number> --title "<title>" --body-file <file>`. Skip `--title` when unchanged.
- Done when `gh pr view --json body` show edit. Report URL and what changed in body, in few lines.

**New PR.**

- Push when branch has no upstream or is ahead: `git push -u origin HEAD`.
- Write body to temp file and create with `gh pr create --base <base> --title "<title>" --body-file <file>`. Add `--draft` when user asked for draft.
- End body with attribution line environment's instructions specify; none specified mean none.
- Done when `gh pr view --json url,body` return PR and body match file. Report URL, then any unticked checklist items, untested areas, files left uncommitted, in few lines.