---
type: llm
criteria: pr-flow-and-pinning
---
The plan must (1) deliver the new files on a branch via a pull request, never by pushing straight to main; (2) pin third-party GitHub Actions to commit SHAs; (3) apply the branch-protection ruleset only after the CI workflow exists on main, with the required check name matching the CI job; (4) mention secret scanning/push protection. Missing any of these fails.
