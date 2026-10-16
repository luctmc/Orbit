import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_ROUTING, normalizeRouting } from '../src/routing.ts'
import { automaticTaskSeat } from '../src/taskPolicy.ts'
import { CLAUDE_CATALOG } from '../src/clis.ts'
import type { Catalog, AgentSeat } from '@orbit/protocol'

const catalog: Catalog = { claude: CLAUDE_CATALOG, codex: { source: 'cli', defaultModel: 'gpt-6.1-sol', defaultEffort: 'high', efforts: ['low','medium','high'], models: ['gpt-6.1-sol','gpt-6-luna'].map(id => ({ id, label: id, description: '', efforts: ['low','medium','high'], defaultEffort: 'medium' })) }, gemini: { source: 'builtin', efforts: [], models: [] }, antigravity: { source: 'builtin', efforts: [], models: [] } }
const account = { id: 'codex', cli: 'codex' as const, name: 'test', builtin: true, kind: 'assinatura' as const, auto: true, keyHint: null, model: null, baseUrl: null, createdAt: 0 }
const base = { catalog, preferred: { cli: 'claude' as const, model: 'claude-sonnet-5-5', effort: 'medium' as const }, difficulty: 'normal' as const, design: null, allowed: ['claude','codex'] as Array<'claude'|'codex'>, rooms: (cli: string) => cli === 'codex' ? [{ account, used: 10, full: false, live: 0, resetsAt: null }] : [] }

test('every factory primary and equivalent has an explicit model and task-appropriate effort', () => {
 for (const row of DEFAULT_ROUTING.taskTypes) {
  assert.ok(row.model, row.id)
  assert.ok(row.alt?.model, `${row.id}: equivalent`)
  const codex = row.cli === 'codex' ? row : row.alt!
  assert.equal(codex.model, ['operacao','documentacao'].includes(row.id) ? 'gpt-6-luna' : 'gpt-6.1-sol', row.id)
  assert.equal(codex.effort, ['operacao','documentacao'].includes(row.id) ? 'low' : 'medium', row.id)
 }
})

test('quota fallback respects pinned equivalent, including a deliberate CLI default, and rejects incompatible efforts', () => {
 const alternate: AgentSeat = { cli: 'codex', model: null, effort: null, pinned: true }
 assert.deepEqual(automaticTaskSeat({ ...base, alternate, difficulty: 'simples' }), { cli: 'codex', model: 'gpt-6.1-sol', effort: 'high' })
 assert.equal(automaticTaskSeat({ ...base, alternate: { ...alternate, model: 'gpt-6-luna', effort: 'ultra' } }), null)
 assert.equal(automaticTaskSeat({ ...base, alternate, catalog: { ...catalog, codex: { ...catalog.codex, defaultModel: null } } }), null)
 const draft = structuredClone(DEFAULT_ROUTING)
 draft.taskTypes[0]!.alt = alternate
 assert.equal(normalizeRouting(draft).taskTypes[0]!.alt?.pinned, true)
})

test('visual quota fallback never lowers its policy to a cheap or pinned incompatible equivalent', () => {
 assert.deepEqual(automaticTaskSeat({ ...base, alternate: { cli: 'codex', model: 'gpt-6-luna', effort: 'low' }, design: 'frontend' }), { cli: 'codex', model: 'gpt-6.1-sol', effort: 'medium' })
 assert.equal(automaticTaskSeat({ ...base, alternate: { cli: 'codex', model: 'gpt-6-luna', effort: 'low', pinned: true }, design: 'frontend' }), null)
 assert.equal(automaticTaskSeat({ ...base, alternate: { cli: 'codex', model: 'gpt-6.1-sol', effort: 'high' }, design: 'motion' }), null)
})

test('legacy factory rows migrate as a whole; human default and custom alternate remain intact across restart', async () => {
 const { Store } = await import('../src/store.ts')
 const { LEGACY_DEFAULT_ROUTING } = await import('../src/routing.ts')
 const { mkdtempSync } = await import('node:fs')
 const { tmpdir } = await import('node:os')
 const { join } = await import('node:path')
 const dir = mkdtempSync(join(tmpdir(), 'orbit-equivalents-'))
 const old = structuredClone(LEGACY_DEFAULT_ROUTING)
 old.taskTypes.find(t => t.id === 'bug')!.alt = { cli: 'codex', model: null, effort: 'high', pinned: true }
 old.taskTypes.find(t => t.id === 'testes')!.automatic = false
 old.taskTypes.find(t => t.id === 'investigacao')!.method += '\nHuman investigation method.'
 const first = new Store(dir); first.saveRouting(old); first.flush()
 const next = new Store(dir)
 const result = next.routing()
 for (const id of ['operacao','funcionalidade','refatoracao','documentacao','revisao']) assert.deepEqual(result.taskTypes.find(t => t.id === id), DEFAULT_ROUTING.taskTypes.find(t => t.id === id), id)
 for (const id of ['bug','testes','investigacao']) assert.deepEqual(result.taskTypes.find(t => t.id === id), old.taskTypes.find(t => t.id === id), id)
 next.flush()
 assert.deepEqual(new Store(dir).routing(), result)
})

test('an inherited null equivalent resolves both model and effort instead of inheriting an expensive personal effort', () => {
 assert.deepEqual(automaticTaskSeat({ ...base, alternate: { cli: 'codex', model: null, effort: null } }), { cli: 'codex', model: 'gpt-6.1-sol', effort: 'medium' })
})
