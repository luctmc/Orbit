import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture } from './r2Fixture.ts'

test('a real helper spawn persists its strategy and delivers bounded instructions without replacing explicit choices', async () => {
  const f = await fixture()
  try {
    const attempt = f.core.store.activityHistory(f.lead.missionId).attempts.find(a => a.paneId === f.pane.id)!
    assert.equal(attempt.decision?.harness?.status, 'explicit')
    assert(attempt.decision!.harness!.strategy.modules.includes('verify'))
    assert.equal(attempt.decision!.effective.cli, 'claude')
    const context = JSON.parse(readFileSync(join(f.root, 'data/panes', String(f.pane.id), 'context.json'), 'utf8'))
    assert.match(context.role.text, /Execution strategy/)
    assert.match(context.role.text, /never changes permissions/)
    assert.deepEqual(context.decision.harness, attempt.decision!.harness)
    assert.equal(f.core.store.harnessEvidence().length, 0, 'starting is not measured success')
    const { pane } = await f.core.spawnHelper(f.lead, { title: 'Investigação sintética', task: 'Inspect synthetic fixture', cli: 'codex', model: null, readOnly: true })
    const read = f.core.store.activityHistory(f.lead.missionId).attempts.find(a => a.paneId === pane.id)!.decision!.harness!
    assert(read.strategy.readOnly)
    assert(!read.strategy.modules.includes('implement'))
    assert.equal(read.selected, null)
  } finally { await f.core.shutdown() }
})

test('a qualified seat reaches the launch unchanged by the legacy tier or balancing rules', async () => {
  const f = await fixture()
  try {
    const { createHash } = await import('node:crypto')
    const { blankStatus } = await import('../src/clis.ts')
    const core = f.core as any
    const entry = { models: [{ id: 'fixture-measured-model', label: 'Fixture', description: '', efforts: ['low', 'high'], defaultEffort: 'low' }], efforts: ['low', 'high'], source: 'cli' }
    core.catalog = Object.fromEntries(['claude', 'codex', 'gemini', 'antigravity'].map(cli => [cli, entry]))
    core.clis.set('codex', { ...blankStatus('codex'), installed: true, version: 'fixture-v1', checkedAt: Date.now() })
    core.accountStatus.set('codex', { accountId: 'codex', loggedIn: true, checkedAt: Date.now(), busy: null })
    const window = { usedPercent: 10, resetsAt: Date.now() + 3600000, windowMinutes: 300 }
    f.core.store.setLimits({ accountId: 'codex', cli: 'codex', source: 'provider', updatedAt: Date.now(), plan: null, fiveHour: window, weekly: window })
    const request = { title: 'Synthetic bounded bug', task: 'Inspect a synthetic bug only', model: null, taskTypeId: 'bug', difficulty: 'simples' as const, readOnly: true }
    const initial = await f.core.spawnHelper(f.lead, { ...request, activityId: 'cold-fixture' })
    const strategy = f.core.store.currentPaneAttempt(initial.pane.id)!.decision!.harness!.strategy
    const candidate = { cli: 'codex' as const, model: 'fixture-measured-model', effort: 'high' as const, cliVersion: 'fixture-v1', catalogRevision: createHash('sha256').update(JSON.stringify(core.catalog)).digest('hex') }
    const { harnessAccounts, harnessCandidates } = await import('../src/harnessEligibility.ts')
    assert.equal(harnessCandidates(core.catalog, [...core.clis.values()], harnessAccounts(f.core.store.accounts(), [...core.accountStatus.values()], f.core.store.limits()), ['claude', 'codex'], false).length, 2, JSON.stringify([...core.clis.values()]))
    const original = f.core.store.harnessEvidence.bind(f.core.store)
    // Synthetic evidence is injected only in this test, never written/imported into application state.
    f.core.store.harnessEvidence = () => Array.from({ length: 40 }, (_, i) => ({ version: 1, id: `fixture-${i}`, taskId: `fixture-task-${i % 10}`, projectId: `fixture-project-${i % 3}`, strategyKey: strategy.key, candidate, mode: 'live', partition: 'holdout', benchmarkKey: 'a'.repeat(64), outcome: 'accepted', independentlyReviewed: true, identityConfirmed: true, tokens: 100, costUsd: null, durationMs: 1000, observedAt: Date.now() - 1000 }))
    try {
      const { selectHarnessCandidate } = await import('../src/harness.ts')
      assert.equal(selectHarnessCandidate(strategy, [candidate], f.core.store.harnessEvidence()).status, 'measured')
      assert(f.core.store.mission(f.lead.missionId)!.allowedClis.includes('codex'), JSON.stringify(f.core.store.mission(f.lead.missionId)!.allowedClis))
      const next = await f.core.spawnHelper(f.lead, { ...request, title: 'Second bounded fixture', activityId: 'measured-fixture' })
      assert.equal(next.pane.cli, 'codex')
      assert.equal(next.pane.model, candidate.model)
      assert.equal(next.pane.effort, 'high', 'simple tier must not silently lower a measured effort')
      const decision = f.core.store.currentPaneAttempt(next.pane.id)!.decision!
      assert.equal(decision.harness!.status, 'measured')
      assert.equal(decision.source, 'benchmark')
      assert.equal(decision.harness!.executionMode, 'simulated')
      assert.deepEqual(decision.harness!.executed, candidate)
    } finally { f.core.store.harnessEvidence = original }
  } finally { await f.core.shutdown() }
})
