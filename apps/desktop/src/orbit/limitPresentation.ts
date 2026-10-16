import type { AccountLimits, RateWindow } from '@orbit/protocol'

export const LIMIT_FRESH_MS = 90000
/** Match each provider's own meter so the same quota has the same visible percentage. */
export const limitMetric = (cli: AccountLimits['cli'] | undefined) => cli === 'claude' ? 'usado' : 'restante'

export function limitWindowView(window: RateWindow | null, limits: Pick<AccountLimits, 'updatedAt' | 'refreshError'> & Partial<Pick<AccountLimits, 'cli'>>, now: number) {
  const label = !window || window.windowMinutes === 300 ? '5 h' : window.windowMinutes === 10080 ? 'semana' : window.windowMinutes % 60 === 0 ? `${window.windowMinutes / 60} h` : `${window.windowMinutes} min`
  const invalid = !window || !Number.isFinite(window.usedPercent) || window.usedPercent < 0 || window.usedPercent > 100 || !Number.isFinite(window.resetsAt)
  const stale = !Number.isFinite(limits.updatedAt) || limits.updatedAt <= 0 || now - limits.updatedAt > LIMIT_FRESH_MS || limits.updatedAt > now + 1000
  const expired = !!window && window.resetsAt <= now
  const remaining = invalid || stale || expired ? null : Math.round(100 - window.usedPercent)
  const used = invalid || stale || expired ? null : window.usedPercent
  const metric = limitMetric(limits.cli)
  return { label, remaining, used, metric, percent: metric === 'usado' ? used : remaining, state: invalid ? 'unknown' : expired ? 'expired' : stale ? 'stale' : 'current' }
}

export function limitReadLabel(limits: Pick<AccountLimits, 'updatedAt' | 'refreshError'>, now: number) {
  const age = Math.max(0, Math.floor((now - limits.updatedAt) / 1000))
  const last = limits.updatedAt > 0 ? `Última leitura há ${age < 60 ? `${age} s` : `${Math.floor(age / 60)} min`}.` : 'Sem leitura confirmada.'
  return `${last} ${limits.refreshError ? `${limits.refreshError} Tentativas com espera progressiva.` : 'Atualização automática a cada 30 s.'}`
}
