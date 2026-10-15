# ai-harness

Claude Code plugin marketplace (`.claude-plugin/marketplace.json`, name `ai-harness`). Two bundle plugins, `plugins/guardrails` and `plugins/cockpit`, each mod is a `// ===== <mod> =====` section of the bundle's `hooks/register.tsx`; each mod has a boolean `userConfig` toggle. See README.md for install and dev commands.

## Rules for editing mods
- Shared UI lives in `shared/`; after editing run `./scripts/sync-ui.sh` and commit the copies in each `plugins/*/hooks/`.
- Every function that takes `$` must be declared in `register.tsx` itself: Claude Code older than 2.1.300 (the CLI bundled with the desktop app) refuses to follow `$` into an imported function, so the module does not load. Only `$`-free helpers (`ui.ts`, `band.tsx`, `kit.tsx`) are imported. Top-level names must be unique across a bundle's mod sections.
- A plugin may not register the same event+matcher twice: wire hooks in the bundle's `register.tsx`, one `on(...)` per event+matcher, chaining mods that share it and honouring `options.<mod> === false`.
- Mod hooks and every helper that takes `$` are exported/plain `function` declarations (arrows fail validation). Add a new mod as a section of `register.tsx`, wire it there, and add a `userConfig` field.
- Shared helpers take `ui = $.ui.resolve(e)` and `e`; callbacks that close over `$` are built in `register.tsx`.
- Never name a local variable `h` in a file with JSX: it shadows the JSX factory, every render throws and the engine draws an empty "Nothing to show yet" pane.
- AbovePrompt is one shared strip: a band hook must return what `await below(next, e)` drew beneath it, or it hides other mods' bands.
- `Text` takes no `key`. A `Button` with `Text` children needs a `key`; Button children are strings or `Text` only.
- Module-level variables reset on every hot reload; `$.state` survives.
- `e.args` can be undefined on a bare slash command: use `(e.args ?? '').trim()`.
- Tests: no `$.ui.mount`; use `$.ui.render({surface, component, requestId, props})` and mock `model.complete` etc. with `on(...)` returning `{ value }`.
- Run `claude plugin validate` and `claude plugin test` on every touched bundle.

## Learned rules
<!-- reflect:start -->
- Keep the look and feel of all mods as similar as possible, including the same colour scheme and fonts.
<!-- reflect:end -->
