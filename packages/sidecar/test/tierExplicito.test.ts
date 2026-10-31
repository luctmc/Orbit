import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Effort } from '@orbit/protocol'
import { OrbitCore } from '../src/core.ts'
import { seedRoutingQuota } from './helpers.ts'
import { seatForDifficulty } from '../src/maestro.ts'

async function fixture(objective = '', squad = false, classifier = false) {
  const root = mkdtempSync(join(tmpdir(), 'tier-'))
  const core = new OrbitCore({ dataDir: join(root, 'data'), shell: '/bin/sh', browser: null,
    broadcast: () => {}, run: async command => classifier && command.startsWith('claude -p')
      ? { code: 0, stdout: JSON.stringify({ structured_output: { kind: 'bug', difficulty: 'dificil', why: 'Diagnóstico complexo' } }), stderr: '' }
      : { code: 127, stdout: '', stderr: 'offline' },
    agentCommand: () => ({ file: '/bin/sh', args: ['-c', 'while read line; do :; done'] }) })
  core.setEndpoint('http://127.0.0.1:1')
  core.handle({ type: 'workspace.open', path: root })
  await seedRoutingQuota(core)
  core.handle({ type: 'mission.create', workspaceId: core.store.snapshot().workspaces[0]!.id,
    title: 'Missão', objective, mode: squad ? 'squad' : 'agentica', squadId: squad ? 'caca-bugs' : undefined,
    adaptiveLead: !!objective, lead: objective ? { cli: 'claude', model: 'claude-sonnet-5-5', effort: 'medium', title: 'Lead' } : { cli: 'shell', model: null, title: 'Lead' } })
  const lead = core.store.snapshot().panes.find(p => p.role === 'lead')!
  return { core, lead, root }
}

for (const task of ['Diagnose race condition', 'security', 'migração de dados pessoais']) {
  test(`regra sugere esforço sem elevar modelo: ${task}`, async () => {
    const { core, lead } = await fixture()
    try {
      const opened = await core.spawnHelper(lead, { title: 'Worker', task, taskTypeId: 'bug', model: null })
      assert.deepEqual([opened.pane.model, opened.pane.effort], ['claude-sonnet-5-5', 'high'])
      const attempt = core.store.currentPaneAttempt(opened.pane.id)!
      assert.equal(attempt.decision?.difficulty, 'dificil')
      assert.ok(core.reviewRequired(lead.missionId, attempt.activityId))
      assert.match(opened.receipt.join('\n'), /sugestão da regra:.*modelo mantido \(tabela\).*high/)
      assert.match(attempt.decision!.reasons.join('\n'), /sugestão da regra:/)
    } finally { await core.shutdown() }
  })
}

test('dificuldade difícil explícita do líder eleva a família e registra origem', async () => {
  const { core, lead } = await fixture()
  try {
    const opened = await core.spawnHelper(lead, { title: 'Worker', task: 'Diagnose race condition', taskTypeId: 'bug', model: null, difficulty: 'dificil' })
    assert.deepEqual([opened.pane.model, opened.pane.effort], ['claude-opus-5-5', 'high'])
    assert.match(opened.receipt.join('\n'), /tier explícito: líder/)
    assert.match(core.store.currentPaneAttempt(opened.pane.id)!.decision!.reasons.join('\n'), /tier explícito: líder/)
  } finally { await core.shutdown() }
})

test('líder automático mantém modelo para migração sensível e registra sugestão', async () => {
  const { core, lead, root } = await fixture('migração de dados pessoais')
  try {
    assert.deepEqual([lead.model, lead.effort], ['claude-sonnet-5-5', 'high'])
    const context = JSON.parse(readFileSync(join(root, 'data', 'panes', String(lead.id), 'context.json'), 'utf8'))
    assert.match(context.decision.reasons.join('\n'), /sugestão da regra:/)
  } finally { await core.shutdown() }
})

test('regex simples mantém o rebaixamento econômico', async () => {
  const { core, lead } = await fixture()
  try {
    const { pane } = await core.spawnHelper(lead, { title: 'Run build', task: 'Execute npm run build', taskTypeId: 'bug', model: null })
    assert.deepEqual([pane.model, pane.effort], ['claude-haiku-5-5', 'low'])
  } finally { await core.shutdown() }
})

test('modelo nomeado pelo líder permanece intacto mesmo com risco difícil', async () => {
  const { core, lead } = await fixture()
  try {
    const { pane } = await core.spawnHelper(lead, { title: 'Worker', task: 'Diagnose race condition', taskTypeId: 'bug', cli: 'claude', model: 'claude-sonnet-5-5', effort: 'medium', difficulty: 'dificil' })
    assert.deepEqual([pane.model, pane.effort], ['claude-sonnet-5-5', 'medium'])
    assert.match(core.store.currentPaneAttempt(pane.id)!.decision!.reasons.join('\n'), /tier explícito: líder.*modelo nomeado/)
  } finally { await core.shutdown() }
})

test('papel de squad mantém o modelo escolhido', async () => {
  const { core, lead } = await fixture('', true)
  try {
    const { pane } = await core.spawnHelper(lead, { title: 'Worker', task: 'Diagnose race condition', squadRoleId: 'batedor', model: null, difficulty: 'dificil' })
    assert.equal(pane.model, 'claude-sonnet-5-5')
    assert.match(core.store.currentPaneAttempt(pane.id)!.decision!.reasons.join('\n'), /tier explícito: papel do squad/)
  } finally { await core.shutdown() }
})

test('classificador auxiliar difícil também só sugere esforço', async () => {
  const { core, lead } = await fixture('', false, true)
  try {
    const opened = await core.spawnHelper(lead, { title: 'Worker', task: 'Observe o comportamento', model: null })
    assert.deepEqual([opened.pane.model, opened.pane.effort], ['claude-sonnet-5-5', 'high'])
    assert.equal(core.store.currentPaneAttempt(opened.pane.id)?.decision?.difficulty, 'dificil')
    assert.match(opened.receipt.join('\n'), /Haiku/)
  } finally { await core.shutdown() }
})

test('sugestão respeita catálogo sem esforço acima de high nem família nova', () => {
  for (const levels of [['low', 'max'], ['xhigh', 'max'], ['low', 'medium', 'high', 'max']] as Effort[][]) {
    const seat = seatForDifficulty('claude', 'table-model', 'medium', 'dificil', () => levels, undefined, false)
    assert.equal(seat.model, 'table-model')
    assert.equal(seat.effort, levels.includes('high') ? 'high' : levels.includes('low') ? 'low' : null)
  }
})

for (const difficulty of [undefined, 'dificil'] as const) {
  test(`CLI explícita separa risco e tier do líder: ${difficulty ?? 'sugerido'}`, async () => {
    const { core, lead } = await fixture()
    try {
      const opened = await core.spawnHelper(lead, { title: 'Worker', task: 'security', taskTypeId: 'bug', cli: 'claude', model: null, difficulty })
      assert.deepEqual([opened.pane.model, opened.pane.effort], [difficulty ? 'claude-opus-5-5' : 'claude-sonnet-5-5', 'high'])
    } finally { await core.shutdown() }
  })
}

test('linha manual da tabela mantém modelo e recebe apenas esforço sugerido', async () => {
  const { core, lead } = await fixture()
  try {
    const routing = core.store.routing()
    routing.taskTypes.find(t => t.id === 'bug')!.automatic = false
    core.store.saveRouting(routing)
    const opened = await core.spawnHelper(lead, { title: 'Worker', task: 'security', taskTypeId: 'bug', model: null })
    assert.deepEqual([opened.pane.model, opened.pane.effort], ['claude-sonnet-5-5', 'high'])
    assert.match(opened.receipt.join('\n'), /tier explícito: tabela/)
  } finally { await core.shutdown() }
})

for (const objective of ['Diagnose race condition', 'security audit']) {
  test(`líder automático com risco mantém modelo: ${objective}`, async () => {
    const { core, lead, root } = await fixture(objective)
    try {
      assert.deepEqual([lead.model, lead.effort], ['claude-sonnet-5-5', 'high'])
      const context = JSON.parse(readFileSync(join(root, 'data', 'panes', String(lead.id), 'context.json'), 'utf8'))
      assert.match(context.decision.reasons.join('\n'), /sugestão da regra:/)
    } finally { await core.shutdown() }
  })
}
