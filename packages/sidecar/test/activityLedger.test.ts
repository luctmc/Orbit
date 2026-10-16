import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OrbitCore } from '../src/core.ts'
import { Store } from '../src/store.ts'
import './helpers.ts'

function fixture(beforeLaunch?: (state: any) => void) {
  const root = mkdtempSync(join(tmpdir(), 'orbit-activity-'))
  const core = new OrbitCore({ dataDir: join(root, 'data'), shell: '/bin/sh', browser: null,
    broadcast: () => {}, run: async () => ({ code: 127, stdout: '', stderr: 'offline' }),
    agentCommand: launch => {
      if (launch.cli !== 'shell' && beforeLaunch) beforeLaunch(JSON.parse(readFileSync(join(root, 'data/state.json'), 'utf8')))
      return { file: '/bin/sh', args: ['-c', 'while read line; do :; done'] }
    },
  })
  core.setEndpoint('http://127.0.0.1:1')
  core.handle({ type: 'workspace.open', path: root })
  core.handle({ type: 'mission.create', workspaceId: core.store.snapshot().workspaces[0]!.id,
    title: 'Ledger', objective: '', mode: 'livre', lead: { cli: 'shell', model: null, title: 'Lead' } })
  const lead = core.store.snapshot().panes.find(p => p.role === 'lead')!
  return { core, lead, root, input: { title: 'Read', task: 'Read synthetic file', cli: 'claude' as const, model: null, activityId: 'read-file' } }
}

test('the durable reservation and pane identity exist before the process command is constructed', async () => {
  let observed = false
  const f = fixture(state => {
    assert.equal(state.activityLedger.attempts.length, 1)
    const attempt = state.activityLedger.attempts[0]
    assert.equal(attempt.state, 'starting')
    assert.equal(attempt.cli, 'claude')
    assert.ok(attempt.paneId > 0)
    assert.ok(state.nextPaneId > attempt.paneId)
    observed = true
  })
  try { await f.core.spawnHelper(f.lead, f.input); assert.ok(observed) }
  finally { await f.core.shutdown() }
})

test('a launch failure leaves a durable attempt and blocks an unreasoned duplicate', async () => {
  let launches = 0
  const f = fixture(() => { launches++; throw new Error('injected launch failure') })
  try {
    await assert.rejects(f.core.spawnHelper(f.lead, f.input), /injected launch failure/)
    const disk = JSON.parse(readFileSync(join(f.root, 'data/state.json'), 'utf8'))
    assert.equal(disk.activityLedger.attempts.length, 1)
    assert.throws(() => f.core.missionReady(f.lead, 'No result', false), /falta retorno/, 'a failed opening cannot disappear from required work')
    await assert.rejects(f.core.spawnHelper(f.lead, f.input), /tentativa|retom|justificativa/i)
    assert.equal(launches, 1)
  } finally { await f.core.shutdown() }
})

test('result commit rolls back on disk failure and the retry persists one complete result', async () => {
  const f = fixture()
  const blocked = join(f.root, 'data/state.json.tmp')
  try {
    const { pane } = await f.core.spawnHelper(f.lead, f.input)
    mkdirSync(blocked)
    assert.throws(() => f.core.handoff(pane, { summary: 'Checked', evidence: 'exit 0' }), /EISDIR/)
    assert.equal(f.core.store.activityHistory(pane.missionId).results.length, 0)
    assert.equal(f.core.pendingDeliveries(pane.missionId).length, 1)
    assert.equal(f.core.store.pane(pane.id)?.handoffStatus, null)
    rmSync(blocked, { recursive: true })
    const committed = f.core.handoff(pane, { summary: 'Checked', evidence: 'exit 0' })
    const disk = JSON.parse(readFileSync(join(f.root, 'data/state.json'), 'utf8'))
    assert.equal(disk.activityLedger.results[0].id, committed.resultId)
    assert.equal(disk.deliveryObligations[0].status, 'done')
    assert.equal(disk.panes.find((p: { id: number }) => p.id === pane.id).handoffStatus, 'done')
    assert.equal(disk.delegations[0].result.evidence, 'exit 0')
  } finally { rmSync(blocked, { recursive: true, force: true }); await f.core.shutdown() }
})

test('a persisted progress checkpoint does not mark the terminal as delivered before its mirror updates', async () => {
  const f = fixture()
  try {
    const { pane } = await f.core.spawnHelper(f.lead, f.input)
    f.core.store.commitActivityResult(pane, { status: 'progress', summary: 'Halfway', evidence: '', details: '', deliveredTo: null }, { title: 'Progress', body: 'Halfway' })
    assert.equal(f.core.store.pane(pane.id)?.deliveredAt, null)
    assert.equal(f.core.pendingDeliveries(pane.missionId)[0]?.status, 'progress')
  } finally { await f.core.shutdown() }
})

const storeUrl = new URL('../src/store.ts', import.meta.url).href
function killAfter(dataDir: string, body: string) {
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { Store } from ${JSON.stringify(storeUrl)};
    const store = new Store(process.argv[1]);
    ${body}
    process.kill(process.pid, 'SIGKILL');
  `, dataDir], { encoding: 'utf8', timeout: 10_000 })
  assert.equal(child.signal, 'SIGKILL', child.stderr)
}

test('SIGKILL after reservation preserves identity and prevents an automatic second attempt', async () => {
  const f = fixture()
  await f.core.shutdown()
  const request = { missionId: f.lead.missionId, key: 'crash-boundary', title: 'Reserved work', contractHash: 'contract-v1', acceptance: [], retryReason: null, assignedBy: f.lead.id, requiresDelivery: true }
  killAfter(join(f.root, 'data'), `store.reserveActivity(${JSON.stringify(request)});`)
  const restored = new Store(join(f.root, 'data'))
  const before = restored.activityHistory(f.lead.missionId)
  assert.equal(before.attempts[0]!.state, 'stopped')
  assert.equal(restored.deliveries(f.lead.missionId)[0]!.status, 'pending')
  const repeated = restored.reserveActivity(request)
  assert.ok(repeated.reused)
  assert.equal(repeated.attempt.id, before.attempts[0]!.id)
  assert.equal(restored.activityHistory(f.lead.missionId).attempts.length, 1)
  restored.flush()
})

test('SIGKILL after result persistence preserves its receipt and every completion projection', async () => {
  const f = fixture()
  const { pane } = await f.core.spawnHelper(f.lead, f.input)
  await f.core.shutdown()
  killAfter(join(f.root, 'data'), `store.commitActivityResult(store.pane(${pane.id}), { status: 'done', summary: 'Crash proof', evidence: 'exit 0', details: '', deliveredTo: ${f.lead.id} }, { title: 'Result', body: 'Crash proof' });`)
  const restored = new Store(join(f.root, 'data'))
  const history = restored.activityHistory(f.lead.missionId)
  assert.equal(history.results[0]!.evidence, 'exit 0')
  assert.equal(history.activities[0]!.state, 'awaiting_validation')
  assert.equal(history.attempts[0]!.state, 'delivered')
  assert.equal(restored.deliveries(f.lead.missionId)[0]!.status, 'done')
  assert.equal(restored.pane(pane.id)?.handoffStatus, 'done')
  assert.equal(restored.commitActivityResult(restored.pane(pane.id)!, { status: 'done', summary: 'Crash proof', evidence: 'exit 0', details: '', deliveredTo: f.lead.id }, { title: 'Result', body: 'Crash proof' }).result.id, history.results[0]!.id)
  assert.equal(restored.activityHistory(f.lead.missionId).results.length, 1)
  restored.flush()
})

test('legacy migration creates activity identities and results exactly once without recharging usage', async () => {
  const f = fixture()
  const { pane } = await f.core.spawnHelper(f.lead, f.input)
  f.core.hookReport(pane.id, { hook_event_name: 'SessionStart', session_id: '3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f' })
  f.core.statusReport(pane.id, { context_window: { total_input_tokens: 100, total_output_tokens: 10 }, orbit_session_usage: { format: 'claude-transcript-v1', input: 100, output: 10, cacheRead: 0, cacheWrite: 0, total: 100 + 10 } })
  f.core.handoff(f.core.store.pane(pane.id)!, { summary: 'Legacy evidence', evidence: 'exit 0' })
  await f.core.shutdown()
  const file = join(f.root, 'data/state.json')
  const legacy = JSON.parse(readFileSync(file, 'utf8'))
  delete legacy.activityLedger
  delete legacy.sessionBaselines
  writeFileSync(file, JSON.stringify(legacy))
  const once = new Store(join(f.root, 'data'))
  const history = once.activityHistory(f.lead.missionId)
  assert.equal(history.activities.length, 1)
  assert.equal(history.results[0]!.summary, 'Legacy evidence')
  assert.equal(once.mission(f.lead.missionId)!.usage.total, 110)
  once.flush()
  const twice = new Store(join(f.root, 'data'))
  assert.deepEqual(twice.activityHistory(f.lead.missionId), history)
  assert.equal(twice.accountSessionUsage(twice.pane(pane.id)!, twice.pane(pane.id)!.usage!, 'status').added, undefined)
  assert.equal(twice.mission(f.lead.missionId)!.usage.total, 110)
  twice.flush()
})

test('results survive event eviction and duplicate submission has a stable receipt', async () => {
  const f = fixture()
  try {
    const { pane } = await f.core.spawnHelper(f.lead, f.input)
    const input = { summary: 'Checked', evidence: 'synthetic check exit 0' }
    const first = f.core.handoff(pane, input)
    assert.ok(first.resultId)
    for (let n = 0; n < 220; n++) f.core.store.addEvent({ missionId: pane.missionId, paneId: pane.id, kind: 'pane.spawned', title: `Noise ${n}`, body: '' })
    assert.equal(f.core.missionEvents(pane.missionId, 'handoff').length, 0)
    const duplicate = f.core.handoff(pane, input)
    assert.equal(duplicate.resultId, first.resultId)
    assert.equal(f.core.missionEvents(pane.missionId, 'handoff').length, 0)
    const restored = new Store(join(f.root, 'data'))
    assert.equal(restored.activityHistory(pane.missionId).results[0]?.evidence, input.evidence)
    restored.flush()
  } finally { await f.core.shutdown() }
})

test('retries preserve all attempts and results; changed criteria require an explicit revision', async () => {
  const f = fixture()
  try {
    const first = await f.core.spawnHelper(f.lead, f.input)
    const result = f.core.handoff(first.pane, { summary: 'Checked', evidence: 'exit 0' })
    await assert.rejects(f.core.spawnHelper(f.lead, { ...f.input, accept: ['New contract'] }), /contrato|critério|revisão/i)
    const retryInput = { ...f.input, accept: ['New contract'], retryReason: 'Contract changed' }
    const second = await f.core.spawnHelper(f.lead, retryInput)
    assert.notEqual(second.pane.id, first.pane.id)
    const history = f.core.store.activityHistory(f.lead.missionId)
    assert.equal(history.activities.length, 1)
    assert.equal(history.activities[0]!.revision, 2)
    assert.equal(history.attempts.length, 2)
    assert.equal(history.attempts[0]!.state, 'delivered')
    assert.deepEqual(history.attempts[0]!.acceptance, [])
    assert.deepEqual(history.attempts[1]!.acceptance, ['New contract'])
    assert.equal(history.results[0]!.id, result.resultId)
    assert.equal(history.results[0]!.activityRevision, 1)
    assert.equal((await f.core.spawnHelper(f.lead, retryInput)).pane.id, second.pane.id)
    assert.equal((await f.core.spawnHelper(f.lead, { ...retryInput, activityId: history.activities[0]!.id })).pane.id, second.pane.id, 'a receipt id is a reusable work identity too')
  } finally { await f.core.shutdown() }
})
