import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture } from './r2Fixture.ts'

test('explicit squad CLI/model/effort reaches the launch and its durable decision receipt', async () => {
  const { core, lead, root } = await fixture()
  try {
    core.handle({ type: 'mission.create', workspaceId: core.store.mission(lead.missionId)!.workspaceId, title: 'Squad', objective: '', mode: 'squad', squadId: 'caca-bugs', lead: { cli: 'shell', model: null, title: 'Lead' } })
    const boss = core.store.snapshot().panes.find(p => p.role === 'lead' && p.missionId !== lead.missionId)!
    const { pane, receipt } = await core.spawnHelper(boss, { title: 'Inspect', task: 'Inspect synthetic source', squadRoleId: 'revisor', cli: 'codex', model: 'user-pinned-model', effort: 'high' })
    assert.deepEqual([pane.cli, pane.model, pane.effort], ['codex', 'user-pinned-model', 'high'])
    const decision = core.store.currentPaneAttempt(pane.id)!.decision!
    assert.equal(decision.source, 'explicit')
    assert.deepEqual(decision.requested, { cli: 'codex', model: 'user-pinned-model', effort: 'high' })
    assert.equal(decision.effective.cli, 'codex')
    assert.match(decision.policyRevision, /^[a-f0-9]{64}$/)
    const context = JSON.parse(readFileSync(join(root, 'data/panes', String(pane.id), 'context.json'), 'utf8'))
    assert.deepEqual(context.decision, decision)
    assert.ok(receipt.length)
  } finally { await core.shutdown() }
})

test('required native read-only sandbox chooses a capable adapter and refuses incompatible explicit choices', async () => {
  const { core, lead } = await fixture()
  try {
    const manager = (core as any).panes
    const spawn = manager.spawn.bind(manager)
    let sandbox: string | undefined
    manager.spawn = (input: any) => { sandbox = input.launch.sandbox; return spawn(input) }
    const { pane } = await core.spawnHelper(lead, { activityId: 'native', title: 'Inspect', task: 'Read synthetic input', model: null, requireReadOnlySandbox: true })
    assert.equal(pane.cli, 'codex')
    assert.equal(sandbox, 'read-only')
    assert.equal(core.store.executionPolicy(pane.id)?.readOnly, true)
    assert.equal(core.store.paneSpec(pane.id)?.requireReadOnlySandbox, true)
    await assert.rejects(core.spawnHelper(lead, { activityId: 'bad-native', title: 'Bad', task: 'Read', cli: 'claude', model: null, requireReadOnlySandbox: true }), /sandbox/)
  } finally { await core.shutdown() }
})

test('a table edit during asynchronous classification cannot launch a stale decision', async () => {
  const { core, lead } = await fixture()
  let release!: () => void
  let entered!: () => void
  const waiting = new Promise<void>(resolve => { release = resolve })
  const started = new Promise<void>(resolve => { entered = resolve })
  try {
    ;(core as any).run = async (command: string) => {
      assert.match(command, /--json-schema/)
      entered()
      await waiting
      return { code: 0, stdout: JSON.stringify({ structured_output: { kind: 'investigacao', why: 'Synthetic classifier' } }), stderr: '' }
    }
    const opening = core.spawnHelper(lead, { title: 'Lista lenta', task: 'A lista de pedidos leva 8 segundos para aparecer', model: null, readOnly: true })
    await Promise.race([started, new Promise((_, reject) => setTimeout(() => reject(new Error('classifier did not start')), 3000).unref())])
    const updated = core.routing()
    updated.taskTypes[0]!.name += ' changed'
    core.store.saveRouting(updated)
    release()
    await assert.rejects(opening, /tabela.*mudou/)
    assert.equal(core.store.snapshot().panes.length, 2, 'no helper from the stale decision was launched')
    assert.equal(core.store.activityHistory(lead.missionId).attempts.at(-1)!.state, 'stopped')
    assert.match(core.store.activityHistory(lead.missionId).attempts.at(-1)!.error!, /tabela.*mudou/)
  } finally { release(); await core.shutdown() }
})

test('routing edits and proposals reject stale bases; accepting a proposal rolls back on disk failure', async () => {
  const { core, lead, root } = await fixture()
  const blocked = join(root, 'data/state.json.tmp')
  try {
    const old = core.routing()
    const proposal = core.proposeRouting(lead, { kind: 'testes', change: { readOnly: true }, reason: 'Review only' })
    const newer = structuredClone(old)
    newer.taskTypes[0]!.name += ' updated'
    core.store.saveRouting(newer)
    assert.throws(() => core.store.saveRouting(old), /outra edição/)
    assert.throws(() => core.handle({ type: 'proposal.decide', proposalId: proposal.id, accept: true }), /tabela mudou/)
    assert.equal(core.store.proposal(proposal.id)?.status, 'pendente')
    core.handle({ type: 'proposal.decide', proposalId: proposal.id, accept: false })
    const fresh = core.proposeRouting(lead, { kind: 'testes', change: { readOnly: true }, reason: 'New base' })
    core.store.flush()
    const before = core.routing()
    mkdirSync(blocked)
    assert.throws(() => core.handle({ type: 'proposal.decide', proposalId: fresh.id, accept: true }))
    assert.deepEqual(core.routing(), before)
    assert.equal(core.store.proposal(fresh.id)?.status, 'pendente')
    rmSync(blocked, { recursive: true })
    core.handle({ type: 'proposal.decide', proposalId: fresh.id, accept: true })
    assert.equal(core.store.proposal(fresh.id)?.status, 'aceita')
    assert.equal(core.routing().taskTypes.find(t => t.id === 'testes')!.readOnly, true)
  } finally { rmSync(blocked, { recursive: true, force: true }); await core.shutdown() }
})
