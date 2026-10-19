# T-002 / T-003 — Coordination efficiency

Base: origin/main a7bdbed. Offline fixtures use real core, Store, PTYs and authenticated MCP with synthetic agent commands; no provider/model requests.

## Cause and change

`sendTo` treated every lead message as an assignment, clearing final handoff/readiness and potentially creating another obligation. `newTask` now defaults false; ACK/wait/questions preserve activity, delivery and readiness. Only the current lead can explicitly assign new helper work. Authorization precedes submission or interrupt; interrupt with instructions retains explicit reassignment.

Implicit helper resume previously injected “continue” even after final delivery. Current final done/auto status without a pending/progress/blocked work obligation now returns an actionable handoff_list/newTask error, including legacy state without ActivityResult. Automatic fallback remains unverified: this change does not accept its result or waive its delivery gate. Explicit messages can assign work; unfinished/progress recovery remains available.

Stop hook previously trusted stop_hook_active to bound nudges. The local per-assignment set now also guards blocking hooks: one nudge, then automatic delivery retaining last-message evidence. Progress continues to gate completion without extra nudges. The set resets on assignment; it is local to the running sidecar, not persistent across process restarts.

Prompts retain independent review and acceptance/integration gates. Executors check affected behavior, reviewers check the delta and reuse same-revision evidence; required full suite/build runs at integration and repeats for relevant changes, failures or new risks. AGENTS and CI requirements still apply. ACK/readiness requires no specialist. Existing prompt limits remain unchanged (lead <=6000, reviewer <=2800 bytes).

## RED / GREEN evidence

- `npm ci`: exit 0.
- RED before production edits: `node --test packages/sidecar/test/coordinationEfficiency.test.ts`: exit 1, 0/4 passed. Observed done cleared; pending activity updated by ACK; implicit final resume not rejected; repeated false/absent Stop flag blocked again.
- RED before prompt edits: `node --test packages/sidecar/test/promptBudget.test.ts`: exit 1, 1/2 passed; missing explicit newTask/proportional-check contract.
- GREEN: `node --test packages/sidecar/test/promptBudget.test.ts packages/sidecar/test/coordinationEfficiency.test.ts packages/sidecar/test/taskContinuity.test.ts packages/sidecar/test/delivery.test.ts packages/sidecar/test/mcp.test.ts packages/sidecar/test/accountDelegation.test.ts packages/sidecar/test/executionEpoch.test.ts packages/sidecar/test/deliveryObligations.test.ts`: exit 0, 52/52 passed.
- `npm run typecheck -w @orbit/sidecar`: exit 0.
- `git diff --check`: exit 0.

## Deterministic effects and limits

For a completed helper receiving three informational messages, assignment calls change from three to zero; final handoff, activity history and readiness remain unchanged. One explicit newTask creates exactly one assignment and one new pending obligation. Unauthorized assignment sends zero messages. An implicit final resume launches zero processes, while explicit work and progress recovery remain possible. For three Stop events with missing/false active flag, blocking nudges change from three to one and one automatic fallback preserves the last message. These are fixture counts, not measured production savings.

Models, quotas, latency, actual token consumption and percentage savings were not measured. Tool schema changes add one boolean; no schema/token savings are claimed. No model, effort, budget or bypass defaults changed. No full suite, build, installation, push or merge was run here; the coordinator owns integration validation and the installed app update. Generated prompt changes apply to new sessions; already-open native sessions retain their earlier instructions.
