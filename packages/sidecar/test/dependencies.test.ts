import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture } from './r2Fixture.ts'
import { acceptSyntheticResult } from './reviewFixture.ts'

test('dependencies require acceptance, pin an exact result and become invalid when that prerequisite is retried', async () => {
  const { core, lead, pane, root } = await fixture()
  try {
    const first = core.handoff(pane, { summary: 'Prerequisite', evidence: 'synthetic observation' })
    const upstream = core.store.activityHistory(lead.missionId).activities[0]!
    const task = { activityId: 'downstream', title: 'Dependent work', task: 'Use the accepted prerequisite', model: null, cli: 'claude' as const, dependsOn: [upstream.id] }
    await assert.rejects(core.spawnHelper(lead, { ...task, dependsOn: ['missing'] }), /não existe/)
    await assert.rejects(core.spawnHelper(lead, task), /revisão|valida/)
    acceptSyntheticResult(core, lead, first.resultId)
    core.closeHelper(lead, pane.id)
    await (core as any).panes.waitForExit(pane.id)
    const downstream = await core.spawnHelper(lead, task)
    const dependency = core.store.activityHistory(lead.missionId).activities.find(a => a.key === 'downstream' || a.activeAttemptId === core.store.currentPaneAttempt(downstream.pane.id)?.id)!.dependencies![0]!
    assert.deepEqual(dependency, { activityId: upstream.id, revision: upstream.revision, attemptId: upstream.activeAttemptId, resultId: first.resultId })
    writeFileSync(join(root, 'next.ts'), 'export const next = true\n')
    const second = core.handoff(downstream.pane, { summary: 'Integrated next step', evidence: 'synthetic observation' })
    assert.equal(core.verificationStatus(lead.missionId).find(v => v.activityId === upstream.id)?.valid, true, 'later source edits do not erase historical activity acceptance')
    assert.throws(() => core.inspectResult(lead, first.resultId), /alterado/)
    acceptSyntheticResult(core, lead, second.resultId)
    assert.ok(core.missionReady(lead, 'Final integrated source reviewed', false).readyAt)
    const retried = await core.spawnHelper(lead, { activityId: upstream.id, title: 'New prerequisite', task: 'Recheck prerequisite', model: null, cli: 'claude', readOnly: true, retryReason: 'Upstream contract changed' })
    const changed = core.handoff(retried.pane, { summary: 'New upstream result', evidence: 'synthetic observation' })
    acceptSyntheticResult(core, lead, changed.resultId)
    assert.equal(core.verificationStatus(lead.missionId).find(v => v.activityId === dependency.activityId)?.valid, true)
    assert.match(core.verificationStatus(lead.missionId).find(v => v.activityId !== dependency.activityId)!.reason!, /dependência mudou/)
    assert.throws(() => core.missionReady(lead, 'Stale downstream', false), /validação/)
  } finally { await core.shutdown() }
})

test('a newer done result invalidates an inspection even when source bytes did not change', async () => {
  const { core, lead, pane } = await fixture()
  try {
    const first = core.handoff(pane, { summary: 'First', evidence: 'synthetic observation' })
    const inspection = core.inspectResult(lead, first.resultId)
    const second = core.handoff(pane, { summary: 'Corrected delivery', evidence: 'more synthetic detail' })
    assert.notEqual(first.resultId, second.resultId)
    assert.throws(() => core.verifyResult(lead, { inspectionId: inspection.id, verdict: 'accepted', summary: 'Old result', checks: [{ command: 'synthetic', exitCode: 0, summary: 'fixture' }], criteria: [] }), /entrega atual/)
  } finally { await core.shutdown() }
})

test('review persistence fails closed and rolls back acceptance when disk commit fails', async () => {
  const { core, lead, pane, root } = await fixture()
  const blocked = join(root, 'data/state.json.tmp')
  try {
    const result = core.handoff(pane, { summary: 'Review target', evidence: 'synthetic observation' })
    const inspection = core.inspectResult(lead, result.resultId)
    const review = { inspectionId: inspection.id, verdict: 'accepted' as const, summary: 'Synthetic review', checks: [{ command: 'synthetic fixture check', exitCode: 0, summary: 'observed fixture state' }], criteria: [] }
    mkdirSync(blocked)
    assert.throws(() => core.verifyResult(lead, review))
    assert.equal(core.store.verifications(lead.missionId).length, 0)
    assert.equal(core.verificationStatus(lead.missionId)[0]!.valid, false)
    rmSync(blocked, { recursive: true })
    const saved = core.verifyResult(lead, review)
    assert.equal(core.verifyResult(lead, review).id, saved.id)
    assert.equal(core.verificationStatus(lead.missionId)[0]!.valid, true)
    assert.ok(core.missionReady(lead, 'Atividade revisada sem integração obrigatória', false).readyAt)
  } finally { rmSync(blocked, { recursive: true, force: true }); await core.shutdown() }
})
