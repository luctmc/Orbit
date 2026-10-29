import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OrbitCore } from '../src/core.ts'
import { Store } from '../src/store.ts'
import { HOMES, offline } from './helpers.ts'
import { acceptSyntheticResult } from './reviewFixture.ts'

const SESSION = '3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f'
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'orbit-obligations-'))
  const create = () => {
    const core = new OrbitCore({ dataDir: join(root, 'data'), shell: '/bin/sh', browser: null,
      broadcast: () => {}, run: offline,
      agentCommand: (launch) => ({ file: '/bin/sh', args: ['-c', launch.cli === 'shell' ? 'while read line; do :; done' : 'read line; exit 0'] }),
    })
    core.setEndpoint('http://127.0.0.1:1')
    return core
  }
  let core = create()
  core.handle({ type: 'workspace.open', path: root })
  const workspace = core.store.snapshot().workspaces[0]!
  core.handle({ type: 'mission.create', workspaceId: workspace.id, title: 'Delivery obligations',
    objective: '', mode: 'agentica', lead: { cli: 'shell', model: null, title: 'Lead' } })
  let lead = core.store.snapshot().panes.find(p => p.role === 'lead')!
  const { pane: worker } = await core.spawnHelper(lead, { title: 'Required work', task: 'Synthetic required work', cli: 'claude', model: null })
  return { get core() { return core }, root, get lead() { return lead }, worker,
    async exit() {
      core.handle({ type: 'pane.input', paneId: worker.id, data: '\r' })
      for (let n = 0; n < 100 && core.store.pane(worker.id)?.status !== 'exited'; n++) await new Promise(r => setTimeout(r, 20))
      assert.equal(core.store.pane(worker.id)?.status, 'exited')
    },
    async reload() {
      await core.shutdown(); core = create()
      assert.throws(() => core.missionReady(lead, 'Old execution', false), /execução/)
      await core.handle({ type: 'pane.restart', paneId: lead.id, resume: false })
      lead = core.store.pane(lead.id)!
    },
    async close() { await core.shutdown() },
  }
}

// Importing HOMES keeps every CLI probe and transcript lookup in empty test homes.
void HOMES

test('progress stays pending after natural process exit and sidecar reload', async () => {
  const f = await fixture()
  try {
    f.core.handoff(f.worker, { status: 'progress', summary: 'Halfway; still incomplete' })
    assert.equal(f.core.hookReport(f.worker.id, { hook_event_name: 'Stop', stop_hook_active: false }), null, 'progress checkpoints may end a turn')
    assert.throws(() => f.core.missionReady(f.lead, 'Not yet', false), /falta retorno/)
    await f.exit()
    assert.throws(() => f.core.missionReady(f.lead, 'Not yet', false), /falta retorno/)
    await f.reload()
    assert.throws(() => f.core.missionReady(f.lead, 'Not yet', false), /falta retorno/)
  } finally { await f.close() }
})

test('closing a terminal does not cancel the required activity', async () => {
  const f = await fixture()
  try {
    f.core.closeHelper(f.lead, f.worker.id, true)
    assert.equal(f.core.store.pane(f.worker.id), undefined)
    assert.throws(() => f.core.missionReady(f.lead, 'Still incomplete', false), /falta retorno/)
    await f.reload()
    assert.throws(() => f.core.missionReady(f.lead, 'Still incomplete', false), /falta retorno/)
  } finally { await f.close() }
})

test('automatic last words are informational while blocked reports require completion', async () => {
  const f = await fixture()
  try {
    f.core.hookReport(f.worker.id, { hook_event_name: 'Stop', stop_hook_active: true, last_assistant_message: 'I think it is done' })
    assert.equal(f.core.store.pane(f.worker.id)?.handoffStatus, 'auto')
    assert.ok(f.core.missionReady(f.lead, 'Only automatic informational words', false).readyAt)
    f.core.handoff(f.worker, { status: 'blocked', summary: 'Missing required decision' })
    assert.throws(() => f.core.missionReady(f.lead, 'Still blocked', false), /falta retorno/)
    const { resultId } = f.core.handoff(f.worker, { status: 'done', summary: 'Verified', evidence: 'Synthetic check passed' })
    acceptSyntheticResult(f.core, f.lead, resultId)
    assert.ok(f.core.missionReady(f.lead, 'Verified result', false).readyAt)
  } finally { await f.close() }
})

test('an agent cannot waive unfinished work by claiming that the user removed the requirement', async () => {
  const f = await fixture()
  try {
    f.core.closeHelper(f.lead, f.worker.id, true)
    assert.throws(() => f.core.missionReady(f.lead, 'Not needed', true), /motivo|dispensar/)
    assert.throws(() => f.core.missionReady(f.lead, 'Scoped down', true, 'The user removed this requirement'), /dispensar/)
    assert.equal(f.core.store.mission(f.lead.missionId)!.readyAt, null)
    assert.ok(f.core.pendingDeliveries(f.lead.missionId).length)
    await f.reload()
    assert.throws(() => f.core.missionReady(f.lead, 'Scoped down', false), /falta retorno/)
    assert.equal(f.core.missionEvents(f.lead.missionId, 'mission.ready').length, 0)
  } finally { await f.close() }
})

test('resume restores the progress obligation and its owner', async () => {
  const f = await fixture()
  try {
    f.core.hookReport(f.worker.id, { hook_event_name: 'SessionStart', session_id: SESSION })
    f.core.handoff(f.worker, { status: 'progress', summary: 'Still working' })
    await f.exit()
    await f.core.handle({ type: 'pane.restart', paneId: f.worker.id, resume: true })
    const resumed = f.core.store.pane(f.worker.id)!
    assert.equal(resumed.assignedBy, f.lead.id)
    assert.equal(resumed.handoffStatus, 'progress')
    assert.throws(() => f.core.missionReady(f.lead, 'Not yet', false), /falta retorno/)
  } finally { await f.close() }
})

test('retry replaces one stopped obligation and preserves its history', async () => {
  const f = await fixture()
  try {
    const input = { title: 'Required work', task: 'Synthetic required work', cli: 'claude' as const, model: null, retryReason: 'Retry after interruption' }
    await assert.rejects(f.core.spawnHelper(f.lead, input), /ainda está em execução/)
    f.core.closeHelper(f.lead, f.worker.id, true)
    const next = await f.core.spawnHelper(f.lead, input)
    assert.equal(f.core.pendingDeliveries(f.lead.missionId).length, 1)
    const history = f.core.store.deliveries(f.lead.missionId)
    assert.equal(history.length, 2)
    assert.equal(history[0]!.status, 'superseded')
    assert.equal(history[0]!.replacementId, history[1]!.id)
    const { resultId } = f.core.handoff(next.pane, { summary: 'Retry verified', evidence: 'Synthetic check passed' })
    acceptSyntheticResult(f.core, f.lead, resultId)
    assert.ok(f.core.missionReady(f.lead, 'Verified retry', false).readyAt)
  } finally { await f.close() }
})

test('legacy state migrates closed required work once and keeps accepted history', async () => {
  const f = await fixture()
  try {
    f.core.handoff(f.worker, { status: 'progress', summary: 'Not finished' })
    f.core.closeHelper(f.lead, f.worker.id, true)
    f.core.store.flush()
    const file = join(f.root, 'data', 'state.json')
    const old = JSON.parse(readFileSync(file, 'utf8'))
    delete old.deliveryObligations
    writeFileSync(file, JSON.stringify(old))
    const migrated = new Store(join(f.root, 'data'))
    const records = migrated.deliveries(f.lead.missionId)
    assert.equal(records.length, 1)
    assert.equal(records[0]!.status, 'progress')
    migrated.flush()
    const again = new Store(join(f.root, 'data'))
    assert.deepEqual(again.deliveries(f.lead.missionId), records)
    again.flush()
  } finally { await f.close() }
})

test('new work in a completed terminal creates a separate required delivery', async () => {
  const f = await fixture()
  try {
    f.core.handoff(f.worker, { summary: 'First result', evidence: 'First check' })
    const first = f.core.store.deliveries(f.lead.missionId)[0]!
    f.core.sendTo(f.lead, f.worker.id, 'One more independent check', true)
    const records = f.core.store.deliveries(f.lead.missionId)
    assert.equal(records.length, 2)
    assert.equal(records[0]!.status, 'done')
    assert.equal(records[0]!.id, first.id)
    assert.equal(records[1]!.status, 'pending')
    assert.throws(() => f.core.missionReady(f.lead, 'Not yet', false), /falta retorno/)
  } finally { await f.close() }
})
