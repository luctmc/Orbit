import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './r2Fixture.ts'

const pause = (ms: number) => new Promise(r => setTimeout(r, ms))
async function sent(f: Awaited<ReturnType<typeof fixture>>, id: string) {
  for (let n = 0; n < 800; n++) {
    if (f.core.store.notifications(f.lead.missionId).find(v => v.id === id)?.state === 'pty_accepted') return
    await pause(10)
  }
  assert.fail('Fixture receipt was not written to the recipient PTY')
}

test('an explicit ACK context supplies the delivery contract without accepting code or repeating lookups', async () => {
  const f = await fixture()
  try {
    const { pane } = await f.core.spawnHelper(f.lead, { title: 'Reviewable delivery', task: 'Read fixture', cli: 'claude', model: null, readOnly: true, accept: ['Original criterion'] })
    const { resultId } = f.core.handoff(pane, { summary: 'Fixture result', evidence: 'synthetic command exit 0', details: 'located fixture finding', criteria: [{ item: 1, met: true, how: 'fixture observation' }] })
    const notice = f.core.store.notifications(f.lead.missionId).find(n => n.resultId === resultId)!
    await sent(f, notice.id)
    const before = JSON.stringify(f.core.store.activityHistory(f.lead.missionId))
    const legacy = f.core.acknowledgeDelivery(f.lead, notice.id)
    assert.equal('context' in legacy, false, 'existing callers retain the original reply')
    const ack = (f.core.acknowledgeDelivery as any)(f.lead, notice.id, true)
    assert.equal(ack.state, 'agent_acknowledged')
    assert.equal(ack.context.result.id, resultId)
    assert.equal(ack.context.result.attemptId, pane.activityAttemptId)
    assert.equal(ack.context.result.evidence, 'synthetic command exit 0')
    assert.deepEqual(ack.context.result.acceptance, ['Original criterion'])
    assert.equal(ack.context.current, true)
    assert.equal(ack.context.sourceFreshness, 'not_checked')
    assert.equal(ack.context.activity.state, 'awaiting_validation')
    assert.deepEqual(ack.context.truncatedFields, [])
    assert.equal(JSON.stringify(f.core.store.activityHistory(f.lead.missionId)), before)
    assert.equal(f.core.store.verifications(f.lead.missionId).length, 0)
    assert.throws(() => f.core.missionReady(f.lead, 'ACK is not acceptance', false), /retorno|validação/)
    f.core.closeHelper(f.lead, pane.id)
    assert.deepEqual((f.core.acknowledgeDelivery as any)(f.lead, notice.id, true), ack, 'closed panes do not remove delivered context')
  } finally { await f.core.shutdown() }
})

test('ACK context is bounded, identifies superseded results and preserves recipient/epoch authorization', async () => {
  const f = await fixture()
  try {
    const first = f.core.handoff(f.pane, { summary: 'First result', evidence: 'e'.repeat(7000), details: 'd'.repeat(7000) })
    const notice = f.core.store.notifications(f.lead.missionId).find(n => n.resultId === first.resultId)!
    await sent(f, notice.id)
    assert.throws(() => (f.core.acknowledgeDelivery as any)(f.pane, notice.id, true), /destinatário/)
    assert.equal(f.core.store.notifications(f.lead.missionId)[0]!.state, 'pty_accepted')
    const ack = (f.core.acknowledgeDelivery as any)(f.lead, notice.id, true)
    assert.equal(ack.context.result.evidence.length, 4000)
    assert.equal(ack.context.result.details.length, 2000)
    assert.deepEqual(ack.context.truncatedFields, ['details'], 'handoff already bounds evidence to 4000 characters')
    assert.equal(ack.text, undefined, 'compact reply does not repeat the notice text')
    assert.deepEqual(ack.context.more, { tool: 'handoff_list', arguments: { resultId: first.resultId, view: 'detail' } })
    assert.ok(JSON.stringify(ack).length < 10000)
    f.core.handoff(f.pane, { summary: 'Replacement result', evidence: 'different fixture evidence' })
    const historical = (f.core.acknowledgeDelivery as any)(f.lead, notice.id, true)
    assert.equal(historical.context.current, false)
    assert.equal(historical.context.result.id, first.resultId)
    assert.equal(historical.context.result.summary, 'First result')
    await f.core.spawnHelper(f.lead, { activityId: historical.context.result.activityId, title: 'New contract', task: 'Read revised fixture', cli: 'claude', model: null, readOnly: true, retryReason: 'Acceptance contract changed', accept: ['New criterion'] })
    const oldContract = (f.core.acknowledgeDelivery as any)(f.lead, notice.id, true)
    assert.equal(oldContract.context.current, false)
    assert.deepEqual(oldContract.context.result.acceptance, [], 'historical result cannot inherit the new contract criteria')
    assert.ok(oldContract.context.activity.revision > oldContract.context.result.activityRevision)
    await f.core.handle({ type: 'pane.restart', paneId: f.lead.id, resume: false })
    assert.throws(() => (f.core.acknowledgeDelivery as any)(f.lead, notice.id, true), /execução/)
  } finally { await f.core.shutdown() }
})
