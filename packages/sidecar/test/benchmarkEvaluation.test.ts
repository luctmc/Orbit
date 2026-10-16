import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Pane } from '@orbit/protocol'
import { HarnessMeasurements, headlessUsage } from '../src/measurements.ts'
import { evaluateRuns, type BenchmarkRun } from '../src/benchmarks/evaluation.ts'

function run(configuration: 'eager' | 'budgeted', repetition: number, tokens = 100): BenchmarkRun {
  const measurements = new HarnessMeasurements()
  measurements.start({ id: 1, missionId: 'm', executionEpoch: 'epoch', cli: 'claude', model: 'pinned', role: 'crew' } as Pane, 2, configuration === 'eager' ? 1000 : 500, 1000)
  measurements.report('epoch', { input: tokens, output: 0, total: tokens, cacheRead: 0, cacheWrite: 0, costUsd: 0.01 }, 'status', undefined, 'claude-transcript-v1')
  return { version: 1, id: `${configuration}-${repetition}`, taskId: 'task', taskRevision: 'task-revision', corpusRevision: 'corpus', sourceRevision: 'source', mode: 'live', configuration, repetition, runtime: { node: 'v24', claude: 'pinned', codex: 'pinned' }, models: { worker: 'fixed-worker', reviewer: 'fixed-reviewer' }, limits: { tokens: 750000, knownClaudeCostUsd: .1 }, durationMs: 10, firstResponseMs: null, checks: [{ command: 'synthetic oracle', exitCode: 0, summary: 'synthetic fixture for evaluator unit test' }], accepted: true, resultReviewed: true, integrationReviewed: true, waived: false, error: null, executions: measurements.snapshot(), auxiliaryCalls: [], attempts: 1, retries: 0, reopenings: 0, results: 1 }
}

test('failed work remains in totals and cannot create a token-savings claim through survivor bias', () => {
  const failed = { ...run('budgeted', 2, 300), accepted: false, error: 'Failed oracle' }
  const summary = evaluateRuns([run('eager', 1, 1000), run('eager', 2, 1000), run('budgeted', 1, 400), failed], ['task'], 2)
  assert.equal(summary.profiles[1]!.tokens, 700)
  assert.equal(summary.profiles[1]!.tokensPerAccepted, 700)
  assert.equal(summary.qualityPreserved, false)
  assert.equal(summary.observedTokenReductionPercent, null)
})

test('incompatible, duplicate, unpaired or offline runs cannot pass the savings gate', () => {
  const baseline = run('eager', 1), candidate = run('budgeted', 1, 70)
  assert.ok(evaluateRuns([baseline, { ...candidate, models: { ...candidate.models, worker: 'different' } }], ['task'], 1).issues.length)
  assert.ok(evaluateRuns([baseline, candidate, candidate], ['task'], 1).issues.length)
  assert.equal(evaluateRuns([baseline], ['task'], 1).observedTokenReductionPercent, null)
  const offline = evaluateRuns([{ ...baseline, mode: 'offline' }, { ...candidate, mode: 'offline' }], ['task'], 1)
  assert.equal(offline.observedTokenReductionPercent, null)
  assert.equal(offline.target25Percent, null)
})

test('a comparable pilot reports an observation but cannot satisfy the full corpus target', () => {
  const summary = evaluateRuns([run('eager', 1, 100), run('budgeted', 1, 70)], ['task', 'missing'], 3)
  assert.ok(Math.abs(summary.observedTokenReductionPercent! - 30) < 1e-9)
  assert.equal(summary.fullMatrixComplete, false)
  assert.equal(summary.target25Percent, null)
})

test('model variance without an exercised context treatment is not a measured optimization', () => {
  const before = run('eager', 1, 100), after = run('budgeted', 1, 30)
  after.executions[0]!.initialBytes = before.executions[0]!.initialBytes
  const summary = evaluateRuns([before, after], ['task'], 1)
  assert.equal(summary.qualityPreserved, true)
  assert.equal(summary.treatmentObserved, false)
  assert.equal(summary.observedTokenReductionPercent, null)
  assert.equal(summary.target25Percent, null)
})

test('unknown auxiliary calls and native usage keep totals unknown instead of zero', () => {
  const candidate = run('budgeted', 1)
  candidate.auxiliaryCalls.push({ id: 'pending', missionId: 'm', attemptId: 'attempt', kind: 'classifier', model: 'fixed', promptBytes: 100, startedAt: 1, finishedAt: null, observation: null })
  const summary = evaluateRuns([run('eager', 1), candidate], ['task'], 1)
  assert.equal(summary.tokenCoverage, false)
  assert.equal(summary.profiles[1]!.tokens, null)
  assert.equal(summary.observedTokenReductionPercent, null)
})

test('headless usage preserves unknown fields, cache components and zero-cost error placeholders', () => {
  assert.equal(headlessUsage('{"usage":{"input_tokens":5}}').usage.total, null)
  const complete = headlessUsage(JSON.stringify({ usage: { input_tokens: 7, output_tokens: 3, cache_read_input_tokens: 5, cache_creation_input_tokens: 2 }, total_cost_usd: 0.001 }))
  assert.equal(complete.usage.total, 17)
  assert.equal(complete.usage.costUsd, .001)
  assert.equal(headlessUsage('{"is_error":true,"usage":{"input_tokens":0,"output_tokens":0},"total_cost_usd":0}').usage.costUsd, null)
})

test('measurement separates bytes, epochs, PTY output and report coverage without storing text', () => {
  const meter = new HarnessMeasurements(), pane = { id: 1, missionId: 'm', executionEpoch: 'old', cli: 'claude', model: 'pinned', role: 'crew' } as Pane
  meter.start(pane, 1, 20, 30)
  meter.bytes('old', 'contextReadBytes', 'ação')
  meter.output('old'); meter.output('old')
  meter.wakeup('old')
  const delta = { input: 10, output: 0, total: 10, cacheRead: 0, cacheWrite: 0, costUsd: null }
  meter.report('old', delta, 'status', { total: false, costUsd: false })
  assert.equal(meter.snapshot()[0]!.usage.total, null)
  meter.report('old', { ...delta, input: 0, output: 2, total: 2, costUsd: .001 }, 'status', { total: true, costUsd: true })
  assert.equal(meter.snapshot()[0]!.usage.total, 12, 'later complete report includes the earlier partial delta')
  meter.report('old', delta, 'status', { costUsd: false })
  assert.equal(meter.snapshot()[0]!.usage.costUsd, null, 'new unpriced usage makes cost coverage incomplete')
  meter.start({ ...pane, executionEpoch: 'new' }, 1, 20, 30)
  const records = meter.snapshot()
  assert.equal(records[0]!.contextReadBytes, Buffer.byteLength('ação'))
  assert.ok(records[0]!.firstPtyOutputMs !== null)
  assert.equal(records[1]!.usage.total, null)
  assert.equal(records[1]!.ptyAcceptedWakeups, 0)
  assert.equal(JSON.stringify(records).includes('ação'), false)
})
