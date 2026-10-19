# T1 review correction — cb1a863f

The original result1d6de6a4 was independently rejected by #80 at8086b09. The rejection remains historical; this follow-up requires a new result and inspection.

Root cause: missionSignal already returned review for stale/unknown integration or pending required validation, but MissionView excluded review from its inline attention filter. Exact reproduction used the real fixture with integration stale and the reviewer reason: Source changed; new independent review required. Before: attentionVisible=false, detailsOpen=false, hidden status=Revisão final precisa ser conferida. New browser regression was run red before changing production code.

Minimal production correction: MissionView.tsx:90 derives reviewRequiresAttention for required review, preserving the existing action to open activities. Current valid review awaiting completion remains informational in Visualizar. Waiting/blocked/offline/error behavior is unchanged.

The added real-browser regression covers stale, unknown, awaiting_validation, accepted with missing validation, accepted with invalid validation, plus valid-current informational control, at1280 and375px. All ten required state/viewport combinations now expose visible attention with a working action to activities; both informational combinations stay compact. No horizontal overflow. review-before/after-checks.json contain the exact12 observations; review-before/after-1280.png and375.png plus DOM provide visual evidence.

Fresh commands/exits are in review-fix.json: red regression exit1 before fix; full composer/browser regression2/2 exit0; desktop50/50 exit0; all-workspace typecheck exit0; frontend build exit0; git diff --check exit0. Prior399 sidecar tests were not repeated because no backend source changed. The build retains its main-chunk-size warning. Mission browser tools also confirmed desktop/narrow visual state and Ver atividades opening the panel. No relevant app console error appeared; the fixture favicon404 remains test-only.

Only MissionView, its existing browser test/fixture, and necessary evidence changed in the same reserved worktree. Source hashes are recorded. Native popup keyboard option selection remains explicitly unverified. No push/merge/release/native installation was performed; /Applications/Orbit.app stays0.2.33 pending acceptance/integration. The own fixture server was stopped; worktree retention/cleanup remains as agreed.
