---
name: uses-repo-template
tags: [behaviour]
runs: 3
max_turns: 6
---
This repo has .github/pull_request_template.md with sections "## What / why" and "## Checklist" (items: "Tests pass", "Docs updated"). I fixed a null-pointer crash in src/parse.ts (empty input made `tokens[0].kind` throw) and ran `npm test`: 14 passed. Branch fix/empty-parse is committed. Open the PR; show me the title and body you would pass to gh instead of running it.
