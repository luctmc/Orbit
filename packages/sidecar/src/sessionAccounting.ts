import type { Pane, TokenUsage } from '@orbit/protocol'
import { usageDelta } from './usage.ts'

export interface SessionBaseline {
  key: string
  cli: Pane['cli']
  accountId: string | null
  sessionId: string | null
  launch: string
  usage: TokenUsage
  source: 'legacy' | 'status' | 'rollout'
  missionIds: string[]
  updatedAt: number
}

export const launchKey = (pane: Pane): string => pane.executionEpoch ?? `${pane.id}:${pane.createdAt}`
export const sessionKey = (pane: Pane): string => JSON.stringify([
  pane.cli, pane.accountId, pane.sessionId ? `session:${pane.sessionId}` : `launch:${launchKey(pane)}`,
])

/** A lower cumulative report is stale, not proof that the provider reset its counter. */
export function watermark(previous: TokenUsage | null, next: TokenUsage): TokenUsage {
  const max = (key: Exclude<keyof TokenUsage, 'costUsd'>) => Math.max(previous?.[key] ?? 0, Number.isFinite(next[key]) ? next[key] : 0)
  return {
    input: max('input'), output: max('output'), cacheRead: max('cacheRead'), cacheWrite: max('cacheWrite'), total: max('total'),
    costUsd: next.costUsd === null || !Number.isFinite(next.costUsd) ? previous?.costUsd ?? null : Math.max(previous?.costUsd ?? 0, next.costUsd),
  }
}

export function accountReport(baselines: SessionBaseline[], pane: Pane, next: TokenUsage, source: SessionBaseline['source'], at: number) {
  const key = sessionKey(pane)
  let baseline = baselines.find(b => b.key === key)
  // A report may precede SessionStart. Transfer its already charged watermark once identified.
  if (!baseline && pane.sessionId) {
    baseline = baselines.find(b => !b.sessionId && b.cli === pane.cli && b.accountId === pane.accountId && b.launch === launchKey(pane))
    if (baseline) Object.assign(baseline, { key, sessionId: pane.sessionId })
  }
  const usage = watermark(baseline?.usage ?? null, next)
  const delta = usageDelta(baseline?.usage ?? null, usage)
  if (!baseline) {
    baseline = { key, cli: pane.cli, accountId: pane.accountId, sessionId: pane.sessionId, launch: launchKey(pane), usage, source, missionIds: [], updatedAt: at }
    baselines.push(baseline)
  }
  Object.assign(baseline, { usage, source, updatedAt: at })
  if (!baseline.missionIds.includes(pane.missionId)) baseline.missionIds.push(pane.missionId)
  return { usage, delta }
}
