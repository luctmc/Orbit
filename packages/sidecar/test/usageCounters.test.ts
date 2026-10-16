import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fromCodexRollout } from '../src/usage.ts'
import { accountReport, type SessionBaseline } from '../src/sessionAccounting.ts'
import type { Pane } from '@orbit/protocol'

// Official usage example adapted to the CLI's flat token_count shape, not a captured rollout.
const report = (reasoning?: number) => fromCodexRollout(JSON.stringify({ type: 'event_msg', payload: {
  type: 'token_count', info: { total_token_usage: {
    input_tokens: 75, output_tokens: 1186, total_tokens: 1261,
    ...(reasoning === undefined ? {} : { reasoning_output_tokens: reasoning }),
  } },
} }))

for (const reasoning of [1024, 0, undefined]) test(`Codex output already includes reasoning (${reasoning ?? 'absent'})`, () => {
  const actual = report(reasoning)
  assert.equal(actual.usage!.output, 1186)
  assert.equal(actual.usage!.input + actual.usage!.output, actual.usage!.total)
  assert.equal(actual.usage!.costUsd, null)
  assert.equal(actual.observed!.output, true)
  assert.equal(actual.observed!.costUsd, false)
})

test('normalized reasoning output is charged once across replay and a new cumulative report', () => {
  const baselines: SessionBaseline[] = []
  const pane = { cli: 'codex', accountId: null, sessionId: 'fixture-session', missionId: 'm', executionEpoch: 'first' } as Pane
  const first = report(1024).usage!
  assert.equal(accountReport(baselines, pane, first, 'rollout', 1).delta.output, 1186)
  const resumed = { ...pane, executionEpoch: 'second' }
  assert.equal(accountReport(baselines, resumed, first, 'rollout', 2).delta.total, 0)
  const next = { ...first, input: 100, output: 1300, total: 1400 }
  const added = accountReport(baselines, resumed, next, 'rollout', 3)
  assert.equal(added.delta.output, 114)
  assert.equal(added.delta.input + added.delta.output, added.delta.total)
  assert.equal(added.usage.costUsd, null)
  assert.equal(baselines.length, 1)
})
