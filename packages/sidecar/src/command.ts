import { MODEL_ID, type AgentCli } from '@orbit/protocol'

export interface PaneCommand {
  file: string
  args: string[]
}

/**
 * The agent runs inside a login shell so it sees the user's PATH. When the agent exits the pane
 * drops to an interactive shell instead of dying, like a terminal tab would.
 */
export function buildCommand(cli: AgentCli, model: string | null, shell: string): PaneCommand {
  if (cli === 'shell') return { file: shell, args: ['-l'] }
  if (model !== null && !MODEL_ID.test(model)) throw new Error(`Modelo inválido: ${model}`)

  const agent = cli === 'claude'
    ? ['claude', ...(model ? ['--model', model] : [])]
    : ['codex', ...(model ? ['-m', model] : [])]
  return { file: shell, args: ['-l', '-c', `${agent.join(' ')}; exec ${shell} -l`] }
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
