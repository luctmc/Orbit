import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './r2Fixture.ts'
import { dayKey } from '../src/store.ts'
import { Store } from '../src/store.ts'

test('usage without a reported USD amount stays unknown in the ledger', async () => {
  const { core, pane } = await fixture()
  try {
    core.statusReport(pane.id, { context_window: { total_input_tokens: 20, total_output_tokens: 5 }, orbit_session_usage: { format: 'claude-transcript-v1', input: 20, output: 5, cacheRead: 0, cacheWrite: 0, total: 20 + 5 } })
    const entry = core.store.ledger(dayKey(Date.now()).slice(0, 7))[0]!
    assert.equal(entry.tokens, 25)
    assert.equal(entry.costUsd, null)
  } finally { await core.shutdown() }
})

test('classification usage is charged even when its JSON cannot classify the task', async () => {
  const { core, lead, root } = await fixture()
  try {
    let calls = 0
    ;(core as any).run = async () => {
      calls++
      return { code: 0, stdout: JSON.stringify({ structured_output: { kind: 'unknown' }, usage: { input_tokens: 7, output_tokens: 3, cache_read_input_tokens: 5, cache_creation_input_tokens: 2 }, total_cost_usd: 0.0002 }), stderr: '' }
    }
    await core.spawnHelper(lead, { title: 'Lista lenta', task: 'A lista de pedidos leva 8 segundos para aparecer', model: null, readOnly: true })
    assert.equal(calls, 1)
    assert.equal(core.store.mission(lead.missionId)!.usage.total, 17)
    assert.equal(core.store.mission(lead.missionId)!.usage.costUsd, 0.0002)
    const call = core.store.auxiliaryCalls(lead.missionId)[0]!
    assert.equal(call.observation!.outcome, 'invalid')
    core.store.finishAuxiliaryCall(call.id, call.observation!)
    assert.equal(core.store.mission(lead.missionId)!.usage.total, 17)
    for (let i = 0; i < 10; i++) { core.missionPanes(lead.missionId); core.routing(); core.capacity(lead.missionId) }
    assert.equal(calls, 1, 'state lookups never call the classifier')
    await core.shutdown()
    const recovered = new Store(`${root}/data`)
    assert.equal(recovered.auxiliaryCalls(lead.missionId)[0]!.id, call.id)
    recovered.finishAuxiliaryCall(call.id, call.observation!)
    assert.equal(recovered.mission(lead.missionId)!.usage.total, 17)
  } finally { await core.shutdown() }
})

test('later unpriced usage preserves the known subtotal and marks it partial', async () => {
  const { core, pane } = await fixture()
  try {
    core.statusReport(pane.id, { context_window: { total_input_tokens: 20, total_output_tokens: 5 }, orbit_session_usage: { format: 'claude-transcript-v1', input: 20, output: 5, cacheRead: 0, cacheWrite: 0, total: 20 + 5 }, cost: { total_cost_usd: .01 } })
    core.statusReport(pane.id, { context_window: { total_input_tokens: 40, total_output_tokens: 5 }, orbit_session_usage: { format: 'claude-transcript-v1', input: 40, output: 5, cacheRead: 0, cacheWrite: 0, total: 40 + 5 } })
    const entry = core.store.ledger(dayKey(Date.now()).slice(0, 7))[0]!
    assert.equal(entry.costUsd, .01)
    assert.equal(entry.costComplete, false)
  } finally { await core.shutdown() }
})

test('classifier usage trips the mission budget before launching the next helper', async () => {
  const { core, lead } = await fixture()
  try {
    core.handle({ type: 'mission.budget', missionId: lead.missionId, tokens: 10, costUsd: null })
    ;(core as any).run = async () => ({ code: 0, stdout: JSON.stringify({ structured_output: { kind: 'investigacao' }, usage: { input_tokens: 12, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }), stderr: '' })
    await assert.rejects(core.spawnHelper(lead, { title: 'Lista lenta', task: 'A lista de pedidos leva 8 segundos para aparecer', model: null, readOnly: true }), /orçamento/)
    assert.equal(core.store.mission(lead.missionId)!.usage.total, 13)
    assert.equal(core.store.mission(lead.missionId)!.budget!.exceeded, true)
    assert.equal(core.store.snapshot().panes.length, 2)
  } finally { await core.shutdown() }
})
