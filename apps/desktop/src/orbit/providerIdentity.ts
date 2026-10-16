import type { Account, Pane } from '@orbit/protocol'

/** Launch configuration is not proof of which model answered. Transcript observations are separate. */
export function providerIdentity(pane: Pick<Pane, 'cli' | 'model' | 'reportedModels'>, account?: Account) {
  const custom = account?.kind === 'api' && !!account.baseUrl
  const brand = custom ? null : pane.cli === 'codex' ? 'openai' : pane.cli === 'claude' ? 'anthropic' : null
  let endpoint = 'Provedor personalizado'
  try { if (custom) endpoint = new URL(account.baseUrl!).hostname } catch { /* legacy invalid endpoint */ }
  const provider = custom ? endpoint : brand === 'openai' ? 'OpenAI · Codex' : brand === 'anthropic' ? 'Anthropic · Claude' : pane.cli === 'shell' ? 'Terminal' : pane.cli === 'gemini' ? 'Google · Gemini' : 'Antigravity'
  const observed = pane.reportedModels?.filter(Boolean) ?? []
  const model = observed.length ? `Observado na sessão: ${observed.join(', ')}` : pane.cli === 'shell' ? 'Shell local' : pane.model ? `Configurado: ${pane.model} · execução ainda não confirmada` : 'Modelo padrão da CLI · ainda não informado'
  return { brand, provider, model }
}
