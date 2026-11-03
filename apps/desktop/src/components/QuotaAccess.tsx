import { useState, type ReactNode } from 'react'
import type { Account, AccountLimits, AccountStatus } from '@orbit/protocol'
import { useOrbit, useOrbitClient } from '../orbit/context.tsx'
import { accountLabel } from '../orbit/labels.ts'
import { limitReadLabel, limitWindowView, LIMIT_FRESH_MS } from '../orbit/limitPresentation.ts'
import { useLimitClock } from '../orbit/useLimitClock.ts'
import { openExternal } from '../orbit/open.ts'
import { ProviderMark } from './ProviderMark.tsx'

export const OFFICIAL_USAGE = { codex: 'https://chatgpt.com/codex/settings/usage', claude: 'https://claude.ai/settings/usage' }
const fullDate = (at: number) => new Date(at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

const resetAttempts = new Map<string, string>()
function resetRequestId(key: string) {
  let id = resetAttempts.get(key)
  try { id ??= localStorage.getItem(key) ?? undefined } catch { /* private storage may be unavailable */ }
  if (!id) id = crypto.randomUUID()
  resetAttempts.set(key, id)
  try { localStorage.setItem(key, id) } catch { /* memory still protects retries in this session */ }
  return id
}
function QuotaDetails({ compact, label, children }: { compact: boolean; label: string; children: ReactNode }) {
  return compact ? <details className="quota-access__details"><summary>{label}</summary><div>{children}</div></details> : <>{children}</>
}

export function QuotaAccess({ account, limits, status, compact = false }: { account: Account; limits?: AccountLimits; status?: AccountStatus; compact?: boolean }) {
  const client = useOrbitClient()
  const now = useLimitClock()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  if (account.kind !== 'assinatura' || (account.cli !== 'codex' && account.cli !== 'claude')) return null
  const label = accountLabel(account, account.cli)
  const credit = limits?.resetCredits?.credits?.find(c => c.expiresAt === null || c.expiresAt > now)
  const fresh = !!limits && now - limits.updatedAt < LIMIT_FRESH_MS && limits.updatedAt <= now + 1000 && !limits.refreshError
  const redeem = async () => {
    if (!credit || busy || !fresh) return
    if (!confirm(`Usar um reset gratuito de ${label}${status?.email ? ` (${status.email})` : ''}?\n\nRestaura os limites elegíveis de Codex e pode alterar a próxima renovação semanal. O benefício será consumido e não pode ser desfeito. Nenhuma compra será feita.${credit.expiresAt ? `\nExpira em ${fullDate(credit.expiresAt)}.` : ''}`)) return
    setBusy(true); setNotice(null)
    const key = `orbit.free-reset.${account.id}.${credit.id}`
    const requestId = resetRequestId(key)
    try {
      const response = await client.ask({ type: 'account.reset', accountId: account.id, creditId: credit.id, requestId, confirmed: true }, 'account.reset.result', m => m.requestId === requestId, 18000)
      setNotice(response.message)
      // Keep the idempotency key: uncertainty/reopening must never spend another benefit.
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  return <div className={`quota-access${compact ? ' quota-access--compact' : ''}`} aria-label={`Limites e resets de ${label}`}>
    {compact && <div className="quota-access__name"><ProviderMark brand={account.cli === 'codex' ? 'openai' : 'anthropic'} /><strong>{label}</strong></div>}
    <div className="quota-access__windows" title={limits ? limitReadLabel(limits, now) : 'Sem leitura confirmada'}>
      {([['5 h', limits?.fiveHour], ['Semana', limits?.weekly]] as const).map(([name, window]) => {
        const view = window && limits ? limitWindowView(window, limits, now) : null
        return <div key={name}><span>{name}</span><strong title={view?.remaining != null ? `${view.remaining}% restante` : undefined}>{view?.used != null ? `${Math.round(view.used)}% usado` : 'Sem leitura atual'}</strong>{window && !compact && <small>{window.resetsAt <= now ? 'Aguardando nova leitura' : `Renova ${fullDate(window.resetsAt)}`}</small>}</div>
      })}
    </div>
    <QuotaDetails compact={compact} label={`Renovação e resets${limits?.resetCredits && fresh ? ` · ${limits.resetCredits.availableCount} ${limits.resetCredits.availableCount === 1 ? 'disponível' : 'disponíveis'}` : ''}`}>
    {compact && <p className="quota-access__hint">{limits?.fiveHour ? `5 h renova ${fullDate(limits.fiveHour.resetsAt)}.` : 'Sem horário confirmado.'} {limits?.weekly ? `Semana renova ${fullDate(limits.weekly.resetsAt)}.` : ''}</p>}
    <div className="quota-access__actions">
      <button type="button" className="btn btn--ghost btn--sm" onClick={() => void openExternal(OFFICIAL_USAGE[account.cli as 'codex' | 'claude']).catch(() => setNotice('Não foi possível abrir o navegador.'))}>Ver uso e resets ↗</button>
      {account.cli === 'codex' && credit && fresh && (limits?.resetCredits?.availableCount ?? 0) > 0 && <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={() => void redeem()}>{busy ? 'Confirmando…' : 'Usar reset gratuito'}</button>}
    </div>
    <p className="quota-access__hint">{account.cli === 'codex' ? limits?.resetCredits && fresh ? `${limits.resetCredits.availableCount} reset(s) gratuito(s) informado(s) pelo provedor.${credit?.expiresAt ? ` Expira ${fullDate(credit.expiresAt)}.` : ''}` : 'Resets gratuitos: disponibilidade ainda não confirmada.' : 'Se houver benefício, use “Reset for free” no painel oficial.'}</p>
    {!compact && <p className="quota-access__hint">No navegador, confira o login de {status?.email ?? label}. O Orbit não troca a conta do site. Renovação automática, benefício gratuito e reset pago são opções diferentes.</p>}
    </QuotaDetails>
    {notice && <p role="status" className="quota-access__notice">{notice}</p>}
  </div>
}

export function HomeAccounts({ onOpenAccounts }: { onOpenAccounts?: () => void } = {}) {
  const { accounts, accountStatuses, limits } = useOrbit()
  const client = useOrbitClient()
  const subscriptions = accounts.filter(a => a.kind === 'assinatura' && ['codex', 'claude'].includes(a.cli) && (limits.some(l => l.accountId === a.id) || accountStatuses.find(s => s.accountId === a.id)?.loggedIn))
  return <section className="home__accounts" aria-label="Contas e limites"><div className="home__section-head"><h2 className="eyebrow">Contas e limites</h2><button type="button" className="btn btn--ghost btn--sm" onClick={() => client.send({ type: 'limits.refresh' })}>Atualizar</button></div>{subscriptions.length ? subscriptions.map(account => <QuotaAccess key={account.id} compact account={account} limits={limits.find(l => l.accountId === account.id)} status={accountStatuses.find(s => s.accountId === account.id)} />) : <p className="muted">Conecte suas contas em Configurações → Contas.</p>}<p className="quota-access__hint">O painel oficial usa a conta conectada no navegador. Confira o login antes de usar um benefício.</p>{onOpenAccounts && <button type="button" className="btn btn--ghost btn--sm" onClick={onOpenAccounts}>Gerenciar IAs e contas</button>}</section>
}
