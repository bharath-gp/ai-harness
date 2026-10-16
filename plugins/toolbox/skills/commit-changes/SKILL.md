---
name: commit-changes
description: Writes a Conventional Commits message that explains why the change was needed and what it achieves, then commits the changes made in the current session as atomic commits. Use whenever a commit is about to be made, by the user or by an agent: "commit this", "commit the changes", "commit everything", "git commit", "wrap up and commit", or a plan step that says to commit. Use it before any `git commit`, even for small changes. Also handles choosing which files to stage, splitting unrelated work, and ticket references (GitHub #123, Jira PROJ-123).
---
# Commit changes

Commit understood from `git log` alone. Title say what changed; body say why needed and what achieves. Diff already show how.

## 1. Pick the scope

- Default: files you edited or created this session. Leave other dirty files unstaged, name them in final report.
- "Commit everything" (or similar): stage all uncommitted work, untracked files included. Stop and warn if set contains secrets (`.env`, keys) or build output.
- Run `git status --short`, read diff of scope (`git diff`, `git diff --cached`). Message come from diff, because diff is what lands.
- Empty scope: report that and stop.

## 2. Make commits atomic

One commit per coherent change, each building on own and revertable on own. Diff mixing fix, refactor, docs update become three commits. Stage by explicit path, or `git add -p` when one file holds two changes. Tests and docs travel with code they cover.

## 3. Match the repo

Run `git log -10 --format=%s`. Conventional Commits default; when repo clearly follows other title style, adopt it and keep body rules below. Follow any commit rules in `CLAUDE.md` or `CONTRIBUTING`.

## 4. Write the message

```
[<ticket>: ]<type>(<scope>): <subject>

<body>

[Refs: <ticket> | Closes <ticket>]
[attribution trailer]
```

**Title**
- Imperative mood completing "If applied, this commit will ...": `fix: handle empty token list`.
- Type by user-visible effect: `feat`, `fix`, `refactor`, `perf`, `docs`, `test`, `build`, `ci`, `chore`, `revert`. Breaking change get `!` (`feat(api)!:`) plus `BREAKING CHANGE:` footer.
- Scope (optional): module, package or plugin touched; omit when change spans everything.
- Whole first line, ticket included: aim ≤50 characters, cap at 72. Lowercase subject, no trailing period.
- Name change in domain words. Vague title (`update stuff`) signal two commits fused together.

**Ticket**
- Find in branch name (`feature/PROJ-123-...`, `123-fix-x`), user's request, or session. GitHub issues `#123`, Jira keys `PROJ-123`.
- Found: prefix title (`PROJ-123: fix(auth): reject expired tokens`) and add `Refs: PROJ-123`, or `Closes #123` when commit finishes issue.
- Not found: omit ticket entirely.

**Body** (omit for self-evident changes such as typo fix)
- Blank line after title; wrap ~72 columns.
- Open with **why**: problem or need, and for bug its cause. Who affected and how.
- Follow with what it **achieves**: behavior after change, plus approach when non-obvious choice made (alternatives rejected, trade-offs, known limits).
- Describe intent and outcome; diff cover file-by-file detail. Three tight lines beat a page.

**Footer**: ticket refs, `BREAKING CHANGE:`, then attribution trailer environment's instructions specify. No such instructions: no trailer.

**Example**

```
PROJ-482: fix(billing): stop double-charging on webhook retry

Stripe retries the invoice.paid webhook when our response is slow, and
each retry created a new charge because handling was not idempotent.
Customers on slow regions were billed twice.

Key the handler on the event ID and skip events already recorded.
Retries now return 200 without side effects. The existing cleanup job
prunes events older than 30 days, so the table stays small.

Closes PROJ-482
```

## 5. Commit and report

- Pass message through heredoc so newlines survive: `git commit -F - <<'EOF' ... EOF`.
- Run hooks (`--no-verify` stays off). Failed hook mean no commit happened: fix cause, re-stage, commit again.
- Commit only; push when user asks.
- Done when `git status --short` shows scope clean. Report each commit as `<hash> <title>`, then any files left uncommitted and why, in few lines.