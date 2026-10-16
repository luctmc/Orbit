import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture } from './r2Fixture.ts'
import { acceptSyntheticResult } from './reviewFixture.ts'

test('a worker declaration cannot make new work ready without independent review', async () => {
  const { core, lead, pane } = await fixture()
  try {
    core.handoff(pane, { summary: 'Implemented', evidence: 'worker reports checks pass' })
    assert.throws(() => core.missionReady(lead, 'Ready?', false), /valida|revis/i)
  } finally { await core.shutdown() }
})

test('managed writers cannot overlap in the same physical checkout', async () => {
  const { core, lead } = await fixture()
  try {
    await assert.rejects(core.spawnHelper(lead, { title: 'Another writer', task: 'Modify the same checkout', cli: 'claude', model: null }), /escrita|cópia/i)
  } finally { await core.shutdown() }
})

test('review is independent, source-bound, current and retained after restart', async () => {
  const { core, lead, pane, root, create } = await fixture()
  try {
    writeFileSync(join(root, 'source.ts'), 'export const value = 1\n')
    const { resultId } = core.handoff(pane, { summary: 'Source changed', evidence: 'Synthetic check' })
    const own = core.inspectResult(pane, resultId)
    assert.throws(() => core.verifyResult(pane, { inspectionId: own.id, verdict: 'accepted', summary: 'Self review', checks: [{ command: 'synthetic', exitCode: 0, summary: 'pass' }], criteria: [] }), /próprio|independente/i)
    const inspection = core.inspectResult(lead, resultId)
    acceptSyntheticResult(core, lead, resultId)
    assert.ok(core.missionReady(lead, 'Reviewed', false).readyAt)
    writeFileSync(join(root, 'source.ts'), 'export const value = 2\n')
    assert.throws(() => core.missionReady(lead, 'Stale review', false), /alter|valida|revis/i)
    assert.throws(() => core.verifyResult(lead, { inspectionId: inspection.id, verdict: 'accepted', summary: 'Old observation', checks: [{ command: 'synthetic', exitCode: 0, summary: 'pass' }], criteria: [] }), /alter|revis/i)
    await core.shutdown()
    const restored = create()
    try {
      assert.equal(restored.store.verifications(lead.missionId).length, 2)
      assert.equal(restored.verificationStatus(lead.missionId)[0]?.valid, true)
    } finally { await restored.shutdown() }
  } finally { await core.shutdown() }
})

test('closing a live writer holds its lease through the forgotten process exit', async () => {
  const { core, lead, pane } = await fixture()
  try {
    core.closeHelper(lead, pane.id, true)
    assert.equal(core.store.executionPolicy(pane.id)?.epoch, pane.executionEpoch)
    assert.throws(() => core.store.startExecution(999, 'early', { epoch: 'early', missionId: lead.missionId, roots: core.store.executionPolicy(pane.id)!.roots, readOnly: false }), /escrita/)
    const manager = (core as unknown as { panes: { waitForExit(id: number): Promise<void> } }).panes
    await manager.waitForExit(pane.id)
    assert.equal(core.store.executionPolicy(pane.id), undefined)
    const replacement = await core.spawnHelper(lead, { activityId: 'after-exit', title: 'Next', task: 'Write after exit', cli: 'claude', model: null })
    assert.ok(core.store.executionPolicy(replacement.pane.id))
    core.store.releaseExecution(replacement.pane.id, pane.executionEpoch!)
    assert.ok(core.store.executionPolicy(replacement.pane.id), 'an obsolete exit cannot release the new epoch')
  } finally { await core.shutdown() }
})

test('promotion cannot relabel a running writer into a read-only maestro', async () => {
  const { core, lead, pane } = await fixture()
  try {
    await assert.rejects(core.changeLead(lead.missionId, { kind: 'promote', paneId: pane.id }), /writer|sandbox/)
    assert.equal(core.store.pane(pane.id)?.role, 'crew')
    assert.equal(core.store.executionPolicy(pane.id)?.readOnly, false)
    assert.equal(core.store.pane(lead.id)?.role, 'lead')
  } finally { await core.shutdown() }
})

test('a termination timeout preserves pane settings for an explicit retry and revokes old authority', async () => {
  const { core, pane } = await fixture()
  const manager = (core as any).panes
  const kill = manager.kill.bind(manager)
  const wait = manager.waitForExit.bind(manager)
  try {
    manager.waitForExit = async () => { throw new Error('injected slow termination') }
    await assert.rejects(core.handle({ type: 'pane.restart', paneId: pane.id, resume: false }) as Promise<void>, /slow termination/)
    assert.ok(core.store.pane(pane.id), 'timeout must retain the visible pane')
    assert.ok(core.store.paneSpec(pane.id), 'timeout must retain restart settings')
    assert.equal(core.store.executionPolicy(pane.id)?.epoch, pane.executionEpoch)
    assert.throws(() => core.handoff(pane, { summary: 'Closing process', evidence: 'stale' }), /execução/)
    manager.kill = kill
    manager.waitForExit = wait
    await core.handle({ type: 'pane.restart', paneId: pane.id, resume: false })
    assert.notEqual(core.store.pane(pane.id)?.executionEpoch, pane.executionEpoch)
  } finally { manager.kill = kill; manager.waitForExit = wait; await core.shutdown() }
})
