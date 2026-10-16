---
name: drops-merged-commits
tags: [behaviour]
runs: 3
max_turns: 6
---
Branch feat/toolbox-create-pr (unpushed) was cut from feat/toolbox-commit-changes. Its log against origin/main shows two commits: d607503 "feat(toolbox): add create-pr skill" and 163fee3 "feat(toolbox): add commit-changes skill". `gh pr list --state merged` shows PR 23 "feat(toolbox): add commit-changes skill" from head feat/toolbox-commit-changes, squash-merged. Open the PR for the branch; describe the exact git and gh commands you would run, in order, instead of running them.
