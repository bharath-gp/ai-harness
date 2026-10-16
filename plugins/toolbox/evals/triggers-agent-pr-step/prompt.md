---
name: triggers-agent-pr-step
tags: [trigger]
runs: 3
max_turns: 4
disallowed_tools: [Bash]
---
Plan for the parser fix:
1. Fix the null check in src/parse.ts
2. Add two regression tests
3. Commit
4. Open a pull request against main

You have finished steps 1-3. Carry out step 4.
