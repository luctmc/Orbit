import type { RateWindow } from '@orbit/protocol'
import type { ReportedLimits } from './usage.ts'

/** Current account quota from Codex's stable app-server API, not a model's separate bucket. */
export function parseCodexAccountLimits(raw: unknown, now = Date.now()): ReportedLimits | null {
  const result = raw as any
  const map = result?.rateLimitsByLimitId
  const rate = map?.codex ?? (result?.rateLimits?.limitId && result.rateLimits.limitId !== 'codex' ? null : result?.rateLimits)
  if (!rate) return null
  const window = (value: any): RateWindow | null => {
    if (!value || !Number.isFinite(value.usedPercent) || value.usedPercent < 0 || value.usedPercent > 100 || !Number.isFinite(value.resetsAt) || value.resetsAt <= 0 || !Number.isFinite(value.windowDurationMins) || value.windowDurationMins <= 0) return null
    return { usedPercent: value.usedPercent, resetsAt: value.resetsAt * 1000, windowMinutes: value.windowDurationMins }
  }
  const fiveHour = window(rate.primary), weekly = window(rate.secondary)
  if (!fiveHour && !weekly) return null
  return { cli: 'codex', fiveHour, weekly, plan: typeof rate.planType === 'string' ? rate.planType : null, updatedAt: now, checkedAt: now, source: 'provider', refreshError: null }
}

/** One read per account; focus/manual refresh cannot overlap or hammer a failing provider. */
export class LimitRefreshGate {
  private pending = new Map<string, Promise<void>>()
  private next = new Map<string, number>()
  private failures = new Map<string, number>()
  private now: () => number
  constructor(now = () => Date.now()) { this.now = now }
  run(id: string, read: () => Promise<boolean>): Promise<void> {
    const pending = this.pending.get(id)
    if (pending) return pending
    if (this.now() < (this.next.get(id) ?? 0)) return Promise.resolve()
    const task = Promise.resolve().then(read).catch(() => false).then(ok => {
      const failures = ok ? 0 : (this.failures.get(id) ?? 0) + 1
      this.failures.set(id, failures)
      this.next.set(id, this.now() + (ok ? 15000 : Math.min(300000, 30000 * 2 ** Math.min(failures - 1, 4))))
    }).finally(() => { this.pending.delete(id) })
    this.pending.set(id, task)
    return task
  }
}
