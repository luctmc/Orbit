import type { AgentCli, Effort, MissionMode, PaneStatus } from '@orbit/protocol'

export const MODE_LABEL: Record<MissionMode, string> = { livre: 'Livre', squad: 'Squad', agentica: 'Agêntica' }
export const CLI_LABEL: Record<AgentCli, string> = { claude: 'Claude', codex: 'Codex', shell: 'Terminal' }
export const EFFORT_LABEL: Record<Effort, string> = { low: 'baixo', medium: 'médio', high: 'alto' }

export const STATUS: Record<PaneStatus, { label: string; tone: 'live' | 'idle' | 'wait' | 'off' }> = {
  starting: { label: 'iniciando', tone: 'live' },
  running: { label: 'rodando', tone: 'live' },
  idle: { label: 'ocioso', tone: 'idle' },
  waiting: { label: 'espera você', tone: 'wait' },
  exited: { label: 'encerrado', tone: 'off' },
}

/** Suggestions only; any id matching MODEL_ID is accepted. Empty = the CLI's own default. */
export const MODEL_SUGGESTIONS: Record<AgentCli, string[]> = {
  claude: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'],
  codex: [],
  shell: [],
}

/**
 * Paths are shown right-aligned (`direction: rtl`) so the end stays visible when they are cut.
 * Left-to-right marks around it keep the bidi algorithm from moving the leading "/" to the end.
 */
export function pathText(path: string): string {
  return `‎${path}‎`
}

export function timeOf(at: number): string {
  return new Date(at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}
