import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sessionObservations, auditRecovery } from './autonomy-observations.mjs'
import { fixture } from '../../packages/sidecar/test/r2Fixture.ts'

test('recovery evidence retains an observed session after its pane is closed', () => {
  const evidence = sessionObservations()
  const worker = { id: 2, sessionId: 'same-session', executionEpoch: 'resumed', usage: { total: 123 } }
  evidence.observe([worker])
  worker.sessionId = null
  worker.usage.total = 0
  evidence.observe([])
  assert.deepEqual(evidence.pane(2), { id: 2, sessionId: 'same-session', executionEpoch: 'resumed', usage: { total: 123 } })
  const returned = evidence.pane(2)
  returned.usage.total = 0
  assert.equal(evidence.pane(2).usage.total, 123)
  assert.equal(evidence.pane(3), null, 'missing observation is never inferred from the checkpoint')
})

test('a later observed session replaces the prior identity instead of concealing a mismatch', () => {
  const evidence = sessionObservations()
  evidence.observe([{ id: 2, sessionId: 'old', executionEpoch: 'first' }])
  evidence.observe([{ id: 2, sessionId: 'different', executionEpoch: 'second' }])
  assert.equal(evidence.pane(2).sessionId, 'different')
  assert.equal(evidence.pane(2).executionEpoch, 'second')
})

test('recovery audit rejects missing sessions, changed identities and epochs that were not renewed', () => {
  const old = { id: 2, sessionId: 'original', executionEpoch: 'before', usage: { total: 10 } }
  for (const current of [null, { ...old }, { ...old, sessionId: 'different', executionEpoch: 'after' }, { ...old, executionEpoch: null }]) {
    const observations = sessionObservations()
    if (current) observations.observe([current])
    let reports = 0
    const core = { store: { pane: () => current, mission: () => ({ usage: { total: 10 } }), accountSessionUsage: () => { reports++; return { delta: { total: 0, costUsd: null } } } } }
    assert.equal(auditRecovery(core, 'mission', { panes: [old] }, observations).recoveryPassed, false)
    assert.equal(reports, 0, 'invalid identity must not inject an accounting report')
  }
})

test('real Store and simulated PTYs retain recovery identity and zero replay after the helper is closed', async () => {
  const f = await fixture()
  let restored
  try {
    f.lead = await f.core.changeLead(f.lead.missionId, { kind: 'new', cli: 'claude', model: null, effort: null, accountId: null })
    f.core.panes.setSession(f.lead.id, '11111111-1111-4111-8111-111111111111')
    f.core.panes.setSession(f.pane.id, '22222222-2222-4222-8222-222222222222')
    const usage = { input: 90, output: 10, cacheRead: 50, cacheWrite: 0, total: 100, costUsd: null }
    for (const p of f.core.missionPanes(f.lead.missionId)) {
      f.core.store.accountSessionUsage(p, usage, 'status')
      f.core.panes.setUsage(p.id, usage, null)
    }
    const result = f.core.handoff(f.pane, { summary: 'Synthetic recovery delivery', evidence: 'Simulated lifecycle, no model' })
    const checkpoint = { panes: structuredClone(f.core.missionPanes(f.lead.missionId).filter(p => p.cli !== 'shell')) }
    await f.core.shutdown()
    restored = f.create()
    for (const p of checkpoint.panes) await restored.handle({ type: 'pane.restart', paneId: p.id, resume: true })
    const observations = sessionObservations()
    observations.observe(restored.missionPanes(f.lead.missionId))
    const lead = restored.store.pane(f.lead.id)
    restored.closeHelper(lead, f.pane.id)
    assert.equal(restored.store.pane(f.pane.id), undefined)
    assert.equal(restored.store.activityHistory(lead.missionId).results[0].id, result.resultId)
    const audit = auditRecovery(restored, lead.missionId, checkpoint, observations)
    assert.equal(audit.recoveryPassed, true)
    assert.equal(audit.accountingReplay.reports.length, 2)
    assert.deepEqual(audit.accountingReplay.before, audit.accountingReplay.after)
    assert.ok(audit.sessionRecovery.every(p => p.currentSessionId === p.priorSessionId && p.currentEpoch !== p.priorEpoch))
  } finally { await restored?.shutdown(); await f.core.shutdown() }
})
