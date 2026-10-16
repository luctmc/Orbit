import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateAutonomy, type AutonomyEvidence } from '../src/benchmarks/autonomy.ts'

function evidence(): AutonomyEvidence {
  return {
    leadId: 1, workerCli: 'claude', reviewerCli: 'codex', ready: true, integrationCurrent: true,
    activities: [{ id: 'work', state: 'accepted', revision: 1, activeAttemptId: 'wa' }, { id: 'review', state: 'accepted', revision: 1, activeAttemptId: 'ra' }] as any,
    attempts: [{ id: 'wa', activityId: 'work', paneId: 2, cli: 'claude' }, { id: 'ra', activityId: 'review', paneId: 3, cli: 'codex' }] as any,
    results: [{ id: 'wr', activityId: 'work', attemptId: 'wa', activityRevision: 1, status: 'done' }, { id: 'rr', activityId: 'review', attemptId: 'ra', activityRevision: 1, status: 'done' }] as any,
    verifications: [{ resultId: 'wr', scope: 'result', verdict: 'accepted', reviewer: { paneId: 3 } }, { resultId: 'rr', scope: 'result', verdict: 'accepted', reviewer: { paneId: 1 } }] as any,
    notifications: [{ id: 'wn', resultId: 'wr', state: 'agent_acknowledged' }, { id: 'rn', resultId: 'rr', state: 'agent_acknowledged' }] as any,
    checks: [{ command: 'protected oracle', exitCode: 0, summary: 'pass' }], checkpoint: { resultId: 'wr', attemptId: 'wa', notificationId: 'wn' },
  }
}
test('autonomous acceptance requires actual delegation, cross-CLI review, oracle and receipt identities', () => {
  assert.equal(evaluateAutonomy(evidence()).passed, true)
  for (const modify of [
    (e: AutonomyEvidence) => { e.ready = false },
    (e: AutonomyEvidence) => { e.integrationCurrent = false },
    (e: AutonomyEvidence) => { e.activities[0]!.state = 'waived' },
    (e: AutonomyEvidence) => { e.verifications[0]!.reviewer.paneId = 2 },
    (e: AutonomyEvidence) => { e.verifications[0]!.reviewer.paneId = 1 },
    (e: AutonomyEvidence) => { e.notifications[0]!.state = 'pty_accepted' },
    (e: AutonomyEvidence) => { e.attempts.push(e.attempts[0]!) },
    (e: AutonomyEvidence) => { e.checks[0]!.exitCode = 1 },
    (e: AutonomyEvidence) => { e.checkpoint!.resultId = 'lost' },
  ]) { const e = evidence(); modify(e); assert.equal(evaluateAutonomy(e).passed, false) }
})
