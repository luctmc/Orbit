import type { HarnessAttemptUsage } from '../harnessEvidence.ts'
import type { AuxiliaryCall, ObservedUsage } from '../measurements.ts'
import type { ExecutionIdentity } from '../adapters/codexUsage.ts'
const keys = ['input', 'output', 'cacheRead', 'cacheWrite', 'total', 'costUsd'] as const
/** Include every phase, failed attempt and classifier. Missing one phase never becomes zero. */
export function aggregateTrialAccounting(attempts: Array<HarnessAttemptUsage | null>, auxiliary: AuxiliaryCall[] = []): { usage: ObservedUsage; identity: ExecutionIdentity } {
  const rows: ObservedUsage[] = attempts.map(a => Object.fromEntries(keys.map(k => [k, k === 'costUsd' ? a?.costUsd ?? null : a && !a.invalidated && a.tokens !== null ? a.consumption?.[k] ?? null : null])) as unknown as ObservedUsage)
  rows.push(...auxiliary.map(a => {
    const u = a.observation?.usage
    // Classifier input is uncached; its total also includes cache read/write.
    return { input: u && [u.input, u.cacheRead, u.cacheWrite].every(n => n !== null) ? u.input! + u.cacheRead! + u.cacheWrite! : null,
      output: u?.output ?? null, cacheRead: u?.cacheRead ?? null, cacheWrite: u?.cacheWrite ?? null, total: u?.total ?? null, costUsd: u?.costUsd ?? null }
  }))
  const usage = Object.fromEntries(keys.map(k => {
    const values = rows.map(r => r[k]), total = values.reduce<number>((sum, n) => sum + (n ?? 0), 0)
    return [k, rows.length && values.every(n => n !== null && Number.isFinite(n) && n >= 0) && Number.isFinite(total) && (k === 'costUsd' || Number.isSafeInteger(total)) ? total : null]
  })) as unknown as ObservedUsage
  const identities = attempts.filter((a): a is HarnessAttemptUsage => !!a)
  const models = [...new Set([...identities.flatMap(a => a.reportedModels), ...auxiliary.flatMap(a => a.observation?.reportedModels ?? [])])].sort()
  const efforts = [...new Set(identities.flatMap(a => a.reportedEfforts ?? (a.reportedEffort ? [a.reportedEffort] : [])))] as ExecutionIdentity['efforts']
  const complete = attempts.length > 0 && auxiliary.length === 0 && attempts.every(a => a && a.identityComplete && !a.invalidated && a.identityLevel === 'response') && models.length === 1 && efforts.length === 1
  return { usage, identity: { models, efforts, level: complete ? 'response' : identities.length ? 'execution-context' : 'unknown', complete } }
}
