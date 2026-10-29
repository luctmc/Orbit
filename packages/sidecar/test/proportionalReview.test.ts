import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OrbitCore } from '../src/core.ts'
import './helpers.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Difficulty } from '@orbit/protocol'

async function fixture(difficulty: Difficulty = 'normal', task = 'Read synthetic input') {
  const root = mkdtempSync(join(tmpdir(), 'orbit-epoch-'))
  const create = () => {
    const core = new OrbitCore({ dataDir: join(root, 'data'), shell: '/bin/sh', browser: null,
      broadcast: () => {}, run: async () => ({ code: 127, stdout: '', stderr: 'offline' }),
      agentCommand: () => ({ file: '/bin/sh', args: ['-c', 'printf "READY\\n"; while read line; do :; done'] }) })
    core.setEndpoint('http://127.0.0.1:1')
    return core
  }
  const core = create()
  core.handle({ type: 'workspace.open', path: root })
  core.handle({ type: 'mission.create', workspaceId: core.store.snapshot().workspaces[0]!.id, title: 'Epoch', objective: '', mode: 'agentica', lead: { cli: 'shell', model: null, title: 'Lead' } })
  const lead = core.store.snapshot().panes.find(p => p.role === 'lead')!
  const { pane } = await core.spawnHelper(lead, { title: 'Worker', task, difficulty, cli: 'claude', model: null })
  return { core, pane, lead, create, root }
}


function deliver(core: OrbitCore, pane: import('@orbit/protocol').Pane) {
  return core.handoff(pane, { summary: 'Concluído na fixture', evidence: 'synthetic check; exit 0; output: fixture ok' }).resultId
}
function review(core: OrbitCore, lead: import('@orbit/protocol').Pane, resultId: string) {
  const inspection = core.inspectResult(lead, resultId)
  core.verifyResult(lead, { inspectionId: inspection.id, verdict: 'accepted', summary: 'Revisão sintética', checks: [{ command: 'synthetic check', exitCode: 0, summary: 'fixture ok' }], criteria: inspection.acceptance.map((_, i) => ({ item: i + 1, met: true, how: 'observação sintética' })) })
}

test('simples conclui com evidência do executor, sem revisor, inclusive após restart', async () => {
  const { core, pane, lead, create } = await fixture('simples', 'Run npm test')
  try {
    assert.throws(() => core.handoff(pane, { summary: 'Sem evidência' }), /evidence/)
    deliver(core, pane)
    assert.equal(core.missionProgress(lead.missionId).integration.state, 'none')
    assert.ok(core.missionReady(lead, 'Verificado pelo executor', false).readyAt)
    await core.shutdown()
    const restored = create()
    try { assert.equal(restored.verificationStatus(lead.missionId)[0]?.valid, true) }
    finally { await restored.shutdown() }
  } finally { await core.shutdown() }
})

test('normal exige revisão independente, mas uma única atividade dispensa integração', async () => {
  const { core, pane, lead } = await fixture()
  try {
    const resultId = deliver(core, pane)
    assert.throws(() => core.missionReady(lead, 'Sem revisão', false), /validação independente/)
    review(core, lead, resultId)
    assert.equal(core.missionProgress(lead.missionId).integration.state, 'none')
    assert.ok(core.missionReady(lead, 'Revisado', false).readyAt)
  } finally { await core.shutdown() }
})

test('duas atividades com revisão exigem integração final', async () => {
  const { core, pane, lead } = await fixture()
  try {
    const first = deliver(core, pane)
    review(core, lead, first)
    const second = await core.spawnHelper(lead, { title: 'Second', task: 'Implement feature', cli: 'claude', model: null })
    const resultId = deliver(core, second.pane)
    review(core, lead, resultId)
    assert.equal(core.missionProgress(lead.missionId).integration.state, 'pending')
    assert.throws(() => core.missionReady(lead, 'Sem integração', false), /integrado/)
    const inspection = core.inspectResult(lead, resultId, 'integration')
    core.verifyResult(lead, { inspectionId: inspection.id, verdict: 'accepted', summary: 'Integração sintética', checks: [{ command: 'synthetic integration', exitCode: 0, summary: 'ok' }], criteria: inspection.acceptance.map((_, i) => ({ item: i + 1, met: true, how: 'observado' })) })
    assert.ok(core.missionReady(lead, 'Integrado', false).readyAt)
  } finally { await core.shutdown() }
})

for (const task of ['security fix', 'migração de banco', 'race condition', 'Processar dados pessoais']) {
  test(`${task} mantém revisão mesmo com dificuldade simples explícita`, async () => {
    const { core, pane, lead } = await fixture('simples', task)
    try {
      deliver(core, pane)
      assert.throws(() => core.missionReady(lead, 'Sem revisão', false), /validação independente/)
    } finally { await core.shutdown() }
  })
}
