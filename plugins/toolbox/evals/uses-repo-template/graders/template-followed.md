---
type: llm
criteria: "The final message contains a proposed PR body whose only markdown headings are '## What / why' then '## Checklist' (bold labels inside sections are fine), whose What / why section states the cause (empty input, tokens[0] access) and the fix, that records the npm test result (14 passed), with 'Tests pass' ticked and 'Docs updated' unticked or N/A, plus a conventional-commits-style title of at most 72 characters. Caveats outside the body do not count against it."
---
