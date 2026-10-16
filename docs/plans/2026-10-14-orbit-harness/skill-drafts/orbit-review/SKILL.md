---
name: orbit-review
description: "Challenge a submitted result against its acceptance criteria and exact code revision."
---

# orbit-review

Draft v1 for Orbit; not installed or auto-loaded. The activity contract and user authorization take precedence.

Read the activity contract, submitted revision and diff. Verify that the reviewed revision still matches the result.
Look for incorrect behavior, authorization gaps, data loss, concurrency problems and missing regression coverage.
Use targeted checks to confirm concerns. Do not edit the implementation during an independent review.
Locate actionable findings with file, line, impact and a concrete correction. Distinguish confirmed defects from questions.
Return accepted, changes required or unverified with evidence. No findings alone is not proof that every criterion passed.
Risk controls depth: do not launch additional reviewers merely to accumulate opinions.
