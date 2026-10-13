import { EFFORTS, MODEL_ID, type AgentCli, type Effort } from '@orbit/protocol'

export interface PaneCommand {
  file: string
  args: string[]
}

/** Files Orbit prepared for this agent; every path is ours, never user text. */
export interface AgentLaunch {
  cli: AgentCli
  model: string | null
  effort?: Effort | null
  /** Claude: MCP config file. */
  mcpConfigPath?: string
  /** Claude: settings file carrying the status hooks. */
  settingsPath?: string
  /** Codex: Orbit MCP endpoint; the token is read from ORBIT_PANE_TOKEN. */
  mcpUrl?: string
  /** Appended to Claude's system prompt; prefixed to the first prompt for Codex. */
  rolePromptPath?: string
  /** First prompt. */
  taskPath?: string
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

const fromFile = (path: string) => `"$(cat ${shellQuote(path)})"`

/**
 * The agent runs inside a login shell so it sees the user's PATH. When the agent exits the pane
 * drops to an interactive shell instead of dying, like a terminal tab would. Free text (role,
 * task) only reaches the command line as `$(cat <file>)`, so it is never parsed by the shell.
 */
export function buildCommand(launch: AgentLaunch, shell: string): PaneCommand {
  if (launch.cli === 'shell') return { file: shell, args: ['-l'] }
  const { model, effort } = launch
  if (model !== null && !MODEL_ID.test(model)) throw new Error(`Modelo inválido: ${model}`)
  if (effort && !EFFORTS.includes(effort)) throw new Error(`Esforço inválido: ${effort}`)

  const parts: string[] = []
  if (launch.cli === 'claude') {
    parts.push('claude')
    if (model) parts.push('--model', model)
    if (effort) parts.push('--effort', effort)
    if (launch.mcpConfigPath) parts.push('--mcp-config', shellQuote(launch.mcpConfigPath))
    if (launch.settingsPath) parts.push('--settings', shellQuote(launch.settingsPath))
    if (launch.rolePromptPath) parts.push('--append-system-prompt', fromFile(launch.rolePromptPath))
    if (launch.taskPath) parts.push('--', fromFile(launch.taskPath))
  } else {
    parts.push('codex')
    if (model) parts.push('-m', model)
    if (effort) parts.push('-c', shellQuote(`model_reasoning_effort="${effort}"`))
    if (launch.mcpUrl) {
      parts.push('-c', shellQuote(`mcp_servers.orbit.url="${launch.mcpUrl}"`))
      parts.push('-c', shellQuote('mcp_servers.orbit.bearer_token_env_var="ORBIT_PANE_TOKEN"'))
      // Orbit's coordination tools are pre-approved, as for Claude; under a "never" approval
      // policy Codex would otherwise refuse every handoff.
      parts.push('-c', shellQuote('mcp_servers.orbit.default_tools_approval_mode="approve"'))
    }
    const prompt = [launch.rolePromptPath, launch.taskPath].filter((p): p is string => Boolean(p))
    if (prompt.length) parts.push('--', `"$(cat ${prompt.map(shellQuote).join(' ')})"`)
  }
  return { file: shell, args: ['-l', '-c', `${parts.join(' ')}; exec ${shellQuote(shell)} -l`] }
}

/** Child environment: the user's env minus Orbit's own secrets, plus pane identity for hooks. */
export function paneEnv(base: NodeJS.ProcessEnv, extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined || key === 'ORBIT_TOKEN' || key.startsWith('VITE_ORBIT_')) continue
    env[key] = value
  }
  return { ...env, TERM: 'xterm-256color', COLORTERM: 'truecolor', ...extra }
}
