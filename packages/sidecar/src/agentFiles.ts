import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentCli, Effort } from '@orbit/protocol'
import { shellQuote, type AgentLaunch } from './command.ts'

/** Claude Code events that move a pane's status. */
const HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Notification', 'Stop'] as const

export interface AgentFilesInput {
  paneDir: string
  cli: AgentCli
  model: string | null
  effort: Effort | null
  /** Workspace folders besides the main one (the agent's cwd). */
  addDirs?: string[]
  endpoint: string
  token: string
  hookCommand: string
  rolePrompt: string | null
  task: string | null
}

/**
 * Writes the per-pane files an agent CLI is launched with: MCP config and hook settings for
 * Claude, role and task prompts for both. Everything is private to the user (0600).
 */
export function writeAgentFiles(input: AgentFilesInput): AgentLaunch {
  const { paneDir, cli } = input
  mkdirSync(paneDir, { recursive: true, mode: 0o700 })
  const write = (name: string, content: string) => {
    const path = join(paneDir, name)
    writeFileSync(path, content, { mode: 0o600 })
    return path
  }

  const launch: AgentLaunch = { cli, model: input.model, effort: input.effort, addDirs: input.addDirs ?? [] }
  if (cli === 'shell') return launch

  if (input.rolePrompt) launch.rolePromptPath = write('role.md', input.rolePrompt)
  if (input.task) launch.taskPath = write('task.md', input.task)

  if (cli === 'claude') {
    launch.mcpConfigPath = write('mcp.json', JSON.stringify({
      mcpServers: { orbit: { type: 'http', url: `${input.endpoint}/mcp`, headers: { Authorization: `Bearer ${input.token}` } } },
    }, null, 2))
    const hook = { type: 'command', command: input.hookCommand, timeout: 5 }
    const hooks = Object.fromEntries(HOOK_EVENTS.map((event) => [
      event,
      [event === 'PreToolUse' || event === 'PostToolUse' ? { matcher: '*', hooks: [hook] } : { hooks: [hook] }],
    ]))
    // Orbit's own tools only coordinate agents inside the mission; asking for each handoff or
    // spawn would stall every agent running in manual permission mode.
    const permissions = { allow: ['mcp__orbit'] }
    launch.settingsPath = write('settings.json', JSON.stringify({ permissions, hooks }, null, 2))
  } else {
    launch.mcpUrl = `${input.endpoint}/mcp`
  }
  return launch
}

export function removeAgentFiles(paneDir: string): void {
  rmSync(paneDir, { recursive: true, force: true })
}

export function hookCommand(nodePath: string, scriptPath: string): string {
  return `${shellQuote(nodePath)} ${shellQuote(scriptPath)}`
}
