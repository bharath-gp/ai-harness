# ai-harness

Claude Code plugin marketplace (`.claude-plugin/marketplace.json`, name `ai-harness`). Three plugins in `plugins/`: `guardrails` and `cockpit` are mod bundles (each mod is a `// ===== <mod> =====` section of `hooks/register.tsx`, toggled by a boolean `userConfig` field); `toolbox` holds skills. README.md has install and dev commands.

## Editing mods
- Every function that takes `$` is declared in `register.tsx` itself, as a plain `function` declaration (no arrows, which fail validation). Claude Code older than 2.1.300 (the desktop app's CLI) will not follow `$` into an imported function, so the module fails to load. Only `$`-free helpers (`ui.ts`, `band.tsx`, `kit.tsx`) are imported. Top-level names are unique across a bundle's sections.
- Shared helpers take `ui = $.ui.resolve(e)` and `e`; callbacks that close over `$` are built in `register.tsx`.
- Shared UI lives in `shared/`. After editing it run `./scripts/sync-ui.sh` and commit the copies in each `plugins/*/hooks/`.
- Wire hooks in `register.tsx`: one `on(...)` per event+matcher (a plugin may not register one twice), chaining mods that share it and honouring `options.<mod> === false`.
- Slash command names must not collide with another plugin's: `/handoff` was refused because another plugin owned it.
- `rail.tsx` and `elapsed.tsx` are surface modules drawn with `<ui.Client module="./rail.tsx" />`. The path is a literal in `register.tsx`, so draw them there (`rail`, `liveClock`) and fall back to still text when `Client` is missing or `ui.fault` named the module.
- AbovePrompt is one shared strip: a band hook returns what `await below(next, e)` drew beneath it, or it hides other mods' bands.
- Module-level variables reset on every hot reload; `$.state` survives.
- `e.args` can be undefined on a bare slash command: use `(e.args ?? '').trim()`.

## UI
- All mods share one look, following claude-flightdeck: colours come from `C`/`P` in `ui.ts` (theme names swapped by `usePalette`, never hex), the same fonts and layout everywhere. Build no colour tables at module load, because `usePalette` runs in `register`.
- Calm by default: a one-line summary, with detail on click. A band appears only when something needs the user. Dismiss is an `x`, not the word "dismiss".
- A mod must work in both the terminal and the desktop app. Check with `claude --plugin-dir plugins/<bundle>` and say what you could not see in the desktop app.
- AskUserQuestion trees take no width or height and at most 12 terminal rows, the dialog's own included.
- Never name a local variable `h` in a file with JSX: it shadows the JSX factory and every render throws, leaving an empty "Nothing to show yet" pane.
- `Text` takes no `key`. A `Button` with `Text` children needs a `key`; Button children are strings or `Text` only.

## Tests
- No `$.ui.mount`: use `$.ui.render({surface, component, requestId, props})` and mock `model.complete` etc. with `on(...)` returning `{ value }`.
- Run `claude plugin validate` and `claude plugin test` on every touched bundle.

## Docs and versions
- When a mod or skill is added, changed or removed, update in the same change: the plugin's `description` in `plugins/<name>/.claude-plugin/plugin.json` and the matching entry in `.claude-plugin/marketplace.json` (kept identical; the plugin page shows these, not the README), `plugins/<name>/README.md`, and the root README table. Bump the plugin `version` (patch for docs and fixes) so installed copies refresh. A new mod also needs its `userConfig` field.
- A description is one purpose sentence plus the mod or skill names, slash commands only where a mod has one. Triggers and detail go in the plugin README.
- READMEs hold an intro, install, a mod/skill table with triggers and commands, and config options. No per-mod deep dives.

## Workflow
- `main` is protected: work on a branch, open a PR, squash-merge. Commits are signed.
- Commit with the `toolbox:commit-changes` skill and open PRs with `toolbox:create-pr`, so the repo's PR template is filled.
- After the user says a PR is merged, switch to `main`, pull, and delete that PR's local branch, remote branch and worktree. Keep anything unsafe and report it.
- Use `pnpm`, never `npm` or `yarn`.

## Learned rules
- Keep the look and feel of all mods as similar as possible, including the same colour scheme and fonts.
