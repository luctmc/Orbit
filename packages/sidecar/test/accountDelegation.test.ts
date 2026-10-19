import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OrbitCore } from '../src/core.ts'
import { helperRequestHash } from '../src/activityLedger.ts'
import { offline, seedRoutingQuota } from './helpers.ts'

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'orbit-account-delegation-'))
  const core = new OrbitCore({ dataDir: join(root, 'data'), shell: '/bin/sh', browser: null, broadcast: () => {}, run: offline,
    agentCommand: () => ({ file: '/bin/sh', args: ['-c', 'while read line; do :; done'] }) })
  core.setEndpoint('http://127.0.0.1:1')
  await core.handle({ type: 'workspace.open', path: root })
  await core.handle({ type: 'mission.create', workspaceId: core.store.snapshot().workspaces[0]!.id, title: 'Accounts', objective: '', mode: 'livre', lead: { cli: 'shell', model: null, title: 'Lead' } })
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
