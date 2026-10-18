import type { AgentCli } from '@orbit/protocol'

/** Capability policy is independent of a task's scope, routing and MCP visibility. */
export const AGENT_PERMISSION_POLICY = 'writable-bypass-v1'
export const AGENT_PERMISSION_NOTE = 'Orbit process permissions: file writes, edits and command execution are enabled by default. Any earlier Orbit read-only process restriction is superseded on this launch. Task scope, user instructions, account credentials, tool availability and operating-system/service restrictions still apply. This policy grants no new task and does not authorize unsolicited external messages or purchases.'

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
