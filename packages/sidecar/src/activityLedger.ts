import { createHash, randomUUID } from 'node:crypto'
import type { ActivityAttempt, ActivityRecord, ActivityResult, Pane, Difficulty, Effort } from '@orbit/protocol'

export interface ActivityLedger {
  version: 1
  activities: ActivityRecord[]
  attempts: ActivityAttempt[]
  results: ActivityResult[]
}
export const emptyActivityLedger = (): ActivityLedger => ({ version: 1, activities: [], attempts: [], results: [] })
export const contractHash = (input: { accept?: string[]; folder?: string | null; squadRoleId?: string | null; taskTypeId?: string | null; dependsOn?: string[]; requireReadOnlySandbox?: boolean; readOnly?: boolean }): string =>
  createHash('sha256').update(JSON.stringify({ acceptance: normalizedAcceptance(input.accept), folder: input.folder ?? null, role: input.squadRoleId ?? null, kind: input.taskTypeId ?? null, ...(input.dependsOn?.length ? { dependsOn: [...new Set(input.dependsOn)].sort() } : {}), ...(input.requireReadOnlySandbox ? { requireReadOnlySandbox: true } : {}), ...(input.readOnly ? { readOnly: true } : {}) })).digest('hex')
export const normalizedAcceptance = (accept?: string[]): string[] => (accept ?? []).map(c => c.trim()).filter(Boolean).slice(0, 8)
/** A work identity is not permission to reuse a different task or model choice. Titles are cosmetic. */
export function helperRequestHash(input: Parameters<typeof contractHash>[0] & { task: string; cli?: Pane['cli']; model: string | null; effort?: Effort | null; difficulty?: Difficulty | null }): string {
  return createHash('sha256').update(JSON.stringify(['helper-request:v1', input.task.trim().replaceAll('\r\n', '\n'), contractHash(input), input.cli ?? null, input.model, input.effort ?? null, input.difficulty ?? null])).digest('hex')
}
export const resultDigest = (input: Omit<ActivityResult, 'id' | 'createdAt' | 'state' | 'digest'>): string =>
  createHash('sha256').update(JSON.stringify(['result:v1', input.activityId, input.attemptId, input.activityRevision, input.status, input.summary, input.evidence, input.details, input.deliveredTo, ...(input.source ? [input.source.digest] : [])])).digest('hex')

export function createAttempt(ledger: ActivityLedger, activity: ActivityRecord, paneId: number, retryReason: string | null, at = Date.now()): ActivityAttempt {
  const attempt: ActivityAttempt = { id: randomUUID(), activityId: activity.id, activityRevision: activity.revision, contractHash: activity.contractHash, acceptance: [...activity.acceptance], paneId, state: 'reserved', cli: null, model: null, accountId: null, sessionId: null, retryReason, error: null, pane: null, createdAt: at, updatedAt: at }
  ledger.attempts.push(attempt)
  Object.assign(activity, { activeAttemptId: attempt.id, state: 'reserved', updatedAt: at })
  return attempt
}

export function syncAttempt(ledger: ActivityLedger, pane: Pane): void {
  // Only the current assignment of a reused terminal receives its new status.
  const attempt = ledger.attempts.findLast(a => a.paneId === pane.id)
  if (!attempt) return
  const activity = ledger.activities.find(a => a.id === attempt.activityId)!
  if (activity.activeAttemptId !== attempt.id) return
  if (attempt.state !== 'delivered') {
    Object.assign(attempt, { pane: structuredClone(pane), executionEpoch: pane.executionEpoch ?? null, cli: pane.cli, model: pane.model, accountId: pane.accountId, sessionId: pane.sessionId, updatedAt: Date.now() })
    if (pane.status === 'exited') {
      attempt.state = 'stopped'
      if (activity.state === 'running' || activity.state === 'reserved') activity.state = 'stopped'
    } else {
      attempt.state = 'running'
      if (activity.state === 'reserved' || activity.state === 'stopped') activity.state = 'running'
    }
  }
}
