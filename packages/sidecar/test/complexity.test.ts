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
