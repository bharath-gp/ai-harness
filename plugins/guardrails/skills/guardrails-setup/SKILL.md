---
name: guardrails-setup
description: Walks the user through configuring the guardrails plugin, on first use or later. Turns mods on or off, checks Ollama and picks the local decision models, sets the decision threshold and timeout, the subagent models and the palette and motion. Use when the user says "set up guardrails", "configure guardrails", "turn off blast-radius", "change the decision model", "guardrails settings", or asks why the decision mods do nothing.
---
# Set up guardrails

Read the current values, ask one question at a time, then save only what changed with `claude plugin configure`. Never edit `settings.json` by hand.

## 1. Read the current state

```bash
claude plugin configure guardrails@ai-harness --json
```

- `schema` holds every option with its title, description, default and choices. `inputs` holds the current values as strings; an empty string means the default applies. `unconfigured` lists the options never set.
- If the id is not found, run `claude plugin list` and use the `guardrails@<marketplace>` id it shows. If `claude` is not on PATH (some desktop installs), tell the user to run `/plugin configure guardrails@ai-harness` instead and stop.
- First run: every option is in `unconfigured`. Then walk through every area below in order. Otherwise ask which area to change.

## 2. Ask, one question per AskUserQuestion call

Ask each question on its own and wait for the answer. Show the current value in each question. Put the current value or the default first, marked "(Recommended)" when it is the default. The user can always type "Other" for a custom value.

Unless this is the first run, start with: "What do you want to set up?" Options: Mods on or off, Local decision models, Look (palette and motion), Everything.

### Mods on or off

Ask three multi-select questions, "Which of these should stay on?", one per group. Each option is a mod title with its schema description. Selected mods are `true`, the rest `false`.

1. Safety: `blastRadius`, `secretSentry`, `mergeSweep`.
2. Review: `reflect`, `assumptionTracker`, `selfCritique`, `promptCoach`.
3. Local decision models: `decisionGate`, `autoAnswer`, `modelPicker`.

`mergeSweep` needs `gh` signed in: if it stays on, run `gh auth status` and say so if it fails. If `reflect` stays on, tell the user not to install the Python claude-reflect plugin as well.

### Local decision models

Skip this area when `decisionGate`, `autoAnswer` and `modelPicker` are all off.

1. Check Ollama at `ollamaUrl` (default `http://localhost:11434`):
   ```bash
   curl -s --max-time 3 http://localhost:11434/api/tags
   ```
   Decision models are the entries whose `capabilities` include `decision`.
2. Ollama not answering: say the three mods fall back to normal behaviour without it. Ask: keep them on, turn them off, or change the Ollama URL. Do not install Ollama yourself.
3. No decision model installed: ask whether to pull one (for example `tev1:4b`, small and fast). Pulling downloads several GB, so state the model name and ask before running `ollama pull <model>`.
4. Fast tier (`fastModel`): options are "Picked by the benchmark (Recommended)", which saves an empty string, plus up to three installed decision models, smallest first. Strong tier (`strongModel`): the same, largest first.
5. `decisionThreshold`: 0.85 (default), 0.75 (more automatic), 0.95 (asks you more). The mods clamp it to 0.5-1.
6. `decisionTimeoutMs`: 3000 (default), 1500, 6000.
7. Only if `modelPicker` is on, `subagentModels`: `haiku,sonnet,opus` (default), `haiku,sonnet`, `sonnet,opus`. Cheapest first, comma-separated.
8. Ask only when the user wants it: `benchEveryDays` (30 default, 7, 90). To re-run the benchmark now, tell them to run `/decide-bench`, or save `benchNonce` as the current timestamp.

### Look

1. `palette`: `theme` follows the Claude Code theme; `pastel` uses fixed colours for dark terminals.
2. `motion`: `while-active` or `off`.

## 3. Confirm and save

1. List each option that changes as `name: old -> new`. If nothing changes, say so and stop.
2. Ask: "Save these changes?" Options: Save, Change something.
3. Save only the changed options. Every value is a single-line string, booleans included:
   ```bash
   echo '{"blastRadius":"false","decisionThreshold":"0.9"}' | claude plugin configure guardrails@ai-harness --values-stdin
   ```
4. Read the values back with `--json` and check that each change landed. Tell the user to run `/reload-plugins` or restart Claude Code to apply them.
