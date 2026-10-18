import type { AgentCli } from '@orbit/protocol'

/** Capability policy is independent of a task's scope, routing and MCP visibility. */
export const AGENT_PERMISSION_POLICY = 'writable-bypass-v2'
export const AGENT_PERMISSION_NOTE = 'Orbit process permissions: file writes, edits and command execution are enabled by default. Any earlier Orbit read-only process restriction is superseded on this launch. Proceed with actions necessary to complete the user’s request without asking again for permissions already granted. Resolve routine operational blockers autonomously: use an independent branch/worktree and unclaimed files when another agent owns a reservation; inspect actual ownership and coordinate instead of asking the user to take over another agent’s files. A repository reservation is coordination, not a missing process permission. Never claim that a CLI bypass overrides project instructions or grants macOS privacy entitlements, root privileges, provider access or credentials. Task scope, user instructions, account credentials, tool availability and operating-system/service restrictions still apply. This policy grants no new task and does not authorize unsolicited external messages or purchases.'

/** Only agent executions use these flags; login and shell entry points remain untouched. */
export function agentPermissionArgs(cli: AgentCli): string[] {
  switch (cli) {
    case 'codex': return ['--dangerously-bypass-approvals-and-sandbox']
    case 'claude': return ['--dangerously-skip-permissions']
    case 'gemini': return ['--sandbox=false', '--approval-mode', 'yolo']
    case 'antigravity': return ['--sandbox=false', '--dangerously-skip-permissions']
    default: return []
  }
}
