import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './r2Fixture.ts'

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

test('F5a: three returns within five seconds share one wake with independent receipts', async () => {
  const f = await fixture()
  try {
    const helpers = [f.pane]
    for (let n = 0; n < 2; n++) helpers.push((await f.core.spawnHelper(f.lead, { title: `Helper ${n}`, task: 'Read synthetic input', cli: 'claude', model: null })).pane)
    const panes = (f.core as any).panes
    const submit = panes.submitWithReceipt.bind(panes)
    const wakes: string[] = []
    panes.submitWithReceipt = (id: number, text: string, ...args: any[]) => {
      if (id === f.lead.id) wakes.push(text)
      return submit(id, text, ...args)
    }
    for (const [i, pane] of helpers.entries()) {
      f.core.handoff(pane, { summary: `Return ${i}`, evidence: 'Synthetic check exit 0' })
      if (i < 2) await delay(1900)
    }
    await delay(6500)
    assert.equal(wakes.length, 1)
    const notices = f.core.store.notifications(f.lead.missionId)
    assert.equal(notices.length, 3)
    assert.equal(new Set(notices.map(n => n.id)).size, 3)
    for (const notice of notices) {
      assert.ok(wakes[0]!.includes(notice.id))
      assert.ok(wakes[0]!.includes(notice.text))
      assert.equal(notice.deliveries.length, 1)
      assert.equal(f.core.acknowledgeDelivery(f.lead, notice.id).state, 'agent_acknowledged')
    }
    assert.equal(f.core.store.activityHistory(f.lead.missionId).results.length, 3)
  } finally { await f.core.shutdown() }
})

test('F5b: startup resumes an idle conversation without a continuation prompt', async () => {
  const f = await fixture()
  try {
    f.core.handoff(f.pane, { summary: 'Finished', evidence: 'Synthetic check exit 0' })
    f.core.hookReport(f.pane.id, { hook_event_name: 'SessionStart', session_id: '3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f' })
    await f.core.shutdown()
    const restored = f.create()
    try {
      restored.store.saveSettings({ ...restored.store.settings(), resumeOnStart: true })
      const launches: any[] = []
      const panes = (restored as any).panes
      const command = panes.command
      panes.command = (launch: any, shell: string) => { launches.push(launch); return command(launch, shell) }
      await restored.resumeCrews()
      const pane = restored.store.pane(f.pane.id)!
      assert.notEqual(pane.executionEpoch, f.pane.executionEpoch)
      assert.equal(launches.length, 1)
      assert.equal(launches[0].taskPath, undefined)
      assert.equal(restored.store.activityHistory(pane.missionId).results.length, 1)
      assert.equal(restored.pendingDeliveries(pane.missionId).length, 0)
    } finally { await restored.shutdown() }
  } finally { await f.core.shutdown() }
})
