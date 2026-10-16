import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fixture } from './r2Fixture.ts'
import { Store } from '../src/store.ts'

const delay = (ms: number) => new Promise(r => setTimeout(r, ms))
const input = { summary: 'Queue result', evidence: 'synthetic check exit 0' }

test('receipt advances only after Enter and only its recipient can acknowledge consumption', async () => {
  const f = await fixture()
  try {
    const result = f.core.handoff(f.pane, input)
    const notice = () => f.core.store.notifications(f.pane.missionId)[0]!
    assert.equal(notice().resultId, result.resultId)
    assert.equal(notice().state, 'persisted')
    assert.throws(() => f.core.acknowledgeDelivery(f.lead, notice().id), /ainda não foi enviado/)
    await delay(180)
    assert.equal(notice().state, 'pty_accepted')
    assert.equal(notice().deliveries[0]?.executionEpoch, f.lead.executionEpoch)
    assert.throws(() => f.core.acknowledgeDelivery(f.pane, notice().id), /destinatário/)
    const ack = f.core.acknowledgeDelivery(f.lead, notice().id)
    assert.equal(ack.state, 'agent_acknowledged')
    assert.deepEqual(f.core.acknowledgeDelivery(f.lead, notice().id), ack)
    await f.core.handle({ type: 'pane.restart', paneId: f.lead.id, resume: false })
    await delay(180)
    assert.equal(notice().deliveries.length, 1, 'confirmed notices do not wake another execution')
  } finally { await f.core.shutdown() }
})

test('restart before Enter cancels the old receipt and delivers the same notice to the new epoch', async () => {
  const f = await fixture()
  try {
    f.core.handoff(f.pane, input)
    const id = f.core.store.notifications(f.pane.missionId)[0]!.id
    await f.core.handle({ type: 'pane.restart', paneId: f.lead.id, resume: false })
    await delay(180)
    const notice = f.core.store.notifications(f.pane.missionId)[0]!
    const lead = f.core.store.pane(f.lead.id)!
    assert.equal(notice.id, id)
    assert.equal(notice.deliveries.length, 1)
    assert.equal(notice.deliveries[0]!.executionEpoch, lead.executionEpoch)
    assert.notEqual(lead.executionEpoch, f.lead.executionEpoch)
    assert.throws(() => f.core.acknowledgeDelivery(f.lead, id), /execução/)
    assert.equal(f.core.acknowledgeDelivery(lead, id).state, 'agent_acknowledged')
  } finally { await f.core.shutdown() }
})

test('sidecar recovery replays an unacknowledged result without executing the activity again', async () => {
  const f = await fixture()
  f.core.handoff(f.pane, input)
  const id = f.core.store.notifications(f.pane.missionId)[0]!.id
  await f.core.shutdown()
  const restored = f.create()
  try {
    await restored.handle({ type: 'pane.restart', paneId: f.lead.id, resume: false })
    await delay(180)
    const notice = restored.store.notifications(f.pane.missionId)[0]!
    assert.equal(notice.id, id)
    assert.equal(notice.state, 'pty_accepted')
    assert.equal(restored.store.activityHistory(f.pane.missionId).attempts.length, 1)
    assert.equal(restored.store.activityHistory(f.pane.missionId).results.length, 1)
  } finally { await restored.shutdown() }
})

test('a new lead receives the unacknowledged notice addressed to the lead role', async () => {
  const f = await fixture()
  try {
    f.core.handoff(f.pane, input)
    await delay(180)
    const lead = await f.core.changeLead(f.pane.missionId, { kind: 'new', cli: 'claude', model: null, effort: null, accountId: null })
    f.core.hookReport(lead.id, { hook_event_name: 'SessionStart' })
    await delay(1300)
    f.core.dispatchDeliveries(f.pane.missionId)
    await delay(180)
    const notice = f.core.store.notifications(f.pane.missionId)[0]!
    assert.equal(notice.deliveries.length, 2)
    assert.equal(notice.deliveries[1]?.paneId, lead.id)
    assert.equal(f.core.acknowledgeDelivery(lead, notice.id).state, 'agent_acknowledged')
  } finally { await f.core.shutdown() }
})

test('a failed result commit leaves neither a result nor a notification; retry commits both once', async () => {
  const f = await fixture()
  const blocked = join(f.root, 'data/state.json.tmp')
  try {
    mkdirSync(blocked)
    assert.throws(() => f.core.handoff(f.pane, input), /EISDIR/)
    assert.equal(f.core.store.notifications(f.pane.missionId).length, 0)
    assert.equal(f.core.store.activityHistory(f.pane.missionId).results.length, 0)
    rmSync(blocked, { recursive: true })
    f.core.handoff(f.pane, input)
    const disk = JSON.parse(readFileSync(join(f.root, 'data/state.json'), 'utf8'))
    assert.equal(disk.notifications[0].resultId, disk.activityLedger.results[0].id)
    f.core.handoff(f.pane, input)
    assert.equal(f.core.store.notifications(f.pane.missionId).length, 1)
  } finally { rmSync(blocked, { recursive: true, force: true }); await f.core.shutdown() }
})

test('handing a result to a completed reviewer persists its new obligation in the result commit', async () => {
  const f = await fixture()
  try {
    const { pane: reviewer } = await f.core.spawnHelper(f.lead, { title: 'Reviewer', task: 'Review synthetic input', cli: 'claude', readOnly: true, model: null })
    f.core.handoff(reviewer, { summary: 'Previous review', evidence: 'old diff checked' })
    f.core.store.commitActivityResult(f.pane, { status: 'done', ...input, details: '', deliveredTo: reviewer.id }, { title: 'Review next', body: 'Review next' })
    const disk = JSON.parse(readFileSync(join(f.root, 'data/state.json'), 'utf8'))
    assert.equal(disk.deliveryObligations.filter((d: { paneId: number }) => d.paneId === reviewer.id).at(-1).status, 'pending')
    assert.equal(disk.notifications.at(-1).recipient.paneId, reviewer.id)
  } finally { await f.core.shutdown() }
})

test('an explicit reviewer that exited keeps its notice pending until its replacement process opens', async () => {
  const f = await fixture()
  try {
    const { pane: reviewer } = await f.core.spawnHelper(f.lead, { title: 'Offline reviewer', task: 'Review later', cli: 'claude', readOnly: true, model: null })
    ;(f.core as unknown as { panes: { kill: (id: number) => void } }).panes.kill(reviewer.id)
    for (let n = 0; n < 100 && f.core.store.pane(reviewer.id)?.status !== 'exited'; n++) await delay(10)
    assert.equal(f.core.store.pane(reviewer.id)?.status, 'exited')
    f.core.handoff(f.pane, { ...input, to: reviewer.id })
    assert.equal(f.core.store.notifications(f.pane.missionId)[0]?.state, 'persisted')
    await f.core.handle({ type: 'pane.restart', paneId: reviewer.id, resume: false })
    f.core.hookReport(reviewer.id, { hook_event_name: 'SessionStart' })
    await delay(1300)
    f.core.dispatchDeliveries(f.pane.missionId)
    await delay(180)
    const notice = f.core.store.notifications(f.pane.missionId)[0]!
    assert.equal(notice.state, 'pty_accepted')
    assert.equal(notice.deliveries[0]?.paneId, reviewer.id)
  } finally { await f.core.shutdown() }
})

test('R1 migration imports pending receipt identities once without claiming historical consumption', async () => {
  const f = await fixture()
  f.core.handoff(f.pane, input)
  await f.core.shutdown()
  const path = join(f.root, 'data/state.json')
  const legacy = JSON.parse(readFileSync(path, 'utf8'))
  delete legacy.notifications
  delete legacy.executionEpochs
  writeFileSync(path, JSON.stringify(legacy))
  const first = new Store(join(f.root, 'data'))
  const notices = first.notifications(f.pane.missionId)
  assert.equal(notices.length, 1)
  assert.equal(notices[0]?.state, 'persisted')
  assert.equal(notices[0]?.acknowledgedBy, null)
  first.flush()
  const second = new Store(join(f.root, 'data'))
  assert.deepEqual(second.notifications(f.pane.missionId), notices)
  second.flush()
})

test('SIGKILL after result commit retains the pending outbox in the same snapshot', async () => {
  const f = await fixture()
  await f.core.shutdown()
  const url = new URL('../src/store.ts', import.meta.url).href
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { Store } from ${JSON.stringify(url)};
    const store = new Store(process.argv[1]);
    store.commitActivityResult(store.pane(${f.pane.id}), { status: 'done', summary: 'Killed', evidence: 'exit 0', details: '', deliveredTo: ${f.lead.id} }, { title: 'Done', body: 'Killed' });
    process.kill(process.pid, 'SIGKILL');
  `, join(f.root, 'data')], { encoding: 'utf8', timeout: 10000 })
  assert.equal(child.signal, 'SIGKILL', child.stderr)
  const restored = new Store(join(f.root, 'data'))
  const notice = restored.notifications(f.pane.missionId)[0]!
  assert.equal(notice.state, 'persisted')
  assert.equal(notice.resultId, restored.activityHistory(f.pane.missionId).results[0]!.id)
  assert.equal(new Store(join(f.root, 'data')).notifications(f.pane.missionId)[0]?.id, notice.id)
  restored.flush()
})
