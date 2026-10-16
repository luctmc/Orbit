import { test } from 'node:test'
import assert from 'node:assert/strict'
import { composeHarness, selectHarnessCandidate, harnessCandidateKey, type HarnessEvidence } from '../src/harness.ts'

const now = 1792150000000
const candidate = { cli: 'codex' as const, model: 'fixture-model', effort: 'medium' as const, cliVersion: 'fixture-1', catalogRevision: 'catalog-1' }
const plan = composeHarness({ kind: 'bug', difficulty: 'normal', readOnly: false, retry: false })
function observations(overrides: Partial<HarnessEvidence> = {}, count = 40): HarnessEvidence[] {
  return Array.from({ length: count }, (_, i) => ({ version: 1, id: `attempt-${i}`, taskId: `task-${i % 10}`, projectId: `project-${i % 3}`, strategyKey: plan.key, candidate, mode: 'live', partition: 'holdout', benchmarkKey: 'a'.repeat(64), outcome: 'accepted', independentlyReviewed: true, identityConfirmed: true, tokens: 100, costUsd: null, durationMs: 1000, observedAt: now - 10000, ...overrides }))
}

test('a cold task receives a composed strategy without a fabricated winner', () => {
  assert(plan.modules.includes('reproduce'))
  assert(plan.modules.includes('implement'))
  assert(plan.modules.includes('verify'))
  assert.equal(selectHarnessCandidate(plan, [candidate], [], { now }).selected, null)
  const read = composeHarness({ kind: 'investigacao', difficulty: 'normal', readOnly: true, retry: true })
  assert(!read.modules.includes('implement'))
  assert(read.modules.includes('recover'))
  assert(read.modules.includes('reproduce'))
  assert(read.independentReviewRequired)
})

test('qualified current evidence chooses a model/effort pair using measured tokens and latency', () => {
  const expensive = { ...candidate, model: 'other-model', effort: 'high' as const }
  const evidence = [...observations(), ...observations({ id: 'replaced' }).map((e, i) => ({ ...e, id: `other-${i}`, candidate: expensive, tokens: 300 }))]
  const selected = selectHarnessCandidate(plan, [expensive, candidate], evidence, { now })
  assert.deepEqual(selected.selected, candidate)
  assert.equal(selected.samples, 40)
  assert(selected.qualityLowerBound! > .85)
  assert.equal(selected.costUsd, null, 'unknown cost is not free')
})

test('simulation, missing identities, repeated tasks and changed versions cannot qualify a model', () => {
  for (const evidence of [observations({ mode: 'simulated' }), observations({ partition: 'history' }), observations({ partition: 'calibration' }), observations({ identityConfirmed: false }), observations({ independentlyReviewed: false }), observations({ taskId: 'one-task' }), observations({ observedAt: now - 31 * 86400000 }), observations({ observedAt: now + 10000 }), observations({ tokens: null }), observations({ strategyKey: 'different' }), observations({ candidate: { ...candidate, cliVersion: 'old' } })]) {
    assert.equal(selectHarnessCandidate(plan, [candidate], evidence, { now }).selected, null)
  }
  const one = observations()[0]!
  assert.equal(selectHarnessCandidate(plan, [candidate], Array(100).fill(one), { now }).selected, null)
  assert.notEqual(harnessCandidateKey(candidate), harnessCandidateKey({ ...candidate, effort: 'high' }))
  assert.notEqual(harnessCandidateKey(candidate), harnessCandidateKey({ ...candidate, catalogRevision: 'new' }))
})

test('failures and contradictory duplicate attempts cannot be hidden behind accepted samples', () => {
  const samples = observations()
  const failures = observations({ outcome: 'failed' }).map((e, i) => ({ ...e, id: `failure-${i}` }))
  assert.equal(selectHarnessCandidate(plan, [candidate], [...samples, ...failures], { now }).selected, null)
  const conflicts = samples.map(e => ({ ...e, outcome: 'rejected' as const }))
  assert.equal(selectHarnessCandidate(plan, [candidate], [...samples, ...conflicts], { now }).selected, null)
})

test('high-risk work requires a stronger confidence bound and explicit choices never auto-route', () => {
  const highRisk = composeHarness({ kind: 'bug', difficulty: 'dificil', readOnly: false, retry: false })
  assert.equal(selectHarnessCandidate(highRisk, [candidate], observations({ strategyKey: highRisk.key }), { now }).selected, null)
  assert.equal(selectHarnessCandidate(plan, [candidate], observations(), { now, explicit: true }).selected, null)
  assert.notEqual(composeHarness({ kind: 'custom', difficulty: 'normal', readOnly: false, retry: false, constraintRevision: 'edited-method' }).key, plan.key)
})

test('different benchmark revisions and unmatched holdout tasks never share a ranking', () => {
  const other = { ...candidate, model: 'other-model' }
  const second = observations({ candidate: other }).map((e, i) => ({ ...e, id: `other-${i}` }))
  assert.equal(selectHarnessCandidate(plan, [candidate, other], [...observations(), ...second.map(e => ({ ...e, benchmarkKey: 'b'.repeat(64) }))], { now }).selected, null)
  assert.equal(selectHarnessCandidate(plan, [candidate, other], [...observations(), ...second.map(e => ({ ...e, taskId: `different-${e.taskId}` }))], { now }).selected, null)
})

test('a malformed or contradictory failure cannot disappear from an otherwise qualifying cohort', () => {
  const good = observations()
  assert.equal(selectHarnessCandidate(plan, [candidate], [...good, { ...good[0]!, id: 'bad-failure', outcome: 'failed', tokens: -1 }], { now }).selected, null)
  assert.equal(selectHarnessCandidate(plan, [candidate], [...good, { ...good[0]!, outcome: 'failed' }], { now }).selected, null)
})
