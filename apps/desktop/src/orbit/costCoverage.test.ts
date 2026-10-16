import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sumCost } from './costCoverage.ts'

test('missing cost, reported zero and partial known subtotals remain distinguishable', () => {
  assert.deepEqual(sumCost([{ costUsd: null }]), { costUsd: null, costComplete: false })
  assert.deepEqual(sumCost([{ costUsd: 0, costComplete: true }]), { costUsd: 0, costComplete: true })
  assert.deepEqual(sumCost([{ costUsd: 0.02, costComplete: true }, { costUsd: null }]), { costUsd: 0.02, costComplete: false })
  assert.deepEqual(sumCost([{ costUsd: 0.01, costComplete: false }, { costUsd: 0.02, costComplete: true }]), { costUsd: 0.03, costComplete: false })
})
