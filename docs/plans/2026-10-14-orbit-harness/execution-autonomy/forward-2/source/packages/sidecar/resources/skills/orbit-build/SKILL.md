---
name: orbit-build
description: "Implement one activity within its write scope and verify the resulting behavior."
---

# orbit-build

The activity contract and user authorization take precedence.

Read the activity contract and relevant local instructions. Stay inside its write scope.
For a defect, reproduce the symptom and identify its cause before changing code. Add a meaningful failing regression.
Make the smallest coherent change that satisfies the acceptance criteria. Preserve unrelated local edits.
Run the checks that prove the changed behavior, then the required project checks. Read exit codes and failures.
If blocked, submit the blocker and evidence; do not claim completion. Reuse the same activity for corrections.
Submit a summary, exact changed revision/diff, check commands and outcomes, and any material limitation.
A commit or external write follows the activity authorization; do not expand scope to ship unrelated changes.
