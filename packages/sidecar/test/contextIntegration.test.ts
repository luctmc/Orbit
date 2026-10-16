import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixture } from './r2Fixture.ts'

test('briefing cannot silently discard pending acceptance and continuation rules behind long notes', async () => {
  const { core, lead, pane } = await fixture()
  try {
    const workspace = core.missionWorkspace(lead.missionId)!
    core.store.updateWorkspace(workspace.id, { instructions: 'Never publish this repository.' })
    core.handle({ type: 'memory.save', workspaceId: workspace.id, entry: { kind: 'decisao', text: 'USER RULE: ask before adding dependencies.', pinned: true } })
    for (let i = 0; i < 24; i++) core.addNote(lead, `${i}: ${'Decisão '.repeat(110)}`)
    // An oversized mandatory contract must be refused, never clipped to a plausible partial briefing.
    assert.throws(() => core.missionBriefing(lead.missionId), /obrigatório/)
    assert.ok(core.store.pane(pane.id))
  } finally { await core.shutdown() }
})

test('large optional memory is retrievable while task acceptance and user instructions remain complete', async () => {
  const { core, lead, root } = await fixture()
  try {
    const workspace = core.missionWorkspace(lead.missionId)!
    core.store.updateWorkspace(workspace.id, { instructions: 'Never publish this repository.' })
    core.handle({ type: 'memory.save', workspaceId: workspace.id, entry: { kind: 'decisao', text: 'USER RULE: ask before adding dependencies.', pinned: true } })
    for (let i = 0; i < 10; i++) core.addProjectNote(lead, 'fato', `${i}: ${'Historical measurement. '.repeat(40)}`)
    const briefing = core.missionBriefing(lead.missionId)
    assert.ok(Buffer.byteLength(briefing) <= 18000)
    assert.match(briefing, /Never publish this repository/)
    assert.match(briefing, /USER RULE: ask before adding dependencies/)
    const sha256 = /"sha256":"([a-f0-9]{64})"/.exec(briefing)![1]!
    const page = core.readContext(lead, sha256)
    assert.match(page.text, /Historical measurement/)
    assert.ok(page.nextOffset)
    const end = core.readContext(lead, sha256, page.nextOffset!, 16000)
    assert.equal(end.nextOffset, null)
    const { pane } = await core.spawnHelper(lead, { title: 'Long contract', task: 'x'.repeat(19999), cli: 'claude', readOnly: true, model: null, accept: ['Do not publish. Preserve the complete contract.'] })
    const task = readFileSync(join(root, 'data/panes', String(pane.id), 'task.md'), 'utf8')
    assert.ok(task.length > 20000)
    assert.match(task, /Do not publish\. Preserve the complete contract\./)
    assert.match(readFileSync(join(root, 'data/panes', String(pane.id), 'role.md'), 'utf8'), /Never publish this repository/)
    const metrics = JSON.parse(readFileSync(join(root, 'data/panes', String(pane.id), 'context.json'), 'utf8'))
    assert.equal(metrics.task.bytes, Buffer.byteLength(task))
    assert.equal(metrics.executionEpoch, pane.executionEpoch)
    const nextLead = await core.changeLead(lead.missionId, { kind: 'new', cli: 'claude', model: null, effort: null, accountId: null })
    const role = readFileSync(join(root, 'data/panes', String(nextLead.id), 'role.md'), 'utf8')
    assert.match(role, /USER RULE: ask before adding dependencies/)
    const rolePack = JSON.parse(readFileSync(join(root, 'data/panes', String(nextLead.id), 'context.json'), 'utf8')).role
    assert.ok(rolePack.references.length > 0)
    assert.ok(rolePack.bytes < rolePack.sourceBytes)
  } finally { await core.shutdown() }
})
