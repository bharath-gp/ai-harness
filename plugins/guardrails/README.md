# guardrails

Safety and review of Claude's output. Seven mods that stop damage before it happens, catch leaks, learn your preferences, and make Claude's answers easy to audit. Needs Claude Code 2.1.287+.

```
/plugin marketplace add bharath-gp/ai-harness
/plugin install guardrails@ai-harness
```

Every mod is on by default. Turn one off in the plugin config menu (boolean fields `blastRadius`, `secretSentry`, `reflect`, `assumptionTracker`, `selfCritique`, `promptCoach`, `mergeSweep`); the plugin reloads. Mods are not sandboxed: read `hooks/register.tsx` first.

The look follows [claude-flightdeck](https://github.com/scasella/claude-flightdeck), as `cockpit` does: mono text in rounded boxes, each coloured by its role, with `TITLE · state` headers, `▰▱` gauges and a rail that animates while a critique or rewrite runs. Every button also has a hotkey once its pane is focused (ctrl+x tab). Two options: `palette` (`theme` follows your Claude Code theme, `pastel` uses fixed colours for dark terminals) and `motion` (`off` keeps the rails still).

| Mod | Trigger | Commands |
| --- | --- | --- |
| [blast-radius](#blast-radius) | `Bash` tool call | none |
| [secret-sentry](#secret-sentry) | `Write`, `Edit` and `NotebookEdit` tool calls | none |
| [reflect](#reflect) | every prompt you send | `/reflect-queue`, `/reflect-pause` |
| [assumption-tracker](#assumption-tracker) | end of each turn | `/assumptions` |
| [self-critique](#self-critique) | on demand, or each turn | `/critique` |
| [prompt-coach](#prompt-coach) | first prompt of a session | `/sharpen` |
| [merge-sweep](#merge-sweep) | `gh pr create` in `Bash`, then end of each turn | none |

## blast-radius

Holds destructive shell commands until you confirm, and shows what they would hit.

**Matches:** `rm -r/-R/-f` and `--recursive` / `--force`, `git push --force` / `--force-with-lease` / `-f` / `+refspec` / `--delete`, `git reset --hard`, `git clean -f`, `git checkout .` / `git restore .`, `git branch -D`, `mkfs` / `dd if=`, `find ... -delete`, `DROP TABLE` / `DROP DATABASE`.

**Use:** nothing to do. When Claude runs one of these, a three-row `BLAST RADIUS` card appears above a Proceed/Cancel dialog: the verb with the file count and size, whether git can restore them, and the biggest folder with its share of the size. The dialog leaves 12 rows, its own included. It covers the files affected (for `rm`, the targets; for discards, everything uncommitted), their total size, and how many are untracked and so unrecoverable from git. Pick the proceed option (`Delete N files`, `Discard N files`, `Proceed`) or `Cancel`. Cancel denies the call and Claude is told you declined.

**Limits:** `rm` targets are parsed plainly (no globs or quoting tricks); scanning stops at 3000 files. In non-interactive runs (`-p`) nobody can answer, so the command is refused.

## secret-sentry

Blocks Claude from writing credentials into files.

**Detects:** AWS access keys, Anthropic and OpenAI-style API keys, GitHub tokens, Slack tokens, PEM private keys, and hard-coded `api_key` / `secret` / `token` / `password` assignments with long string values.

**Use:** nothing to do. A matching `Write`, `Edit` or `NotebookEdit` is denied with a message telling Claude to read the value from an env var; a toast and a status-line counter (`secret-sentry · N blocked`) tell you it fired. `.env`, `.env.*`, `*.example` and `*.sample` files are exempt, since that is where secrets belong or placeholders live. Secrets written through Bash (`echo ... > file`, heredocs) are not scanned.

**Limits:** it checks file writes only, not shell commands or what Claude prints.

## reflect

Turns your corrections into permanent rules.

**Use:** just work normally. Each prompt (up to 500 characters, excluding slash commands and replies like "ok") is classified by Haiku: if it states a durable preference ("use pnpm not npm", "never mock the db") a **Rule found** band appears above the prompt with the rule and its scope.

- `Save` writes it to the suggested scope.
- `Global instead` / `This repo instead` writes it to the other scope.
- `Skip` discards it.

Repo rules go to `./CLAUDE.md`, global rules to `~/.claude/CLAUDE.md`, both under a `## Learned rules` section between `reflect:start` / `reflect:end` markers. Prefix a prompt with `remember: ...` to queue a rule explicitly, with no classification.

**Commands:** `/reflect-queue` lists pending rules with scope and repeat count; `/reflect-pause` toggles detection off and on.

Do not run this alongside the Python claude-reflect plugin.

## assumption-tracker

Surfaces what Claude decided without asking.

**Use:** after each answer, Haiku lists up to 8 assumptions Claude made that you did not specify (defaults, resolved ambiguities, scope calls). A band says "Claude made N assumptions"; press `Review` (hotkey `0`) or run `/assumptions` to open the panel. Mark each **Right** or **Wrong**, or press its number (`1`-`8`) to cycle unreviewed, right and wrong. When any are wrong, `Fix N wrong` (hotkey `f`) sends Claude a prompt to redo only the parts that depend on them, while keeping the ones you marked right. `×` on the band dismisses the list.

## self-critique

A second opinion on Claude's last answer.

**Use:** run `/critique` to open a panel with a verdict (strong, mixed or weak), strengths, and flaws. Each flaw has a `Make this fix` button (hotkey: its number) that sends Claude a prompt to repair it. Panel buttons: `Rerun` (`r`), `Auto on/off` (`a`, critique every answer automatically) and `Model` (`m`, cycles `session`, `opus`, `sonnet`, `haiku`). A rail runs under the header while the critique is being written.

**Arguments:** `/critique auto` toggles auto-critique; `/critique opus|sonnet|haiku|session` picks the reviewing model, then critiques.

## prompt-coach

Rewrites your first prompt so the main session grills you before it starts.

**Use:** when you send the first prompt of a session (any length; a first `/command` or skill prompt counts, plugin-sent prompts do not) it is held and the `Prompt coach` pane shows one improved prompt (role, goal, context, requirements, constraints, out of scope, acceptance criteria, output format). It always includes a "Before you start" section telling the main session to ask you, one question at a time, about every ambiguity and unclear requirement before doing any work. `Use in prompt box` (`u`) puts it in the prompt input to edit and send, `Copy` (`c`) copies it, `Request changes` (`e`) regenerates it from your note, `Dismiss` (`d`) sends your original unchanged; `Retry` (`r`) after a failure. A first prompt that starts with `/command args` keeps that line verbatim at the top of the rewrite, and the rewrite takes the skill into account. A first prompt with attachments is sent as typed and the pane only offers the improved text. The coach never auto-triggers after the first prompt: a per-session flag in `$.state` (keyed by session id) is set on that prompt however you answer it, so later messages, a reload or a dismissal never re-arm it. If no surface can draw a pane, the prompt is sent as is.

**Commands:** `/sharpen [prompt]` coaches any prompt at any time, whatever the flag says. With no text it uses the current prompt input, then your last message.

**Context:** the coach sees your prompt, `CLAUDE.md` and the top-level file names only. It asks you nothing itself.

## merge-sweep

Offers to clean up branches and worktrees once a PR you opened in this session is merged.

**Use:** when a `Bash` call runs `gh pr create` and succeeds, the PR URL is saved in `$.state` for the session. After each turn the mod runs `gh pr view <url>` for each saved PR (a failed call, for example offline, is retried next turn). When one is `MERGED` a band appears above the prompt: `Clean up` (`c`) or `Dismiss` (`d`). Either one removes the PR from the list, so it is not offered again.

**Clean up** works on the PR's head branch only and never forces:
- If the branch is checked out in the main checkout, it runs `git switch <base>` first. The base branch is then pulled with `git pull --ff-only` whenever the main checkout is on it.
- A linked worktree on the branch is removed with `git worktree remove` (no `--force`).
- The local branch is deleted with `git branch -D` only when its tip equals the PR's `headRefOid`, so squash and rebase merges work and later local commits are never lost.
- The remote branch is deleted from `origin` only when it still points at `headRefOid`, and never for a PR from a fork.
- Anything git refuses, a branch with later commits, a worktree you are standing in (with the command to run later) or a failed switch or pull is kept and listed in a toast.

**Shares the `Bash` hook with blast-radius:** the bundle registers one `Bash` hook that chains both; `mergeSweep: false` turns this mod off without touching blast-radius.

**Context:** needs `gh` signed in and `git`. The remote is assumed to be `origin`.

## Develop

Source: `hooks/register.tsx`, one `// ===== <mod> =====` section per mod, wired in the `register` function at the bottom. Shared UI is copied from `shared/` by `./scripts/sync-ui.sh`.

```
claude plugin validate plugins/guardrails
claude plugin test plugins/guardrails
```
