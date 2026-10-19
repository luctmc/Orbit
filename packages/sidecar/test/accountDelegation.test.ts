import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OrbitCore } from '../src/core.ts'
import { helperRequestHash } from '../src/activityLedger.ts'
import { offline, seedRoutingQuota } from './helpers.ts'

async function fixture(leadCli: 'shell' | 'codex' = 'shell') {
  const root = mkdtempSync(join(tmpdir(), 'orbit-account-delegation-'))
  const core = new OrbitCore({ dataDir: join(root, 'data'), shell: '/bin/sh', browser: null, broadcast: () => {}, run: offline,
    agentCommand: () => ({ file: '/bin/sh', args: ['-c', 'while read line; do :; done'] }) })
  core.setEndpoint('http://127.0.0.1:1')
  await core.handle({ type: 'workspace.open', path: root })
  await core.handle({ type: 'mission.create', workspaceId: core.store.snapshot().workspaces[0]!.id, title: 'Accounts', objective: '', mode: 'livre', lead: { cli: leadCli, accountId: leadCli === 'codex' ? 'codex' : null, model: null, title: 'Lead' } })
  await seedRoutingQuota(core)
  return { core, lead: core.store.snapshot().panes.find(p => p.role === 'lead')! }
}
const input = { title: 'Inspect file', task: 'Read a synthetic file', model: null, activityId: 'T2' }

test('explicit Mac account infers CLI, survives a conflicting task route, and appears in receipt', async () => {
  const { core, lead } = await fixture()
  try {
    const result = await core.spawnHelper(lead, { ...input, taskTypeId: 'investigacao', accountId: 'codex' })
    assert.equal(result.pane.cli, 'codex')
    assert.equal(result.pane.accountId, 'codex')
    assert.match(result.receipt.join('\n'), /conta efetiva:.*\(codex\).*explícita/)
    const reused = await core.spawnHelper(lead, { ...input, taskTypeId: 'investigacao', accountId: 'codex' })
    assert.equal(reused.pane.id, result.pane.id)
    await assert.rejects(core.spawnHelper(lead, { ...input, taskTypeId: 'investigacao', accountId: 'claude' }), /mudou|pedido|justificativa|diferente/i)
  } finally { await core.shutdown() }
})

test('invalid, mismatched and disconnected explicit accounts never launch a fallback', async () => {
  const { core, lead } = await fixture()
  try {
    const before = core.store.snapshot().panes.length
    await assert.rejects(core.spawnHelper(lead, { ...input, accountId: 'missing' }), /Conta desconhecida/)
    await assert.rejects(core.spawnHelper(lead, { ...input, cli: 'claude', accountId: 'codex' }), /não pertence/)
    const internals = core as unknown as { accountStatus: Map<string, any> }
    internals.accountStatus.set('codex', { ...internals.accountStatus.get('codex'), loggedIn: false })
    await assert.rejects(core.spawnHelper(lead, { ...input, accountId: 'codex' }), /não está conectada/)
    assert.equal(core.store.snapshot().panes.length, before)
  } finally { await core.shutdown() }
})

test('account change alters durable request identity while omitted and null retain automatic identity', () => {
  const base = { ...input, cli: 'codex' as const }
  assert.notEqual(helperRequestHash({ ...base, accountId: 'codex' }), helperRequestHash({ ...base, accountId: 'codex-acc-2' }))
  assert.equal(helperRequestHash(base), helperRequestHash({ ...base, accountId: null }))
})


test('capacity exposes exact ids and manual-only accounts; busy explicit accounts cannot launch', async () => {
  const { core, lead } = await fixture()
  try {
    const account = core.store.account('codex')!
    core.store.setBuiltinAuto(account.id, false)
    const status = core.capacity(lead.missionId).find(row => row.cli === 'codex')!.accounts.find(a => a.accountId === 'codex')!
    assert.equal(status.automatic, false)
    assert.equal(status.selectable, true)
    const internals = core as unknown as { accountStatus: Map<string, any> }
    internals.accountStatus.set('codex', { ...internals.accountStatus.get('codex'), busy: 'checking' })
    assert.equal(core.capacity(lead.missionId).find(row => row.cli === 'codex')!.accounts.find(a => a.accountId === 'codex')!.selectable, false)
    await assert.rejects(core.spawnHelper(lead, { ...input, accountId: 'codex' }), /ocupada/)
  } finally { await core.shutdown() }
})

test('omitting account retains automatic selection and actual-account receipt', async () => {
  const { core, lead } = await fixture()
  try {
    const result = await core.spawnHelper(lead, { ...input, cli: 'codex' })
    assert.equal(result.pane.accountId, 'codex')
    assert.match(result.receipt.join('\n'), /conta efetiva:.*automática/)
  } finally { await core.shutdown() }
})


test('new user work gets a distinct visible CLI and stable retry; continuation retains context', async () => {
  const { core, lead } = await fixture('codex')
  try {
    const replies: any[] = []
    const message = { type: 'pane.submit' as const, paneId: lead.id, text: 'Read a synthetic file', dispatch: 'new-task' as const, allowOriginal: true, requestId: 'new-work-1' }
    await core.handle(message, m => replies.push(m))
    assert.equal(replies[0].type, 'pane.submitted', JSON.stringify(replies))
    const worker = core.store.pane(replies[0].paneId)!
    assert.notEqual(worker.id, lead.id)
    assert.equal(worker.accountId, 'codex')
    assert.equal(worker.cli, 'codex')
    assert.equal(worker.assignedBy, lead.id)
    const count = core.store.snapshot().panes.length
    await core.handle(message, m => replies.push(m))
    assert.deepEqual(replies[1], replies[0])
    assert.equal(core.store.snapshot().panes.length, count)
    await core.handle({ ...message, requestId: 'steering', paneId: worker.id, dispatch: 'continue', text: 'Clarification: file is synthetic' }, m => replies.push(m))
    assert.equal(replies[2].type, 'pane.submitted')
    assert.equal(replies[2].paneId, worker.id)
    assert.equal(core.store.snapshot().panes.length, count)
    await core.handle({ ...message, requestId: 'new-work-2' }, m => replies.push(m))
    assert.notEqual(replies[3].paneId, worker.id)
  } finally { await core.shutdown() }
})

test('failed admission preserves original input, never launches fallback and rejects invalid dispatch targets', async () => {
  const { core, lead } = await fixture('codex')
  try {
    const state = core as unknown as { accountStatus: Map<string, any> }
    state.accountStatus.set('codex', { ...state.accountStatus.get('codex'), loggedIn: false })
    const before = core.store.snapshot().panes.length
    const replies: any[] = []
    const message = { type: 'pane.submit' as const, paneId: lead.id, text: 'Preserve this request', dispatch: 'new-task' as const, allowOriginal: true, requestId: 'failed-user-work' }
    await core.handle(message, m => replies.push(m))
    assert.equal(replies[0].type, 'pane.submit.error')
    assert.equal(replies[0].pending, false)
    assert.match(replies[0].message, /não está conectada/)
    assert.equal(core.store.snapshot().panes.length, before)
    await core.handle(message, m => replies.push(m))
    assert.deepEqual(replies[1], replies[0])
    assert.equal(core.store.snapshot().panes.length, before)
  } finally { await core.shutdown() }
})


test('only accepted independent verification closes exact worker and retains result/history', async () => {
  const { core, lead } = await fixture()
  try {
    const { pane } = await core.spawnHelper(lead, { ...input, cli: 'codex' })
    const state = core as unknown as { panes: { isAlive(id: number): boolean; historyEntries(id: number): unknown[]; historyText(id: number, epoch: string): Promise<string> } }
    const delivery = core.handoff(pane, { summary: 'Synthetic work complete', evidence: 'Synthetic fixture observation' })
    assert.equal(state.panes.isAlive(pane.id), true, 'handoff alone must leave terminal alive')
    const inspection = core.inspectResult(lead, delivery.resultId)
    core.verifyResult(lead, { inspectionId: inspection.id, verdict: 'unverified', summary: 'Fixture needs checks', checks: [], criteria: [] })
    assert.equal(state.panes.isAlive(pane.id), true, 'unverified review cannot close')
    const next = core.inspectResult(lead, delivery.resultId)
    const reviewInput = { inspectionId: next.id, verdict: 'accepted' as const, summary: 'Synthetic lifecycle acceptance', checks: [{ command: 'synthetic fixture observation', exitCode: 0, summary: 'Fixture observed' }], criteria: [] }
    core.verifyResult(lead, reviewInput)
    core.verifyResult(lead, reviewInput)
    for (let i = 0; i < 40 && core.store.pane(pane.id)?.status !== 'exited'; i++) await new Promise(r => setTimeout(r, 50))
    assert.equal(state.panes.isAlive(pane.id), false)
    assert.equal(core.store.pane(pane.id)!.status, 'exited')
    assert.ok(core.store.activityHistory(lead.missionId).results.some(r => r.id === delivery.resultId))
    assert.ok(state.panes.historyEntries(pane.id).length > 0)
    assert.equal(typeof await state.panes.historyText(pane.id, pane.executionEpoch!), 'string')
    assert.equal(state.panes.isAlive(lead.id), true, 'coordinator remains available')
  } finally { await core.shutdown() }
})
