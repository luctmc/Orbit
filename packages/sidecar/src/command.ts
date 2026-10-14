import { EFFORTS, MODEL_ID, SESSION_ID, type AgentCli, type Effort } from '@orbit/protocol'

export interface PaneCommand {
  file: string
  args: string[]
}

/** Files Orbit prepared for this agent; every path is ours, never user text. */
export interface AgentLaunch {
  cli: AgentCli
  model: string | null
  effort?: Effort | null
  /** Extra workspace folders the agent may read and write besides its cwd. */
  addDirs?: string[]
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
  /** Runs the CLI's login instead of an agent (the account comes from the environment). */
  login?: boolean
  /** Codex: MCP servers switched off in Orbit (plain names). */
  disabledMcp?: string[]
  /** Continue this conversation of the CLI instead of starting one (no first prompt then). */
  resume?: string
  /** Gemini: settings file with Orbit's MCP server and hooks (GEMINI_CLI_SYSTEM_SETTINGS_PATH). */
  systemSettingsPath?: string
  /** Folder with the `orbit` command, put first on the agent's PATH. */
  binDir?: string
}

/** What each CLI runs to sign in an account. */
const LOGIN: Record<Exclude<AgentCli, 'shell'>, string> = { claude: 'claude auth login', codex: 'codex login', gemini: 'gemini', antigravity: 'agy' }

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
  if (launch.login) return { file: shell, args: ['-l', '-c', LOGIN[launch.cli]] }
  const { model, effort, resume } = launch
  if (model !== null && !MODEL_ID.test(model)) throw new Error(`Modelo inválido: ${model}`)
  if (resume !== undefined && !SESSION_ID.test(resume)) throw new Error('Conversa inválida para retomar')
  if (effort && !EFFORTS.includes(effort)) throw new Error(`Esforço inválido: ${effort}`)

  const parts: string[] = []
  // The `orbit` command comes first on the PATH (after the login shell set it up).
  if (launch.binDir) parts.push(`PATH=${shellQuote(launch.binDir)}:"$PATH"`)
  const firstPrompt = () => {
    // On resume the role is already in the conversation; only a new message goes.
    const files = resume ? [launch.taskPath] : [launch.rolePromptPath, launch.taskPath]
    const prompt = files.filter((p): p is string => Boolean(p))
    return prompt.length ? `"$(cat ${prompt.map(shellQuote).join(' ')})"` : null
  }
  if (launch.cli === 'gemini') {
    if (launch.systemSettingsPath) parts.push(`GEMINI_CLI_SYSTEM_SETTINGS_PATH=${shellQuote(launch.systemSettingsPath)}`)
    parts.push('gemini')
    if (model) parts.push('-m', model)
    // Its conversation id comes with every hook; a fixed --session-id would break the restart
    // Gemini does itself after the folder-trust question.
    if (resume) parts.push('--resume', resume)
    if (launch.addDirs?.length) parts.push('--include-directories', shellQuote(launch.addDirs.join(',')))
    const prompt = firstPrompt()
    if (prompt) parts.push('-i', prompt)
  } else if (launch.cli === 'antigravity') {
    parts.push('agy')
    if (model) parts.push('--model', model)
    if (effort) parts.push('--effort', effort)
    for (const dir of launch.addDirs ?? []) parts.push('--add-dir', shellQuote(dir))
    if (resume) parts.push('--conversation', resume)
    const prompt = firstPrompt()
    if (prompt) parts.push('--prompt-interactive', prompt)
  } else if (launch.cli === 'claude') {
    parts.push('claude')
    if (resume) parts.push('--resume', resume)
    if (model) parts.push('--model', model)
    if (effort) parts.push('--effort', effort)
    for (const dir of launch.addDirs ?? []) parts.push('--add-dir', shellQuote(dir))
    if (launch.mcpConfigPath) parts.push('--mcp-config', shellQuote(launch.mcpConfigPath))
    if (launch.settingsPath) parts.push('--settings', shellQuote(launch.settingsPath))
    if (launch.rolePromptPath) parts.push('--append-system-prompt', fromFile(launch.rolePromptPath))
    // On resume the task is the next message of the same conversation.
    if (launch.taskPath) parts.push('--', fromFile(launch.taskPath))
  } else {
    parts.push('codex')
    if (resume) parts.push('resume')
    if (model) parts.push('-m', model)
    if (effort) parts.push('-c', shellQuote(`model_reasoning_effort="${effort}"`))
    for (const dir of launch.addDirs ?? []) parts.push('--add-dir', shellQuote(dir))
    if (launch.mcpUrl) {
      parts.push('-c', shellQuote(`mcp_servers.orbit.url="${launch.mcpUrl}"`))
      parts.push('-c', shellQuote('mcp_servers.orbit.bearer_token_env_var="ORBIT_PANE_TOKEN"'))
      // Orbit's coordination tools are pre-approved, as for Claude; under a "never" approval
      // policy Codex would otherwise refuse every handoff.
      parts.push('-c', shellQuote('mcp_servers.orbit.default_tools_approval_mode="approve"'))
    }
    for (const name of launch.disabledMcp ?? []) {
      if (/^[A-Za-z0-9_-]{1,64}$/.test(name) && name !== 'orbit') parts.push('-c', shellQuote(`mcp_servers.${name}.enabled=false`))
    }
    if (resume) {
      // The conversation already carries its role; the id goes last, as `codex resume` expects,
      // then the next message, if any.
      parts.push('--', resume)
      if (launch.taskPath) parts.push(fromFile(launch.taskPath))
    } else {
      const prompt = [launch.rolePromptPath, launch.taskPath].filter((p): p is string => Boolean(p))
      if (prompt.length) parts.push('--', `"$(cat ${prompt.map(shellQuote).join(' ')})"`)
    }
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
