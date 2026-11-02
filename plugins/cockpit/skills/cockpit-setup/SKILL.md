---
name: cockpit-setup
description: Walks the user through configuring the cockpit plugin, on first use or later. Turns mods on or off and sets the pane layout, width, opening on start, agent cards, architect pattern and labels, and the palette and motion. Use when the user says "set up cockpit", "configure cockpit", "turn off next-steps", "make the cockpit pane wider", "cockpit settings", or asks how to change what the pane shows.
---
# Set up cockpit

Read the current values, ask one question at a time, then save only what changed with `claude plugin configure`. Never edit `settings.json` by hand.

## 1. Read the current state

```bash
claude plugin configure cockpit@ai-harness --json
```

- `schema` holds every option with its title, description, default and choices. `inputs` holds the current values as strings; an empty string means the default applies. `unconfigured` lists the options never set.
- If the id is not found, run `claude plugin list` and use the `cockpit@<marketplace>` id it shows. If `claude` is not on PATH (some desktop installs), tell the user to run `/plugin configure cockpit@ai-harness` instead and stop.
- First run: every option is in `unconfigured`. Then walk through every area below in order. Otherwise ask which area to change.

## 2. Ask, one question per AskUserQuestion call

Ask each question on its own and wait for the answer. Show the current value in each question. Put the current value or the default first, marked "(Recommended)" when it is the default. The user can always type "Other" for a custom value.

Unless this is the first run, start with: "What do you want to set up?" Options: Mods on or off, Pane, Architect, Look (palette and motion). Pick "Everything" from Other.

### Mods on or off

Ask four multi-select questions, "Which of these should stay on?", one per group. Each option is a mod title with its schema description. Selected mods are `true`, the rest `false`.

1. Activity: `agentsProgress`, `turnReceipt`, `sessionLog`, `loops`.
2. Bands: `cacheKeeper`, `contextHealth`, `usageLimits`, `nextSteps`.
3. Panels: `filetree`, `architect`, `permissionGate`, `decisions`.
4. Status line: `tokenMeter`, as a yes-or-no question.

If `decisions` stays on and the guardrails plugin is not installed (`claude plugin list`), say that the panel stays empty without guardrails' decision mods.

### Pane

1. `openOnStart`: `true` or `false`. Claude Code seats the pane unasked only in terminals 144 or more columns wide.
2. `layout`: `auto` (default), `compact`, `wide`, `mini`.
3. `paneColumns`: 66 (default), 50, 80. At least 40; a width the user dragged the pane to wins.
4. Only if `agentsProgress` is on, `maxCards`: 3 (default), 2, 4. Range 1-6; more agents switch to swimlanes.

### Architect

Skip this area when `architect` is off.

1. `architectPattern`: `advisor|architect` (default), or a custom case-insensitive regular expression typed as Other. Check that it compiles before saving.
2. `matchDescriptions`: `false` (default) or `true`.
3. `moments`: `true` (default) or `false`.
4. Ask only when the user wants it: `architectLabel` (default `ARCHITECT`) and `gateLabel` (default `GATE`).

### Look

1. `palette`: `theme` follows the Claude Code theme; `pastel` uses fixed colours for dark terminals.
2. `motion`: `while-active` or `off`.

## 3. Confirm and save

1. List each option that changes as `name: old -> new`. If nothing changes, say so and stop.
2. Ask: "Save these changes?" Options: Save, Change something.
3. Save only the changed options. Every value is a single-line string, booleans and numbers included:
   ```bash
   echo '{"nextSteps":"false","paneColumns":"80"}' | claude plugin configure cockpit@ai-harness --values-stdin
   ```
4. Read the values back with `--json` and check that each change landed. Tell the user to run `/reload-plugins` or restart Claude Code to apply them.
