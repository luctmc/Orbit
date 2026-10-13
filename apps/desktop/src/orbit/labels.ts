import { EFFORT_LABEL, type Account, type AgentCli, type Catalog, type MissionMode, type PaneStatus } from '@orbit/protocol'

export { EFFORT_LABEL }

export const MODE_LABEL: Record<MissionMode, string> = { livre: 'Livre', squad: 'Squad', agentica: 'Agêntica' }
export const CLI_LABEL: Record<AgentCli, string> = { claude: 'Claude', codex: 'Codex', shell: 'Terminal' }

export const STATUS: Record<PaneStatus, { label: string; tone: 'live' | 'idle' | 'wait' | 'off' }> = {
  starting: { label: 'iniciando', tone: 'live' },
  running: { label: 'rodando', tone: 'live' },
  idle: { label: 'ocioso', tone: 'idle' },
  waiting: { label: 'espera você', tone: 'wait' },
  exited: { label: 'encerrado', tone: 'off' },
}

/** Model suggestions for a CLI, from the catalog the sidecar read (any MODEL_ID is still accepted). */
export function modelOptions(catalog: Catalog | null, cli: AgentCli): Array<{ id: string; label: string }> {
  if (cli === 'shell' || !catalog) return []
  return catalog[cli].models.map((m) => ({ id: m.id, label: m.label }))
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

/** 950, "41 mil", "1,2 mi" — token counts at a glance. */
export function tokensText(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`
  if (n >= 1e3) return `${Math.round(n / 1e3).toLocaleString('pt-BR')} mil`
  return String(n)
}

/** API-equivalent cost Claude reports; on a subscription it is not billed. */
export function costText(usd: number | null): string | null {
  if (usd === null || usd <= 0) return null
  return usd < 0.01 ? '< US$ 0,01' : `US$ ${usd.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** "Claude" for this Mac's own login, the given name for the others. */
export function accountLabel(account: Account | undefined, cli: AgentCli): string {
  return !account || account.builtin ? CLI_LABEL[cli] : account.name
}
