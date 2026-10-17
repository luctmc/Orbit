import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PaneManager } from '../src/panes.ts'
import type { DecisionReceipt } from '@orbit/protocol'

test('launch audit separates requested, resolved, applied and observed identities across process restarts', async () => {
  const manager = new PaneManager('/bin/sh', () => ({ file: '/bin/cat', args: [] }))
  const decision: DecisionReceipt = { version: 1, policyRevision: 'test-policy', catalogRevision: 'test-catalog', source: 'rule', requested: { cli: null, model: null, effort: null }, effective: { cli: 'codex', model: 'gpt-6-luna', effort: 'low', accountId: null }, reasons: ['simple task'], capabilityLimits: [], at: Date.now() }
  const input = { id: 1, decision, request: { missionId: 'm', role: 'crew' as const, cli: 'codex' as const, model: 'gpt-6-luna', title: 'Audit' }, squadRole: null, taskType: null, cwd: process.cwd(), launch: { cli: 'codex' as const, model: 'gpt-6-luna', effort: 'low' as const }, env: {}, hookDriven: true, accountId: null }
  try {
    const pane = manager.spawn(input)
    assert.deepEqual(pane.executionConfig?.decision.requested, { cli: null, model: null, effort: null })
    assert.deepEqual(pane.executionConfig?.applied, { model: 'gpt-6-luna', effort: 'low' })
    assert.equal(pane.reportedModels, undefined, 'launch is not provider evidence')
    manager.setReportedIdentity(1, { models: ['actual-provider-model'], efforts: ['medium'], level: 'execution-context' })
    assert.deepEqual(manager.get(1)?.reportedEfforts, ['medium'])
    assert.deepEqual(manager.get(1)?.reportedModels, ['actual-provider-model'])
    assert.equal(manager.get(1)?.identityEvidence, 'execution-context')
    manager.setReportedIdentity(1, { models: ['response-only'], efforts: [], level: 'response' })
    assert.deepEqual(manager.get(1)?.reportedEfforts, [], 'no stale effort associated with another source')
    manager.kill(1)
    const restarted = manager.spawn(input)
    assert.notEqual(restarted.executionEpoch, pane.executionEpoch)
    assert.equal(restarted.reportedModels, undefined)
    assert.equal(restarted.reportedEfforts, undefined)
  } finally { manager.killAll() }
})
