import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './r2Fixture.ts'
import { acceptSyntheticResult } from './reviewFixture.ts'

for (const status of ['progress', 'blocked', 'done', 'auto'] as const) {
  test(`F6a: retry rejects stale ${status} results and messages`, async () => {
    const f = await fixture()
    try {
      const attempt = f.core.store.currentPaneAttempt(f.pane.id)!
      f.core.closeHelper(f.lead, f.pane.id, true)
      await f.core.spawnHelper(f.lead, { activityId: attempt.activityId, title: 'Retry', task: 'Read synthetic input', cli: 'claude', model: null, retryReason: 'Retry synthetic assignment' })
      const before = f.core.store.activityHistory(f.lead.missionId).results.length
      assert.throws(() => f.core.store.commitActivityResult(f.pane, { status, summary: 'Late result', evidence: 'exit 0', details: '', deliveredTo: f.lead.id }, { title: 'Late', body: 'Late' }), /stale_dispatch/)
      if (status !== 'auto') assert.throws(() => f.core.handoff(f.pane, { status, summary: 'Late result', evidence: 'exit 0', attemptId: attempt.id }), /stale_dispatch/)
      assert.throws(() => f.core.sendTo(f.pane, f.lead.id, 'Late message'), /stale_dispatch/)
      assert.equal(f.core.store.activityHistory(f.lead.missionId).results.length, before)
      assert.equal(f.core.store.notifications(f.lead.missionId).length, 0)
    } finally { await f.core.shutdown() }
  })
}

test('F6a: a new assignment fences the previous caller and explicit attempt id', async () => {
  const f = await fixture()
  try {
    f.core.handoff(f.pane, { summary: 'First result', evidence: 'exit 0' })
    f.core.sendTo(f.lead, f.pane.id, 'New assignment', true)
    const current = f.core.store.pane(f.pane.id)!
    assert.notEqual(current.activityAttemptId, f.pane.activityAttemptId)
    assert.throws(() => f.core.handoff(f.pane, { summary: 'Late progress', status: 'progress' }), /stale_dispatch/)
    assert.throws(() => f.core.handoff(current, { summary: 'Late progress', status: 'progress', attemptId: f.pane.activityAttemptId }), /stale_dispatch/)
    assert.throws(() => f.core.sendTo(current, f.lead.id, 'Late message', false, f.pane.activityAttemptId), /stale_dispatch/)
  } finally { await f.core.shutdown() }
})

test('F6b: retry supersedes an unaccepted notice without delivering it', async () => {
  const f = await fixture()
  try {
    f.core.handoff(f.pane, { summary: 'Old blocked result', status: 'blocked' })
    const notice = f.core.store.notifications(f.lead.missionId)[0]!
    const attempt = f.core.store.currentPaneAttempt(f.pane.id)!
    f.core.closeHelper(f.lead, f.pane.id, true)
    await f.core.spawnHelper(f.lead, { activityId: attempt.activityId, title: 'Retry', task: 'Read synthetic input', cli: 'claude', model: null, retryReason: 'Replace blocked work' })
    assert.equal(f.core.store.notifications(f.lead.missionId).find(n => n.id === notice.id)!.state, 'superseded')
    assert.equal(f.core.store.notifications(f.lead.missionId, true).length, 0)
  } finally { await f.core.shutdown() }
})

for (const status of ['progress', 'blocked', 'done'] as const) {
  test(`F6c: auto does not replace an existing real ${status} result`, async () => {
    const f = await fixture()
    try {
      const first = f.core.handoff(f.pane, { summary: 'Real result', status, evidence: 'exit 0' })
      const before = f.core.store.activityHistory(f.lead.missionId)
      const notices = f.core.store.notifications(f.lead.missionId)
      const auto = f.core.store.commitActivityResult(f.core.store.pane(f.pane.id)!, { summary: 'Late Stop hook', status: 'auto', evidence: '', details: '', deliveredTo: f.lead.id }, { title: 'Stop', body: 'Late Stop hook' })
      assert.equal(auto.result.id, first.resultId)
      assert.equal(auto.duplicate, true)
      assert.deepEqual(f.core.store.activityHistory(f.lead.missionId), before)
      assert.deepEqual(f.core.store.notifications(f.lead.missionId), notices)
      assert.equal(f.core.store.pane(f.pane.id)!.handoffStatus, status)
    } finally { await f.core.shutdown() }
  })
}

test('F6a: replacing unfinished work creates a fresh attempt in the same terminal', async () => {
  const f = await fixture()
  try {
    f.core.handoff(f.pane, { summary: 'Checkpoint', status: 'progress' })
    f.core.sendTo(f.lead, f.pane.id, 'Replacement assignment', true)
    const current = f.core.store.pane(f.pane.id)!
    assert.notEqual(current.activityAttemptId, f.pane.activityAttemptId)
    assert.throws(() => f.core.sendTo(f.pane, f.lead.id, 'Late checkpoint'), /stale_dispatch/)
  } finally { await f.core.shutdown() }
})


test('F6c: a late Stop result preserves independently accepted work', async () => {
  const f = await fixture()
  try {
    const first = f.core.handoff(f.pane, { summary: 'Verified work', evidence: 'Synthetic check exit 0' })
    acceptSyntheticResult(f.core, f.lead, first.resultId)
    const before = f.core.store.activityHistory(f.lead.missionId)
    const notices = f.core.store.notifications(f.lead.missionId)
    const auto = f.core.store.commitActivityResult(f.pane, { status: 'auto', summary: 'Late Stop', evidence: '', details: '', deliveredTo: f.lead.id }, { title: 'Stop', body: 'Late Stop' })
    assert.equal(auto.duplicate, true)
    assert.equal(auto.result.id, first.resultId)
    assert.deepEqual(f.core.store.activityHistory(f.lead.missionId), before)
    assert.deepEqual(f.core.store.notifications(f.lead.missionId), notices)
  } finally { await f.core.shutdown() }
})

test('F6c: a delayed Stop callback cannot change the pane after a real result', async () => {
  const f = await fixture()
  try {
    const callbackPane = { ...f.pane }
    f.core.handoff(f.pane, { summary: 'Real result before Stop', evidence: 'Synthetic check exit 0' })
    const before = f.core.store.activityHistory(f.lead.missionId)
    const notices = f.core.store.notifications(f.lead.missionId)
    ;(f.core as any).turnEnded(callbackPane, 'Delayed Stop callback', false)
    assert.equal(f.core.store.pane(f.pane.id)!.handoffStatus, 'done')
    assert.deepEqual(f.core.store.activityHistory(f.lead.missionId), before)
    assert.deepEqual(f.core.store.notifications(f.lead.missionId), notices)
  } finally { await f.core.shutdown() }
})

for (const replacement of ['assignment', 'replace'] as const) {
  test(`F6b: ${replacement} supersedes only unaccepted notices and rejects late acceptance`, async () => {
    const f = await fixture()
    try {
      f.core.handoff(f.pane, { summary: 'Old blocked result', status: 'blocked' })
      const notice = f.core.store.notifications(f.lead.missionId)[0]!
      if (replacement === 'assignment') f.core.sendTo(f.lead, f.pane.id, 'Replacement task', true)
      else {
        const next = await f.core.spawnHelper(f.lead, { title: 'Replacement', task: 'Read another fixture', cli: 'claude', model: null })
        f.core.store.replaceDelivery(f.lead.missionId, f.pane.id, next.pane.id, f.lead.id, 'Replace fixture')
      }
      f.core.store.markNoticeAccepted(notice.id, f.lead)
      const old = f.core.store.notifications(f.lead.missionId).find(n => n.id === notice.id)!
      assert.equal(old.state, 'superseded')
      assert.equal(old.deliveries.length, 0)
      assert.equal(f.core.store.notifications(f.lead.missionId, true).length, 0)
      assert.throws(() => f.core.acknowledgeDelivery(f.lead, notice.id), /substituído/)
    } finally { await f.core.shutdown() }
  })
}

test('F6b: retry preserves a previously accepted notice and its historical ACK', async () => {
  const f = await fixture()
  try {
    f.core.handoff(f.pane, { summary: 'Accepted result', evidence: 'Synthetic check exit 0' })
    const notice = f.core.store.notifications(f.lead.missionId)[0]!
    f.core.store.markNoticeAccepted(notice.id, f.lead)
    const attempt = f.core.store.currentPaneAttempt(f.pane.id)!
    await f.core.spawnHelper(f.lead, { activityId: attempt.activityId, title: 'Retry', task: 'Read synthetic input', cli: 'claude', model: null, retryReason: 'New fixture attempt' })
    const old = f.core.store.notifications(f.lead.missionId).find(n => n.id === notice.id)!
    assert.equal(old.state, 'pty_accepted')
    assert.equal(old.deliveries.length, 1)
    assert.equal(f.core.acknowledgeDelivery(f.lead, notice.id).state, 'agent_acknowledged')
  } finally { await f.core.shutdown() }
})

test('F6b: a queued mixed batch removes a superseded notice and keeps the other receipt', async () => {
  const f = await fixture()
  try {
    const second = await f.core.spawnHelper(f.lead, { title: 'Second', task: 'Read another fixture', cli: 'claude', model: null })
    f.core.handoff(f.pane, { summary: 'Obsolete queued fixture', status: 'blocked' })
    f.core.handoff(second.pane, { summary: 'Current queued fixture', evidence: 'Synthetic check exit 0' })
    const notices = f.core.store.notifications(f.lead.missionId)
    const panes = (f.core as any).panes
    panes.submit(f.lead.id, 'Queue occupied')
    const now = Date.now
    try {
      Date.now = () => now() + 6000
      f.core.dispatchDeliveries(f.lead.missionId)
    } finally { Date.now = now }
    f.core.sendTo(f.lead, f.pane.id, 'Replacement task', true)
    await new Promise(resolve => setTimeout(resolve, 800))
    const text = panes.screenText(f.lead.id, 200).replaceAll('\n', '')
    assert.equal(text.includes('Obsolete queued fixture'), false)
    assert.ok(text.includes('Current queued fixture'))
    const old = f.core.store.notifications(f.lead.missionId).find(n => n.id === notices[0]!.id)!
    const current = f.core.store.notifications(f.lead.missionId).find(n => n.id === notices[1]!.id)!
    assert.equal(old.state, 'superseded')
    assert.equal(old.deliveries.length, 0)
    assert.equal(current.state, 'pty_accepted')
    assert.equal(f.core.acknowledgeDelivery(f.lead, current.id).state, 'agent_acknowledged')
  } finally { await f.core.shutdown() }
})

test('F6b: a fully superseded queued batch never reaches the leader', async () => {
  const f = await fixture()
  try {
    f.core.handoff(f.pane, { summary: 'Cancelled queued fixture', status: 'blocked' })
    const panes = (f.core as any).panes
    panes.submit(f.lead.id, 'Queue occupied')
    const now = Date.now
    try {
      Date.now = () => now() + 6000
      f.core.dispatchDeliveries(f.lead.missionId)
    } finally { Date.now = now }
    f.core.sendTo(f.lead, f.pane.id, 'Replacement task', true)
    await new Promise(resolve => setTimeout(resolve, 800))
    const text = panes.screenText(f.lead.id, 200).replaceAll('\n', '')
    assert.equal(text.includes('Cancelled queued fixture'), false)
    const notice = f.core.store.notifications(f.lead.missionId)[0]!
    assert.equal(notice.state, 'superseded')
    assert.equal(notice.deliveries.length, 0)
    assert.equal(f.core.store.notifications(f.lead.missionId, true).length, 0)
  } finally { await f.core.shutdown() }
})
