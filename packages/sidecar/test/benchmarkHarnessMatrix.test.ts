import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateHarnessMatrix, type HarnessMatrix } from '../src/benchmarks/harnessMatrix.ts'
import { composeHarness } from '../src/harness.ts'
const strategy = composeHarness({ kind: 'bug', difficulty: 'normal', readOnly: false, retry: false })
const candidate = { cli: 'codex' as const, model: 'fixture', effort: 'low' as const, cliVersion: 'fixture-v1', catalogRevision: 'fixture-catalog' }
function matrix(): HarnessMatrix {
  const cases = ['calibration-case', 'holdout-case'].map((id, i) => ({ id, revision: (i ? 'e' : 'a').repeat(64), projectId: 'fixture-project', partition: i ? 'holdout' as const : 'calibration' as const, strategyKey: strategy.key }))
  return { version: 1, corpusRevision: 'b'.repeat(64), sourceRevision: 'c'.repeat(64), oracleRevision: 'd'.repeat(64), strategies: [strategy], candidates: [candidate], cases, repetitions: 1, runs: cases.map((c, i) => ({ id: `run-${i}`, caseId: c.id, candidate, repetition: 1, mode: 'simulated', outcome: 'accepted', independentlyReviewed: true, identityConfirmed: true, tokens: 100, costUsd: null, durationMs: 1000, observedAt: Date.now() - 100 })) }
}
test('offline matrix validates the complete path but cannot produce live promotion evidence', () => {
  const result = evaluateHarnessMatrix(matrix())
  assert.deepEqual(result.issues, [])
  assert.equal(result.promotionEvidence.length, 0)
  assert.equal(result.rows[0]!.tokens, 200)
  assert.equal(result.rows[0]!.costUsd, null)
})
test('missing runs, duplicated IDs and calibration/holdout leakage block the entire matrix', () => {
  const missing = matrix(); missing.runs.pop()
  assert(evaluateHarnessMatrix(missing).issues.length)
  const leak = matrix(); leak.cases[1]!.id = leak.cases[0]!.id
  assert(evaluateHarnessMatrix(leak).issues.length)
  const duplicate = matrix(); duplicate.runs.push(duplicate.runs[0]!)
  assert(evaluateHarnessMatrix(duplicate).issues.length)
})
test('live failures remain in spend and denominator, while missing identity prevents promotion', () => {
  const live = matrix(); live.runs.forEach(r => { r.mode = 'live' }); live.runs[1]!.outcome = 'failed'; live.runs[1]!.tokens = 300
  const result = evaluateHarnessMatrix(live)
  assert.equal(result.rows[0]!.tokens, 400)
  assert.equal(result.rows[0]!.accepted, 1)
  assert.equal(result.promotionEvidence.length, 1)
  assert.equal(result.promotionEvidence[0]!.outcome, 'failed')
  assert.equal(result.promotionEvidence[0]!.partition, 'holdout')
  live.runs[1]!.identityConfirmed = false
  assert.equal(evaluateHarnessMatrix(live).promotionEvidence.length, 0)
})
