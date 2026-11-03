import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs, { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '../src/store.ts'
import { fixture } from './r2Fixture.ts'

const ID = 'roles-do-repositorio'
function role(root: string, id = 'revisor', patch = {}) {
  const dir = join(root, '.maestri', 'roles', id); mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'role.json'), JSON.stringify({ id, name: 'Revisor local', cli: 'codex', model: 'gpt-6.1-sol', skills: ['review'], onlySkills: true, ...patch }))
  for (const f of ['CLAUDE.md', 'AGENTS.md']) writeFileSync(join(dir, f), 'Contrato literal do repositório.\n')
  return dir
}
function setup(t: import('node:test').TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'orbit-role-store-'))
  const store = new Store(join(root, 'data'))
  t.after(() => { store.flush(); rmSync(root, { recursive: true, force: true }) })
  return { store, root }
}

test('workspace criado deriva squad visível no snapshot e resolvível, sem persistir', t => {
  const { store, root } = setup(t); role(root)
  store.createWorkspace('', [root])
  const squad = store.squad(ID)!
  assert.ok(squad); assert.equal(squad.name, 'Roles do repositório'); assert.equal(squad.builtin, true)
  assert.equal(squad.roles[0]!.brief, 'Contrato literal do repositório.\n')
  assert.deepEqual(store.snapshot().squads.find(s => s.id === ID), squad)
  store.flush()
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'data', 'state.json'), 'utf8')).customSquads, [])
  squad.roles[0]!.brief = 'Mutação do chamador'
  assert.equal(store.squad(ID)!.roles[0]!.brief, 'Contrato literal do repositório.\n')
})
test('inicialização e edição do workspace recalculam o squad', t => {
  const { store, root } = setup(t); const workspace = store.createWorkspace('', [root]); store.flush()
  role(root)
  const restored = new Store(join(root, 'data'))
  try {
    assert.ok(restored.squad(ID))
    restored.updateWorkspace(workspace.id, { folders: [join(root, 'vazio')] })
    assert.equal(restored.squad(ID), undefined)
    restored.updateWorkspace(workspace.id, { folders: [root] })
    assert.ok(restored.squad(ID))
  } finally { restored.flush() }
})
test('pastas repetidas são lidas uma vez e id duplicado entre pastas mantém o primeiro', t => {
  const { store, root } = setup(t); role(root)
  const second = join(root, 'segundo'); role(second, 'revisor', { name: 'Segundo' })
  store.createWorkspace('', [root, root, second]); store.createWorkspace('', [root])
  const squad = store.squad(ID)!
  assert.ok(squad); assert.equal(squad.roles.length, 1); assert.equal(squad.roles[0]!.name, 'Revisor local')
  assert.match(squad.description, /id duplicado/)
  assert.doesNotMatch(squad.description, /\+1/)
})
test('sem roles válidos o squad não aparece (ALREADY_COVERED)', t => {
  const { store, root } = setup(t); role(root, 'ruim', { cli: 'shell' }); store.createWorkspace('', [root])
  assert.equal(store.squad(ID), undefined); assert.ok(!store.squads().some(s => s.id === ID))
})
test('descrição mostra três motivos, contador restante e mantém limite do protocolo', t => {
  const { store, root } = setup(t); role(root)
  for (let i = 0; i < 5; i++) { const dir = role(root, `ruim-${i}`); rmSync(join(dir, 'role.json')) }
  store.createWorkspace('', [root])
  const description = store.squad(ID)!.description
  assert.equal((description.match(/role.json ausente/g) ?? []).length, 3)
  assert.match(description, /\+2/); assert.ok(description.length <= 280)
})
test('limite de oito roles também vale para múltiplas pastas', t => {
  const { store, root } = setup(t)
  for (let i = 0; i < 9; i++) { const folder = join(root, `p${i}`); role(folder, `r${i}`); store.createWorkspace('', [folder]) }
  assert.equal(store.squad(ID)!.roles.length, 8); assert.match(store.squad(ID)!.description, /limite.*8/)
})
test('snapshots usam cache; nova missão squad recarrega arquivos sem aplicar squad por padrão', t => {
  const { store, root } = setup(t); const workspace = store.createWorkspace('', [root]); role(root)
  assert.equal(store.snapshot().squads.some(s => s.id === ID), false)
  const free = store.createMission({ workspaceId: workspace.id, title: 'Livre', objective: '', mode: 'livre', squadId: null })
  assert.equal(free.squadId, null); assert.equal(store.squad(ID), undefined)
  store.createMission({ workspaceId: workspace.id, title: 'Squad', objective: '', mode: 'squad', squadId: ID })
  assert.ok(store.squad(ID))
})
test('seleção explícita atualiza antes de validar e aplica role ao helper real', async () => {
  const { core, lead, root } = await fixture()
  try {
    role(root, 'revisor', { skills: ['orbit-review'] })
    await core.handle({ type: 'mission.create', workspaceId: core.store.mission(lead.missionId)!.workspaceId, title: 'Roles importados', objective: '', mode: 'squad', squadId: ID, lead: { cli: 'shell', model: null, title: 'Lead' } })
    const mission = core.store.snapshot().missions.find(m => m.title === 'Roles importados')
    assert.ok(mission, 'recarregar antes de validar permite selecionar roles recém-criados')
    assert.equal(core.missionSquad(mission.id)?.id, ID)
    const boss = core.store.snapshot().panes.find(p => p.missionId === mission.id && p.role === 'lead')!
    const { pane } = await core.spawnHelper(boss, { title: 'Revisar', task: 'Revise o arquivo.', squadRoleId: 'revisor', model: null })
    assert.equal(pane.cli, 'codex'); assert.equal(pane.model, 'gpt-6.1-sol'); assert.equal(pane.squadRole, 'Revisor local')
    const prompt = readFileSync(join(root, 'data', 'panes', String(pane.id), 'role.md'), 'utf8')
    assert.match(prompt, /Contrato literal do repositório/); assert.match(prompt, /orbit-review/)
    assert.equal(core.store.executionPolicy(pane.id)?.readOnly, true)
  } finally { await core.shutdown() }
})
test('missão antiga com squad removido conserva comportamento de squad ausente', async () => {
  const { core, lead, root } = await fixture()
  try {
    const workspaceId = core.store.mission(lead.missionId)!.workspaceId
    const dir = role(root); core.store.updateWorkspace(workspaceId, { name: 'Repo' })
    await core.handle({ type: 'mission.create', workspaceId, title: 'Antiga', objective: '', mode: 'squad', squadId: ID, lead: { cli: 'shell', model: null, title: 'Lead' } })
    const old = core.store.snapshot().missions.find(m => m.title === 'Antiga')!
    assert.ok(core.missionSquad(old.id))
    rmSync(dir, { recursive: true })
    core.store.createMission({ workspaceId, title: 'Atualiza', objective: '', mode: 'squad', squadId: 'caca-bugs' })
    assert.equal(core.missionSquad(old.id), undefined)
    const missing = core.store.createMission({ workspaceId, title: 'Ausente', objective: '', mode: 'squad', squadId: 'ausente' })
    assert.equal(core.missionSquad(old.id), core.missionSquad(missing.id))
    const caller = core.store.snapshot().panes.find(p => p.missionId === old.id && p.role === 'lead')!
    await assert.rejects(core.spawnHelper(caller, { title: 'Inválido', task: 'Revise.', squadRoleId: 'revisor', model: null }), /não existe no squad/)
  } finally { await core.shutdown() }
})

test('falha de persistência do workspace também reverte o squad derivado', t => {
  const { store, root } = setup(t); role(root)
  const workspace = store.createWorkspace('', [root])
  const before = store.squad(ID)
  mkdirSync(join(root, 'data', 'state.json.tmp'))
  try {
    assert.throws(() => store.updateWorkspace(workspace.id, { folders: [join(root, 'vazio')] }))
    assert.deepEqual(store.workspace(workspace.id)!.folders, [root])
    assert.deepEqual(store.squad(ID), before)
  } finally { rmSync(join(root, 'data', 'state.json.tmp'), { recursive: true }) }
})

function countDiscovery() {
  const open = fs.openSync; const opendir = fs.opendirSync
  const counts = { opens: 0, scans: 0 }
  fs.openSync = ((path, ...args) => {
    if (/[\\/]roles[\\/][^/]+[\\/](role.json|CLAUDE.md|AGENTS.md)$/.test(String(path))) counts.opens++
    return open(path, ...args)
  }) as typeof fs.openSync
  fs.opendirSync = ((path, ...args) => {
    if (String(path).endsWith('/.maestri/roles')) counts.scans++
    return opendir(path, ...args)
  }) as typeof fs.opendirSync
  syncBuiltinESMExports()
  return { counts, restore() { fs.openSync = open; fs.opendirSync = opendir; syncBuiltinESMExports() } }
}

test('256 aliases de workspace provocam uma única varredura física', t => {
  const { root, store } = setup(t); role(root)
  const workspace = store.createWorkspace('', [root]); store.flush()
  const statePath = join(root, 'data', 'state.json')
  const state = JSON.parse(readFileSync(statePath, 'utf8'))
  state.workspaces = Array.from({ length: 256 }, (_, i) => {
    const path = join(root, `alias-${i}`); symlinkSync(root, path)
    return { ...workspace, id: `workspace-${i}`, path, folders: [path] }
  })
  writeFileSync(statePath, JSON.stringify(state))
  const probe = countDiscovery()
  try {
    const restored = new Store(join(root, 'data'))
    try {
      assert.deepEqual(restored.squad(ID)!.roles.map(r => r.id), ['revisor'])
      t.diagnostic(JSON.stringify(probe.counts))
      assert.equal(probe.counts.scans, 1); assert.equal(probe.counts.opens, 3)
    } finally { restored.flush() }
  } finally { probe.restore() }
})

test('oito roles aceitos encerram aberturas de conteúdo em todas as pastas', t => {
  const { root, store } = setup(t)
  const folders = Array.from({ length: 3 }, (_, i) => {
    const folder = join(root, `repo-${i}`)
    for (let j = 0; j < 16; j++) role(folder, `r-${i}-${String(j).padStart(2, '0')}`)
    return folder
  })
  const probe = countDiscovery()
  try {
    store.createWorkspace('', folders)
    assert.equal(store.squad(ID)!.roles.length, 8)
    assert.match(store.squad(ID)!.description, /limite.*8/)
    t.diagnostic(JSON.stringify(probe.counts))
    assert.equal(probe.counts.opens, 24); assert.equal(probe.counts.scans, 1)
  } finally { probe.restore() }
})

test('orçamento global de candidatos limita leituras mesmo com roles inválidos', t => {
  const { root, store } = setup(t)
  const folders = [join(root, 'a'), join(root, 'b')]
  role(folders[0]!, 'a-valido')
  for (const folder of folders) for (let i = 0; i < 40; i++) role(folder, `z-${String(i).padStart(2, '0')}`, { cli: 'shell' })
  const probe = countDiscovery()
  try {
    store.createWorkspace('', folders)
    assert.deepEqual(store.squad(ID)!.roles.map(r => r.id), ['a-valido'])
    t.diagnostic(JSON.stringify(probe.counts))
    // One valid role opens three files; each of the other 63 candidates opens only metadata.
    assert.equal(probe.counts.opens, 66)
    assert.match(store.squad(ID)!.description, /limite.*64/)
  } finally { probe.restore() }
})

test('orçamento global limita a 32 pastas físicas distintas', t => {
  const { root, store } = setup(t)
  const folders = Array.from({ length: 33 }, (_, i) => {
    const folder = join(root, `repo-${i}`); mkdirSync(join(folder, '.maestri', 'roles'), { recursive: true })
    return folder
  })
  role(folders[0]!, 'primeiro'); role(folders[32]!, 'fora-do-orcamento')
  const probe = countDiscovery()
  try {
    store.createWorkspace('', folders)
    t.diagnostic(JSON.stringify(probe.counts))
    assert.equal(probe.counts.scans, 32)
    assert.deepEqual(store.squad(ID)!.roles.map(r => r.id), ['primeiro'])
    assert.match(store.squad(ID)!.description, /limite.*32/)
  } finally { probe.restore() }
})

test('criação de missão pelo core atualiza os roles uma única vez', async () => {
  const { core, lead, root } = await fixture()
  try {
    role(root)
    const probe = countDiscovery()
    try {
      await core.handle({ type: 'mission.create', workspaceId: core.store.mission(lead.missionId)!.workspaceId, title: 'Atualização única', objective: '', mode: 'squad', squadId: ID, lead: { cli: 'shell', model: null, title: 'Lead' } })
      assert.ok(core.store.snapshot().missions.some(m => m.title === 'Atualização única'))
      assert.equal(probe.counts.scans, 1); assert.equal(probe.counts.opens, 3)
    } finally { probe.restore() }
  } finally { await core.shutdown() }
})

test('excluir a última origem remove squad do store e do snapshot', t => {
  const { store, root } = setup(t); role(root)
  const workspace = store.createWorkspace('', [root])
  assert.ok(store.squad(ID))
  store.forgetWorkspace(workspace.id)
  assert.equal(store.workspace(workspace.id), undefined)
  assert.equal(store.squad(ID), undefined)
  assert.equal(store.snapshot().squads.some(s => s.id === ID), false)
})

test('excluir uma origem invalida seus roles e preserva outra missão ativa', async () => {
  const { core, lead, root } = await fixture()
  try {
    const deleted = core.store.mission(lead.missionId)!.workspaceId
    role(root, 'removido'); core.store.updateWorkspace(deleted, { name: 'Excluir' })
    const other = join(root, 'outro'); role(other, 'preservado', { skills: ['orbit-review'] })
    const kept = core.store.createWorkspace('', [other])
    await core.handle({ type: 'mission.create', workspaceId: kept.id, title: 'Sobrevive', objective: '', mode: 'squad', squadId: ID, lead: { cli: 'shell', model: null, title: 'Lead' } })
    const mission = core.store.snapshot().missions.find(m => m.title === 'Sobrevive')!
    const caller = core.store.snapshot().panes.find(p => p.missionId === mission.id && p.role === 'lead')!
    core.store.forgetWorkspace(deleted)
    assert.equal(core.store.mission(mission.id)!.status, 'active')
    assert.deepEqual(core.missionSquad(mission.id)!.roles.map(r => r.id), ['preservado'])
    await assert.rejects(core.spawnHelper(caller, { title: 'Removido', task: 'Revise.', squadRoleId: 'removido', model: null }), /não existe no squad/)
    const { pane } = await core.spawnHelper(caller, { title: 'Preservado', task: 'Revise.', squadRoleId: 'preservado', model: null })
    assert.equal(pane.squadRole, 'Revisor local')
  } finally { await core.shutdown() }
})

test('falha ao persistir exclusão reverte workspace, missões, memória e squad', t => {
  const { store, root } = setup(t); role(root)
  const workspace = store.createWorkspace('', [root])
  const mission = store.createMission({ workspaceId: workspace.id, title: 'Ativa', objective: '', mode: 'squad', squadId: ID })
  store.saveMemory(workspace.id, { id: 'memoria', kind: 'decisao', text: 'Preservar no rollback.', at: 1, source: null, pinned: true })
  const memoryBefore = store.memory(workspace.id)
  const before = store.snapshot()
  mkdirSync(join(root, 'data', 'state.json.tmp'))
  try {
    assert.throws(() => store.forgetWorkspace(workspace.id))
    assert.deepEqual(store.snapshot(), before)
    assert.ok(store.mission(mission.id))
    assert.deepEqual(store.memory(workspace.id), memoryBefore)
  } finally { rmSync(join(root, 'data', 'state.json.tmp'), { recursive: true }) }
})
