import type { ActivityAttempt, ActivityRecord, ActivityResult, Mission, VerificationRecord, TokenUsage } from '@orbit/protocol'
import type { UsageReport } from './usage.ts'
import { validHarnessCandidate, type HarnessEvidence } from './harness.ts'

/** Core-only measurements. No handoff field can populate these observations. */
export interface HarnessAttemptUsage {
  attemptId: string
  executionEpoch: string
  mode: 'live' | 'simulated'
  charged?: TokenUsage
  invalidated?: boolean
  consumption?: Partial<Record<keyof TokenUsage, number | null>>
  identityLevel?: 'execution-context' | 'response' | 'unknown'
  tokens: number | null
  costUsd: number | null
  reportedModels: string[]
  reportedEffort: string | null
  reportedEfforts?: string[]
  identityComplete: boolean
  updatedAt: number
}
export interface HarnessUsageObservation {
  mode: 'live' | 'simulated'
  origin?: UsageReport['origin']
  observed?: UsageReport['observed']
  reportedModels: string[]
  reportedEffort: string | null
  identityComplete: boolean
  identityLevel?: 'execution-context' | 'response' | 'unknown'
}
/** Rebuilt from one atomic store snapshot, so review and evidence cannot diverge on disk failure. */
export function projectHarnessEvidence(input: { attempts: ActivityAttempt[]; activities: ActivityRecord[]; results: ActivityResult[]; reviews: VerificationRecord[]; missions: Mission[]; usage: HarnessAttemptUsage[] }): HarnessEvidence[] {
  if (input.attempts.length > 20000 || input.results.length > 100000 || input.reviews.length > 100000) return []
  const activities = new Map(input.activities.map(a => [a.id, a]))
  const missions = new Map(input.missions.map(m => [m.id, m]))
  const usageByAttempt = new Map(input.usage.map(u => [u.attemptId, u]))
  const latestResults = new Map(input.results.map(r => [r.attemptId, r]))
  const reviewsByResult = new Map<string, VerificationRecord[]>()
  for (const review of input.reviews) {
    const group = reviewsByResult.get(review.resultId) ?? []
    group.push(review); reviewsByResult.set(review.resultId, group)
  }
  return input.attempts.flatMap(attempt => {
    const decision = attempt.decision?.harness, candidate = decision?.executed
    const activity = activities.get(attempt.activityId)
    const mission = activity && missions.get(activity.missionId)
    if (!decision || !validHarnessCandidate(candidate) || !activity || !mission) return []
    const result = latestResults.get(attempt.id)
    if (!result && attempt.state !== 'stopped') return []
    const reviews = result ? (reviewsByResult.get(result.id) ?? []).filter(r => r.scope === 'result' && r.reviewer.paneId !== attempt.paneId && r.provenance === 'independent-agent-report') : []
    const rejected = reviews.some(r => r.verdict === 'changes_required')
    const accepted = !rejected && result?.status === 'done' && reviews.at(-1)?.verdict === 'accepted'
    const usage = usageByAttempt.get(attempt.id)
    return [{ version: 1, id: attempt.id, taskId: activity.id, projectId: mission.workspaceId, strategyKey: decision.strategy.key, candidate,
      mode: usage?.mode ?? decision.executionMode ?? 'simulated', partition: 'history', outcome: rejected ? 'rejected' : accepted ? 'accepted' : attempt.state === 'stopped' && !result ? 'failed' : 'unverified',
      independentlyReviewed: !!reviews.length, identityConfirmed: usage?.identityLevel === 'response' && !!usage.identityComplete && usage.reportedModels.length === 1 && usage.reportedModels[0] === candidate.model && usage.reportedEffort === candidate.effort,
      tokens: usage?.tokens ?? null, costUsd: usage?.costUsd ?? null,
      durationMs: Math.max(0, (result?.createdAt ?? attempt.updatedAt) - attempt.createdAt), observedAt: reviews.at(-1)?.createdAt ?? result?.createdAt ?? attempt.updatedAt,
    } satisfies HarnessEvidence]
  })
}
