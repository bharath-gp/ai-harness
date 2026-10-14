# ai-harness

Claude Code plugin marketplace (`.claude-plugin/marketplace.json`, name `ai-harness`). One mod per `plugins/<mod>/`. See README.md for install and dev commands.

## Rules for editing mods
- Shared UI lives in `shared/`; after editing run `./scripts/sync-ui.sh` and commit the copies in each `plugins/*/hooks/`.
- `$` can never be passed to a function imported from another file. Shared helpers take `ui = $.ui.resolve(e)` and `e`; callbacks that close over `$` are built in `register.tsx`.
- Never name a local variable `h` in a file with JSX: it shadows the JSX factory, every render throws and the engine draws an empty "Nothing to show yet" pane.
- AbovePrompt is one shared strip: a band hook must return what `await below(next, e)` drew beneath it, or it hides other mods' bands.
- `Text` takes no `key`. A `Button` with `Text` children needs a `key`; Button children are strings or `Text` only.
- Module-level variables reset on every hot reload; `$.state` survives.
- `e.args` can be undefined on a bare slash command: use `(e.args ?? '').trim()`.
- Tests: no `$.ui.mount`; use `$.ui.render({surface, component, requestId, props})` and mock `model.complete` etc. with `on(...)` returning `{ value }`.
- Run `claude plugin validate` and `claude plugin test` on every touched mod.

## Learned rules
<!-- reflect:start -->
- Keep the look and feel of all mods as similar as possible, including the same colour scheme and fonts.
<!-- reflect:end -->
