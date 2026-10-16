import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aggregateTrialAccounting } from '../src/benchmarks/trialAccounting.ts'
import type { HarnessAttemptUsage } from '../src/harnessEvidence.ts'
const row: HarnessAttemptUsage = { attemptId: 'a', executionEpoch: 'e', mode: 'live', tokens: 12, costUsd: null, consumption: { input: 9, output: 3, cacheRead: 5, cacheWrite: 0, total: 12 }, reportedModels: ['test-model'], reportedEffort: 'low', identityComplete: true, identityLevel: 'response', updatedAt: 1 }
test('trial accounting includes failed/reviewer phases and never hides missing usage', () => {
  assert.equal(aggregateTrialAccounting([row, { ...row, attemptId: 'review' }]).usage.total, 24)
  const incomplete = aggregateTrialAccounting([row, null])
  assert.equal(incomplete.usage.total, null)
  assert.equal(incomplete.identity.complete, false)
  const auxiliary = { id: 'x', missionId: 'm', attemptId: 'a', kind: 'classifier' as const, model: 'classifier', promptBytes: 100, startedAt: 1, finishedAt: 2, observation: { exitCode: 1, durationMs: 1, outcome: 'error' as const, usage: { input: 2, cacheRead: 3, cacheWrite: 1, output: 4, total: 10, costUsd: .1 }, reportedModels: ['classifier'] } }
  const combined = aggregateTrialAccounting([row], [auxiliary])
  assert.equal(combined.usage.total, 22)
  assert.equal(combined.usage.input, 15)
  assert.equal(combined.usage.costUsd, null)
  assert.equal(combined.identity.complete, false)
  assert.deepEqual(combined.identity.models, ['classifier', 'test-model'])
})
