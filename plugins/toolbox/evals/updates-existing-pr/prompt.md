---
name: updates-existing-pr
tags: [behaviour]
runs: 3
max_turns: 6
---
Branch fix/empty-parse already has open PR 31, titled "fix(parse): reject empty input", with this body (you may treat it as read; do not re-fetch it):

## What / why
Empty input made `tokens[0].kind` throw in src/parse.ts; parse now returns an error instead.
**Verification:** `npm test`: 14 passed.

## Checklist
- [x] Tests pass
- [ ] Docs updated

Since then I committed "fix(parse): also reject whitespace-only input" and ran `npm test`: 17 passed. Do the PR step; give the exact git and gh commands you would run, in order, and the new body text, instead of running them.
