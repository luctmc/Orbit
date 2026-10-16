import type { ActivityRecord, ActivityAttempt, ActivityResult, DeliveryNotice, VerificationRecord } from '@orbit/protocol'
import type { CorpusCheck } from './corpus.ts'

export interface AutonomyEvidence {
  leadId: number
  workerCli: 'claude' | 'codex'
  reviewerCli: 'claude' | 'codex'
  ready: boolean
  integrationCurrent: boolean
  activities: ActivityRecord[]
  attempts: ActivityAttempt[]
  results: ActivityResult[]
  verifications: VerificationRecord[]
  notifications: DeliveryNotice[]
  checks: CorpusCheck[]
  checkpoint?: { resultId: string; attemptId: string; notificationId: string }
}

/** Accept facts from the ledger and independent oracle, never a terminal success phrase. */
export function evaluateAutonomy(e: AutonomyEvidence) {
  const issues: string[] = []
  if (!e.ready || !e.integrationCurrent) issues.push('No ready mission with a current final integration review')
  if (!e.checks.length || e.checks.some(c => c.exitCode !== 0)) issues.push('Independent protected oracle did not pass')
  if (e.activities.some(a => a.state === 'waived')) issues.push('A required activity was waived')
  if (e.activities.length !== 2 || e.attempts.length !== 2) issues.push('Expected exactly implementation and review, without duplicated attempts')
  const owner = (r: ActivityResult) => e.attempts.find(a => a.id === r.attemptId)
  const current = (r: ActivityResult) => r.status === 'done' && e.activities.some(a => a.id === r.activityId && a.activeAttemptId === r.attemptId && a.revision === r.activityRevision)
  const resultReview = (r: ActivityResult) => e.verifications.findLast(v => v.resultId === r.id && v.scope === 'result')
  const workers = e.results.filter(r => current(r) && owner(r)?.cli === e.workerCli)
  const worker = workers.find(r => {
    const review = resultReview(r)
    return review?.verdict === 'accepted' && review.reviewer.paneId !== owner(r)?.paneId && review.reviewer.paneId !== e.leadId && e.attempts.some(a => a.paneId === review.reviewer.paneId && a.cli === e.reviewerCli)
  })
  if (!worker) issues.push('No worker result independently accepted by a helper on the opposite CLI')
  const reviewer = e.results.find(r => current(r) && owner(r)?.cli === e.reviewerCli && owner(r)?.paneId !== e.leadId && resultReview(r)?.verdict === 'accepted' && resultReview(r)?.reviewer.paneId !== owner(r)?.paneId)
  if (!reviewer) issues.push('Reviewer did not deliver an independently accepted result')
  if (e.results.filter(r => r.status === 'done').length !== 2) issues.push('Expected two final deliveries, without repeated implementation')
  for (const r of [worker, reviewer].filter((r): r is ActivityResult => !!r)) {
    if (!e.notifications.some(n => n.resultId === r.id && n.state === 'agent_acknowledged')) issues.push(`Delivery ${r.id} was not acknowledged`)
  }
  if (e.checkpoint) {
    const { resultId, attemptId, notificationId } = e.checkpoint
    if (!e.results.some(r => r.id === resultId && r.attemptId === attemptId) || !e.notifications.some(n => n.id === notificationId && n.resultId === resultId && n.state === 'agent_acknowledged')) issues.push('Recovered result, attempt or receipt identity was lost')
  }
  return { passed: issues.length === 0, issues, workerResultId: worker?.id ?? null, reviewerResultId: reviewer?.id ?? null }
}
