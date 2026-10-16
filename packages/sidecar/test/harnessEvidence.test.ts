import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fixture } from './r2Fixture.ts'

async function measuredFixture() {
  const f = await fixture()
  const a = f.core.store.activityHistory(f.lead.missionId).attempts.find(a => a.paneId === f.pane.id)!
  // Fixture injects a requested seat only; this never upgrades a simulated execution to live.
  const receipt = a.decision!
  receipt.harness = { ...receipt.harness!, executed: { cli: 'claude', model: 'fixture-model', effort: 'medium', cliVersion: 'fixture-v1', catalogRevision: 'fixture-catalog' } }
  ;(f.core.store as any).state.activityLedger.attempts.find((x: any) => x.id === a.id).decision = receipt
  return { ...f, a }
}
test('durable evidence includes failure and missing identity; a handoff cannot certify its own quality', async () => {
  const f = await measuredFixture()
  try {
    f.core.handoff(f.pane, { summary: 'Synthetic delivery', evidence: 'Synthetic checks' })
    const first = f.core.store.harnessEvidence()
    assert.equal(first.length, 1)
    assert.equal(first[0]!.outcome, 'unverified')
    assert.equal(first[0]!.tokens, null)
    assert.equal(first[0]!.identityConfirmed, false)
    assert.equal(first[0]!.mode, 'simulated')
    assert.equal(first[0]!.partition, 'history')
    assert.deepEqual(first, f.core.store.harnessEvidence())
    await f.core.shutdown()
    const restarted = f.create()
    try { assert.deepEqual(restarted.store.harnessEvidence(), first) } finally { await restarted.shutdown() }
  } finally { await f.core.shutdown() }
})
test('a rejected result cannot be laundered by another acceptance; disk failure leaves review and evidence unchanged', async () => {
  const f = await measuredFixture()
  const blocked = join(f.root, 'data/state.json.tmp')
  try {
    const result = f.core.handoff(f.pane, { summary: 'Synthetic delivery', evidence: 'Synthetic checks' })
    const inspected = f.core.inspectResult(f.lead, result.resultId)
    const rejection = { inspectionId: inspected.id, verdict: 'changes_required' as const, summary: 'Synthetic rejection', checks: [], criteria: [] }
    const before = f.core.store.harnessEvidence()
    const disk = readFileSync(join(f.root, 'data/state.json'), 'utf8')
    mkdirSync(blocked)
    assert.throws(() => f.core.verifyResult(f.lead, rejection))
    assert.deepEqual(f.core.store.harnessEvidence(), before)
    assert.equal(readFileSync(join(f.root, 'data/state.json'), 'utf8'), disk)
    rmSync(blocked, { recursive: true })
    f.core.verifyResult(f.lead, rejection)
    const review = f.core.inspectResult(f.lead, result.resultId)
    assert.throws(() => f.core.verifyResult(f.lead, { inspectionId: review.id, verdict: 'accepted', summary: 'Synthetic second opinion', checks: [{ command: 'synthetic', exitCode: 0, summary: 'fixture' }], criteria: review.acceptance.map((_, i) => ({ item: i + 1, met: true, how: 'fixture' })) }), /rejeitado|nova entrega/)
    assert.equal(f.core.store.harnessEvidence()[0]!.outcome, 'rejected')
  } finally { rmSync(blocked, { recursive: true, force: true }); await f.core.shutdown() }
})

test('attempt usage is atomic, cumulative reports do not duplicate tokens, and absent effort stays uncertified', async () => {
  const f = await measuredFixture()
  const blocked = join(f.root, 'data/state.json.tmp')
  try {
    const usage = { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, total: 12, costUsd: null }
    const observation = { mode: 'simulated' as const, origin: 'claude-transcript-v1' as const, observed: { total: true }, reportedModels: ['fixture-model'], reportedEffort: null, identityComplete: false }
    f.core.store.accountSessionUsage(f.pane, usage, 'status', Date.now(), observation)
    f.core.store.accountSessionUsage(f.pane, usage, 'status', Date.now(), observation)
    f.core.handoff(f.pane, { summary: 'Synthetic delivery', evidence: 'Synthetic checks' })
    assert.equal(f.core.store.harnessEvidence()[0]!.tokens, 12)
    assert.equal(f.core.store.harnessEvidence()[0]!.identityConfirmed, false)
    const before = f.core.store.harnessEvidence()
    mkdirSync(blocked)
    assert.throws(() => f.core.store.accountSessionUsage(f.pane, { ...usage, input: 20, total: 22 }, 'status', Date.now(), observation))
    assert.deepEqual(f.core.store.harnessEvidence(), before)
  } finally { rmSync(blocked, { recursive: true, force: true }); await f.core.shutdown() }
})

test('a legacy later acceptance cannot hide an earlier rejection in dependency readiness', async () => {
  const f = await measuredFixture()
  try {
    const delivery = f.core.handoff(f.pane, { summary: 'Synthetic legacy delivery', evidence: 'Fixture only' })
    const inspection = f.core.inspectResult(f.lead, delivery.resultId)
    const accepted = f.core.verifyResult(f.lead, { inspectionId: inspection.id, verdict: 'accepted', summary: 'Synthetic legacy acceptance', checks: [{ command: 'synthetic', exitCode: 0, summary: 'fixture' }], criteria: inspection.acceptance.map((_, i) => ({ item: i + 1, met: true, how: 'fixture' })) })
    const state = (f.core.store as any).state
    state.verifications.unshift({ ...accepted, id: 'legacy-rejection', verdict: 'changes_required', createdAt: accepted.createdAt - 1 })
    const activity = f.core.store.activityHistory(f.lead.missionId).activities.find(a => a.activeAttemptId === f.a.id)!
    assert.equal(f.core.verificationStatus(f.lead.missionId).find(v => v.activityId === activity.id)!.valid, false)
  } finally { await f.core.shutdown() }
})

test('a later complete native snapshot repairs an initial cost-only observation without double charging', async () => {
  const f = await measuredFixture()
  try {
    const empty = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, costUsd: .001 }
    f.core.store.accountSessionUsage(f.pane, empty, 'status', Date.now(), { mode: 'simulated', origin: 'claude-context-only', observed: { total: false }, reportedModels: [], reportedEffort: null, identityComplete: false })
    const observation = { mode: 'simulated' as const, origin: 'claude-transcript-v1' as const, observed: { total: true, input: true, output: true, cacheRead: true, cacheWrite: true }, reportedModels: ['fixture-model'], reportedEffort: null, identityComplete: false }
    const usage = { ...empty, input: 10, output: 2, total: 12 }
    f.core.store.accountSessionUsage(f.pane, usage, 'status', Date.now(), observation)
    f.core.store.accountSessionUsage(f.pane, usage, 'status', Date.now(), observation)
    f.core.handoff(f.pane, { summary: 'Synthetic snapshot', evidence: 'Fixture' })
    assert.equal(f.core.store.harnessEvidence()[0]!.tokens, 12)
    assert.equal(f.core.store.harnessEvidence()[0]!.identityConfirmed, false)
    assert.equal(f.core.store.mission(f.lead.missionId)!.usage.total, 12)
  } finally { await f.core.shutdown() }
})
