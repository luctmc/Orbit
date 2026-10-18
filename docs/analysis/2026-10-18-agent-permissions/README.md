# F-164 — Default agent capabilities

Baseline: origin/main d8459d0, installed release v0.2.28. Implementer receipt: codex-acc-2 / pane-190. Official checkout retained at the user's explicit request; branch and shared file reservation used without creating a worktree.

## Proven cause

This was not inferred from the model's refusal. The actual Orbit state had leader #54 and investigator #56 with readOnly=true execution policies. Investigator #56 also persisted readOnly=true / requireReadOnlySandbox=true in its launch specification. Process inspection confirmed both Node launchers and both native Codex children had `-s read-only -a never` arguments. Their native turn-complete receipts were present. Thus the physical read-only sandbox was real.

core.spawn previously coupled task/role scope and agentic/squad leadership to the physical sandbox. command.ts replaced the v0.2.23 bypass default for those launches. restart/recovery reused the restriction, and Claude/Gemini hooks independently denied edits.

## Change

agentPermissions.ts is the central capability policy. All agent launches/resumes use provider-native bypass arguments regardless of historical sandbox hints; login and shell entry points are unchanged. Claude receives sandbox.enabled=false in its per-pane settings. Gemini and Antigravity now receive their documented auto-approval flags. No user credential/config file is rewritten.

Assignment readOnly remains scheduling/scope metadata, explicitly documented as distinct from native capability. Review/investigation still describe their requested deliverable; this no longer disables writes or commands. Existing writer conflict prevention remains. Promotion updates scheduling intent to orchestrator while preserving the process and its capability policy, so future workers can be admitted.

All reopen/restart/recovery paths converge on spawn. The same session/account/id and durable assignment survive native resume; only a one-time policy correction is sent to legacy conversations. It grants no new task and does not replay old requests. New-policy resumes do not repeat the correction. No session history is edited.

Budget gates, disabled tools/skills, explicit provider/account choices, auth checks, MCP profiles, plugin sandbox/grants and daemon/PTYS/history/queues remain independent. Default capability does not authorize external messages, purchases, or remove macOS/provider restrictions.

## Evidence

Before the implementation, the new legacy flag regression failed with actual `codex -s read-only -a never`; the mission regression failed with actual sandbox `read-only`. After implementation both passed. The added real-PTY fixture executes the actual shell command/profile helper, checks the bypass argument, writes a file and invokes a child process, then recovers a synthetic legacy conversation through core/WebSocket/PTY with the same account/session and no assignment replay. Fixtures never contact providers or read user credentials.

A separate real Codex 0.163.0 probe used the current Codex 2 environment, `codex exec --ephemeral --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check -m gpt-6-luna -c model_reasoning_effort=\"low\" --json`, in a temporary workspace. It exited 0 and wrote/read permission-proof.txt = orbit-writable. Its private raw provider log stays outside Git. This is separate from deterministic fixture evidence.

Validation: typecheck all workspaces; 373 sidecar tests + 49 desktop tests passed before the final scheduling-promotion extension; targeted permissions/orchestration 9/9 passed afterwards. agent:finish repeats the entire validation before merge. Recorded logs cover the PTY journey and typecheck. The installed app/release/runtime migration are distinct delivery gates and are recorded separately after completion.

## Primary flag references

Installed CLI help was checked for Codex 0.163.0 fresh/resume/exec, Claude, Gemini and agy. Relevant native flags: Codex --dangerously-bypass-approvals-and-sandbox; Claude --dangerously-skip-permissions; Gemini --sandbox=false --approval-mode yolo; agy --sandbox=false --dangerously-skip-permissions. Login routes retain their provider-specific commands; translation/classification helpers keep their deliberately tool-free/read-only scope because they only transform text.

- https://developers.openai.com/codex/cli/reference/
- https://code.claude.com/docs/en/permissions
- https://geminicli.com/docs/cli/headless/

## Existing daemon migration

v0.2.28's persistent daemon refuses upgrades while PTYs exist. Installing an app alone cannot change an existing process sandbox. Migration must establish completed native turns and idle recoverable sessions, preserve state/history/credentials, and gracefully stop the identified old engine before the new installed engine automatically resumes the same sessions. Active/uncertain work must not be terminated. No blind PID/name kill or replay is allowed. Installation is not claimed complete merely because CI publishes an archive.
