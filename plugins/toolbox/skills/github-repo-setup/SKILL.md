---
name: github-repo-setup
description: Set up a GitHub repo with recommended settings, guardrails and security from day 1 using gh — branch protection ruleset (PR required, no direct push to main, linear history, required CI check, optional signed commits), squash-only merges, CI workflow, CodeQL, Dependabot, CODEOWNERS, PR template, LICENSE, SECURITY.md, secret scanning and push protection. Use whenever the user wants to harden, secure, "set up properly", add safeguards/CI/branch protection to an existing repo, or create a new repo with best-practice settings, even if they don't say "ruleset" or "guardrails".
---
# GitHub repo setup

Goal: leave repo with no direct push to `main`, every change via PR with green CI, security scanning on, sane merge settings. Do everything with `gh`; hand user only what needs browser or their keys.

Work out first: new repo or existing? Run `gh repo view --json nameWithOwner,visibility,viewerPermission,defaultBranchRef` (existing) and `gh auth status`. Admin permission required. Ask user only for what can't infer: visibility, license (default MIT), required-check commands (read README/package.json/scripts/CLAUDE.md to find project's own test/lint commands), whether to require signed commits.

## 0. Plan gate (do this before anything else)

Rulesets, branch protection, secret scanning on **private repo need GitHub Pro/Team**; API returns `403 Upgrade to GitHub Pro or make this repository public`. Probe early by POSTing ruleset (step 5) or just check visibility. If private on free plan, stop and ask: upgrade, or make public. Never flip visibility without explicit yes. Before going public, scan history: `git log -p --all | grep -nE 'sk-ant-|AKIA[0-9A-Z]{16}|gh[pos]_[A-Za-z0-9]{30,}|BEGIN [A-Z ]*PRIVATE KEY|xox[bp]-'` and show user any hits (regex source and obvious test fixtures fine).

## 1. New repo only

`gh repo create <owner>/<name> --<public|private> --clone`, then commit README + LICENSE + `.gitignore` straight to `main` (only time push to main directly: ruleset doesn't exist yet). Then continue with steps below as if existing.

## 2. Repo settings

```bash
gh repo edit --delete-branch-on-merge --enable-squash-merge --enable-merge-commit=false --enable-rebase-merge=false --enable-auto-merge=false --enable-projects=false --enable-wiki=false --description "<one line>" --add-topic <t1> --add-topic <t2>
gh api -X PATCH repos/{owner}/{repo} -f squash_merge_commit_title=PR_TITLE -f squash_merge_commit_message=PR_BODY
```
Squash-only keeps history linear, which ruleset requires.

## 3. Files, via a PR

Branch (`chore/repo-guardrails`), add files below, commit, push, `gh pr create`. If PR tool or app offers PR binding/auto-fix, use it instead of polling `gh pr checks`. Templates live in `assets/`; copy and adapt:

- `assets/ci.yml` → `.github/workflows/ci.yml`. Replace TODO step with project's real checks. Job id/name (`check`) is what ruleset requires; keep identical.
- `assets/codeql.yml` → `.github/workflows/codeql.yml`. Set `languages` (javascript-typescript, python, go, java-kotlin, ruby, csharp, cpp, swift, actions). Drop if repo has no supported language.
- `assets/dependabot.yml` → `.github/dependabot.yml`. Always keep `github-actions`; add entry per ecosystem found (npm, pip, cargo, gomod, ...).
- `CODEOWNERS` (`* @<owner>`), `assets/pull_request_template.md`, `LICENSE` (ask; MIT default, year + owner name), `assets/SECURITY.md` (fill in `<owner>/<repo>`).
- Add License line to README.

**Pin every third-party Action to commit SHA** with `# vN` comment; tags mutable, hijacked tag runs in your CI. Resolve with `gh api repos/<action>/commits/<tag> --jq .sha` (`gh api` follows annotated tags for commits endpoint). Dependabot keeps pins current. Keep workflow `permissions: contents: read` at top level, widen per job only when needed (CodeQL needs `security-events: write`).

Do not use `sleep`/`timeout` to wait on CI (blocked/absent on macOS); use PR status tool or `gh pr checks --watch`. Merge when green: `gh pr merge <n> --squash --delete-branch`, then `git checkout main && git pull`.

## 4. Security features

```bash
gh api -X PATCH repos/{owner}/{repo} --input - <<< '{"security_and_analysis":{"secret_scanning":{"status":"enabled"},"secret_scanning_push_protection":{"status":"enabled"}}}'
gh api -X PUT repos/{owner}/{repo}/vulnerability-alerts
gh api -X PUT repos/{owner}/{repo}/automated-security-fixes
gh api -X PUT repos/{owner}/{repo}/private-vulnerability-reporting
gh api -X PUT repos/{owner}/{repo}/actions/permissions/workflow -f default_workflow_permissions=read -F can_approve_pull_request_reviews=false
gh api -X PUT repos/{owner}/{repo}/actions/permissions/fork-pr-contributor-approval -f approval_policy=all_external_contributors
```
Verify with `gh api repos/{owner}/{repo} --jq .security_and_analysis`. Some calls 404/422 on private free repos; report which didn't apply instead of failing silently.

## 5. Branch protection ruleset

Do this **after** CI workflow is on `main` (so required check name exists) and after step 1's direct push for new repos.

```bash
sed 's/__CHECK__/check/' assets/ruleset.json > "$TMPDIR/rs.json"
gh api -X POST repos/{owner}/{repo}/rulesets --input "$TMPDIR/rs.json"
```
Blocks deletion and force push of default branch, requires linear history, PR (0 approvals so solo maintainer can merge; raise `required_approving_review_count` and `require_code_owner_review` for teams), resolved review threads, up-to-date `check` status. No bypass actors: admins go through PRs too, which is the point. If ruleset named `protect-main` exists, PUT to its id instead of creating duplicate.

## 6. Signed commits (ask first; skip if declined)

Squash-merges made on GitHub signed by GitHub, so ruleset's `required_signatures` rule only bites direct pushes; value is nobody can push forged-author commits to main. Set up user's side first, otherwise their own pushes get rejected:

1. Check `~/.ssh/*.pub`, `ssh-add -l`, `git config user.email`. Reuse existing ed25519 key if one exists (passphrase fine if loaded in ssh-agent); otherwise `ssh-keygen -t ed25519`.
2. Local config (repo-local; offer `--global`): `git config gpg.format ssh; git config user.signingkey ~/.ssh/id_ed25519.pub; git config commit.gpgsign true; git config tag.gpgsign true`.
3. **User runs** (needs browser; you can't): `gh auth refresh -h github.com -s admin:ssh_signing_key`. Tell them answer `n` to "Authenticate Git with your GitHub credentials?" Then `gh ssh-key add ~/.ssh/id_ed25519.pub --type signing --title "<name> signing"` (you can run this one after refresh). Use `read_terminal` if they say prompt stuck.
4. Make throwaway signed commit on branch, push it, check `gh api repos/{owner}/{repo}/commits/<sha> --jq .commit.verification.verified` is `true`; local `git log --show-signature` saying "No signature" only means no allowed-signers file. Delete test branch. "Unverified" usually means committer email isn't verified email on account.
5. Only then add `{"type":"required_signatures"}` to ruleset (GET it, append rule, PUT it back).

## 7. Wrap up

Tell user what is now enforced, what could not be applied and why, and what is theirs: 2FA on their account (check https://github.com/settings/security; may already have it via org), reviewing Dependabot PRs, adding required reviewers if repo gains collaborators. Remind them any new CI job must be added to ruleset's required checks if it should gate merges.