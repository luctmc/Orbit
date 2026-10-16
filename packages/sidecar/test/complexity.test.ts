import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as maestro from '../src/maestro.ts'
import { DEFAULT_ROUTING } from '../src/routing.ts'
import type { CliCatalog } from '@orbit/protocol'

test('complexity is inferred even with a known kind, bounded by scope and risk', () => {
  assert.equal(maestro.assessDifficulty('Run build', 'Execute npm run build and report the exit code').difficulty, 'simples')
  assert.equal(maestro.assessDifficulty('Executar projeto', 'Inicie o servidor de desenvolvimento').difficulty, 'simples')
  assert.equal(maestro.assessDifficulty('Refatoração', 'Reestruture a arquitetura de autenticação em vários módulos').difficulty, 'dificil')
  assert.equal(maestro.assessDifficulty('Build', 'Run the build and diagnose an intermittent concurrency failure').difficulty, 'dificil')
  assert.equal(maestro.assessDifficulty('Tela', 'Adicione uma tela de perfil').difficulty, 'normal')
})

test('Codex tiers use advertised models and their effort levels without inventing ids', () => {
  const catalog: CliCatalog = { source: 'cli', efforts: ['low', 'medium', 'high'], models: [
    { id: 'gpt-6-astra', label: 'Astra', description: 'Frontier intelligence for demanding work', efforts: ['medium', 'high'], defaultEffort: 'medium' },
    { id: 'gpt-6-sol', label: 'Sol', description: 'Workhorse', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' },
    { id: 'gpt-6-luna', label: 'Luna', description: 'Fast and affordable', efforts: ['low', 'medium'], defaultEffort: 'low' },
  ] }
  const levels = (model: string | null) => catalog.models.find((m) => m.id === model)?.efforts ?? catalog.efforts
  assert.deepEqual(maestro.seatForDifficulty('codex', null, 'high', 'simples', levels, catalog), { model: 'gpt-6-luna', effort: 'low', changed: true })
  assert.deepEqual(maestro.seatForDifficulty('codex', null, 'medium', 'dificil', levels, catalog), { model: 'gpt-6-astra', effort: 'high', changed: true })
  const unknown: CliCatalog = { ...catalog, models: [] }
  assert.equal(maestro.seatForDifficulty('codex', null, null, 'simples', levels, unknown).model, null)
  assert.equal(maestro.classifyTask('Run the build', DEFAULT_ROUTING.taskTypes, 'Build').type.id, 'operacao')
  assert.equal(maestro.classifyTask('Fix the crash in checkout', DEFAULT_ROUTING.taskTypes, 'Fix checkout').type.id, 'bug')
})

test('cost gate: hard work is capped at high effort and a stray risk word is not a hard task', () => {
  const levels = () => ['low', 'medium', 'high', 'xhigh', 'max'] as const
  assert.equal(maestro.seatForDifficulty('claude', 'claude-opus-5-5', 'high', 'dificil', levels as never).effort, 'high')
  assert.equal(maestro.seatForDifficulty('claude', 'claude-sonnet-5-5', 'medium', 'dificil', levels as never).effort, 'high')
  assert.equal(maestro.assessDifficulty('Docs', 'Atualize o README citando a segurança e o servidor distribuído').difficulty, 'normal')
  assert.equal(maestro.assessDifficulty('Auditoria', 'Faça uma auditoria de segurança do login').difficulty, 'dificil')
})

test('default table starts cheap: lead and kinds are not Opus/high; saved untouched old defaults migrate, edits stay', async () => {
  assert.deepEqual(DEFAULT_ROUTING.lead, { cli: 'claude', model: 'claude-sonnet-5-5', effort: 'medium' })
  for (const t of DEFAULT_ROUTING.taskTypes) assert.ok(t.effort !== 'high' && t.effort !== 'xhigh' && t.model !== 'claude-opus-5-5', t.id)
  const { mkdtempSync, writeFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { Store } = await import('../src/store.ts')
  const dir = mkdtempSync(join(tmpdir(), 'orbit-mig-'))
  const old = structuredClone(DEFAULT_ROUTING)
  for (const row of old.taskTypes) delete row.automatic
  old.lead = { cli: 'claude', model: 'claude-opus-5-5', effort: 'high' }
  Object.assign(old.taskTypes.find((t) => t.id === 'investigacao')!, { model: 'claude-opus-5-5', effort: 'high' })
  Object.assign(old.taskTypes.find((t) => t.id === 'revisao')!, { effort: 'xhigh' }) // edited by the human
  writeFileSync(join(dir, 'state.json'), JSON.stringify({ version: 1, nextPaneId: 1, workspaces: [], missions: [], panes: [], events: [], customSquads: [], routing: old, usageDays: [], limits: [], customAccounts: [], builtinAuto: {}, disabledCatalog: [], paneSpecs: {}, cards: [], templates: [], schedules: [], settings: {}, proposals: [], usageLog: [] }))
  const routing = new Store(dir).routing()
  assert.deepEqual(routing.lead, old.lead, 'saved leader seat has no provenance; preserve the human choice')
  assert.equal(routing.taskTypes.find((t) => t.id === 'investigacao')!.effort, 'medium')
  assert.equal(routing.taskTypes.find((t) => t.id === 'revisao')!.effort, 'xhigh')
})

test('migration compares the whole row, preserves null alternate and explicit automatic=false, and is idempotent', async () => {
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { Store } = await import('../src/store.ts')
  const dir = mkdtempSync(join(tmpdir(), 'orbit-safe-routing-'))
  const old = structuredClone(DEFAULT_ROUTING)
  for (const row of old.taskTypes) delete row.automatic
  old.taskTypes.find(t => t.id === 'bug')!.skills = ['human-skill']
  old.taskTypes.find(t => t.id === 'documentacao')!.alt = null
  old.taskTypes.find(t => t.id === 'testes')!.method += '\nHuman instruction.'
  old.taskTypes.find(t => t.id === 'refatoracao')!.automatic = false
  const first = new Store(dir); first.saveRouting(old); first.flush()
  const next = new Store(dir)
  const result = next.routing()
  assert.equal(result.taskTypes.find(t => t.id === 'operacao')!.automatic, true)
  for (const id of ['bug','documentacao','testes','refatoracao']) assert.deepEqual(result.taskTypes.find(t => t.id === id), old.taskTypes.find(t => t.id === id), id)
  next.flush()
  assert.deepEqual(new Store(dir).routing(), result)
})
