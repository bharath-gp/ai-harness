---
name: commit-changes
description: Writes a Conventional Commits message that explains why the change was needed and what it achieves, then commits the changes made in the current session as atomic commits. Use whenever a commit is about to be made, by the user or by an agent: "commit this", "commit the changes", "commit everything", "git commit", "wrap up and commit", or a plan step that says to commit. Use it before any `git commit`, even for small changes. Also handles choosing which files to stage, splitting unrelated work, and ticket references (GitHub #123, Jira PROJ-123).
---

# Commit changes

A commit should be understood from `git log` alone. The title says what changed; the body says why it was needed and what it achieves. The diff already shows how.

## 1. Pick the scope

- Default: the files you edited or created this session. Leave other dirty files unstaged and name them in your final report.
- "Commit everything" (or similar): stage all uncommitted work, untracked files included. Stop and warn if the set contains secrets (`.env`, keys) or build output.
- Run `git status --short` and read the diff of the scope (`git diff`, `git diff --cached`). The message comes from the diff, because the diff is what lands.
- Empty scope: report that and stop.

## 2. Make commits atomic

One commit per coherent change, each building on its own and revertable on its own. A diff mixing a fix, a refactor and a docs update becomes three commits. Stage by explicit path, or `git add -p` when one file holds two changes. Tests and docs travel with the code they cover.

## 3. Match the repo

Run `git log -10 --format=%s`. Conventional Commits is the default; when the repo clearly follows another title style, adopt it and keep the body rules below. Follow any commit rules in `CLAUDE.md` or `CONTRIBUTING`.

## 4. Write the message

```
[<ticket>: ]<type>(<scope>): <subject>

<body>

[Refs: <ticket> | Closes <ticket>]
[attribution trailer]
```

**Title**
- Imperative mood that completes "If applied, this commit will ...": `fix: handle empty token list`.
- Type by user-visible effect: `feat`, `fix`, `refactor`, `perf`, `docs`, `test`, `build`, `ci`, `chore`, `revert`. A breaking change gets `!` (`feat(api)!:`) plus a `BREAKING CHANGE:` footer.
- Scope (optional): the module, package or plugin touched; omit when the change spans everything.
- Whole first line, ticket included: aim for ≤50 characters, cap at 72. Lowercase subject, no trailing period.
- Name the change in domain words. A title that stays vague (`update stuff`) signals two commits fused together.

**Ticket**
- Find it in the branch name (`feature/PROJ-123-...`, `123-fix-x`), the user's request, or the session. GitHub issues are `#123`, Jira keys `PROJ-123`.
- Found: prefix the title (`PROJ-123: fix(auth): reject expired tokens`) and add `Refs: PROJ-123`, or `Closes #123` when the commit finishes the issue.
- Not found: omit the ticket entirely.

**Body** (omit for self-evident changes such as a typo fix)
- Blank line after the title; wrap at ~72 columns.
- Open with the **why**: the problem or need, and for a bug its cause. Who was affected and how.
- Follow with what it **achieves**: behavior after the change, plus the approach when a non-obvious choice was made (alternatives rejected, trade-offs, known limits).
- Describe intent and outcome; the diff covers file-by-file detail. Three tight lines beat a page.

**Footer**: ticket refs, `BREAKING CHANGE:`, then the attribution trailer the environment's instructions specify. No such instructions: no trailer.

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

- Pass the message through a heredoc so newlines survive: `git commit -F - <<'EOF' ... EOF`.
- Run hooks (`--no-verify` stays off). A failed hook means no commit happened: fix the cause, re-stage, commit again.
- Commit only; push when the user asks.
- Done when `git status --short` shows the scope clean. Report each commit as `<hash> <title>`, then any files left uncommitted and why, in a few lines.
