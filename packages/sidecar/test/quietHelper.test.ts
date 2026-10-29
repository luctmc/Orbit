import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './r2Fixture.ts'

test('F9 quiet is one informational event per silence period, reset by output and hooks', async (t) => {
  let now = Date.now()
  t.mock.method(Date, 'now', () => now)
  const { core, lead, pane } = await fixture()
  try {
    const manager = (core as any).panes
    const submissions = t.mock.method(manager, 'submitWithReceipt')
    const nudges = t.mock.method(manager, 'submit')
    const kills = t.mock.method(manager, 'kill')
    const history = core.store.activityHistory(lead.missionId)
    const before = core.store.pane(pane.id)
    const quiet = () => core.missionEvents(lead.missionId).filter(e => e.kind === 'pane.quiet')
    now += 599_999; core.dispatchDeliveries(); assert.equal(quiet().length, 0)
    now++; core.dispatchDeliveries(); assert.equal(quiet().length, 1)
    now += 600_000; core.dispatchDeliveries(); assert.equal(quiet().length, 1)
    assert.match(core.missionBriefing(lead.missionId), /agent_read uma vez/)
    assert.match(quiet()[0]!.body, /agent_read.*uma vez/i)
    assert.match(quiet()[0]!.body, /nunca.*reenvi/i)
    assert.deepEqual(core.store.activityHistory(lead.missionId), history)
    assert.deepEqual(core.store.pane(pane.id), before)
    manager.emit('data', pane.id, 'Still working')
    now += 600_000; core.dispatchDeliveries(); assert.equal(quiet().length, 2)
    core.hookReport(pane.id, { hook_event_name: 'PreToolUse', tool_name: 'Read' })
    now += 600_000; core.dispatchDeliveries(); assert.equal(quiet().length, 3)
    assert.equal(core.missionPanes(lead.missionId).length, 2)
    assert.equal(core.store.notifications(lead.missionId).length, 0)
    assert.equal(submissions.mock.callCount(), 0)
    assert.equal(nudges.mock.callCount(), 0)
    assert.equal(kills.mock.callCount(), 0)
    core.closeHelper(lead, pane.id, true)
    now += 600_000; core.dispatchDeliveries(); assert.equal(quiet().length, 3)
  } finally { await core.shutdown() }
})
