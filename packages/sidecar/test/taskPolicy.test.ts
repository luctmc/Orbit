import { test } from 'node:test'
import assert from 'node:assert/strict'
import { accountRooms, chooseAccount } from '../src/maestro.ts'
import { automaticTaskSeat, designWork } from '../src/taskPolicy.ts'
import { CLAUDE_FIXTURE as CLAUDE_CATALOG } from './catalogFixture.ts'
import type { Account, AccountLimits, Catalog } from '@orbit/protocol'
const now = Date.now()
const account = (id: string, cli: Account['cli'] = 'codex'): Account => ({ id, cli, name: id, builtin: false, kind: 'assinatura', auto: true, keyHint: null, model: null, baseUrl: null, createdAt: 0 })
const limit = (id: string, used: number, cli: Account['cli'] = 'codex'): AccountLimits => ({ accountId: id, cli, source: 'provider', fiveHour: { usedPercent: used, resetsAt: now + 3600000, windowMinutes: 300 }, weekly: null, updatedAt: now, plan: null })
const accounts = [account('codex-1'), account('codex-2'), account('claude', 'claude')]
const catalog: Catalog = { claude: CLAUDE_CATALOG, codex: { source: 'cli', efforts: ['low', 'medium', 'high'], models: ['gpt-6.1-sol', 'gpt-6-luna', 'gpt-6-astra'].map(id => ({ id, label: id, description: '', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' })) }, gemini: { source: 'builtin', efforts: [], models: [] }, antigravity: { source: 'builtin', efforts: [], models: [] } }
const rooms = (limits: AccountLimits[], live = new Map<string, number>()) => (cli: Account['cli']) => accountRooms(cli, accounts, [], limits, live, now)
const base = { catalog, preferred: { cli: 'claude' as const, model: 'claude-sonnet-5-5', effort: 'medium' as const }, alternate: { cli: 'codex' as const, model: null, effort: 'medium' as const }, allowed: ['claude', 'codex'] as Array<'claude' | 'codex'>, difficulty: 'normal' as const, design: null }

test('two Codex accounts are independent: weekly constraints, stale/error/mismatched quota and live load', () => {
  const limits = [limit('codex-1', 5), { ...limit('codex-2', 10), weekly: { usedPercent: 99, resetsAt: now + 7200000, windowMinutes: 10080 } }]
  assert.equal(chooseAccount(rooms(limits)('codex')).account?.id, 'codex-1')
  limits[1] = limit('codex-2', 10)
  assert.equal(chooseAccount(rooms(limits, new Map([['codex-1', 1]]))('codex')).account?.id, 'codex-2')
  for (const bad of [{ ...limit('codex-1', 1), updatedAt: now - 90001 }, { ...limit('codex-1', 1), source: 'session' as const }, { ...limit('codex-1', 1), refreshError: 'failed' }, limit('codex-1', 1, 'claude'), { ...limit('codex-1', 1), weekly: { usedPercent: NaN, resetsAt: now + 1, windowMinutes: 1 } }, { ...limit('codex-1', 1), fiveHour: { usedPercent: 1, resetsAt: now - 1, windowMinutes: 300 } }]) {
    assert.equal(rooms([bad])('codex')[0]!.used, null)
    assert.equal(automaticTaskSeat({ ...base, rooms: rooms([bad]) }), null)
  }
  const seat = automaticTaskSeat({ ...base, rooms: rooms([limit('claude', 60, 'claude'), limit('codex-1', 99), limit('codex-2', 10)]) })
  assert.equal(seat?.cli, 'codex')
})

test('simple work stays cheap; frontend and motion obey exact catalog identities and efforts', () => {
  const available = rooms([limit('claude', 60, 'claude'), limit('codex-1', 10)])
  assert.deepEqual(automaticTaskSeat({ ...base, rooms: available, difficulty: 'simples' }), { cli: 'codex', model: 'gpt-6-luna', effort: 'low' })
  assert.deepEqual(automaticTaskSeat({ ...base, rooms: available, design: 'frontend', difficulty: 'simples' }), { cli: 'codex', model: 'gpt-6.1-sol', effort: 'medium' })
  assert.deepEqual(automaticTaskSeat({ ...base, rooms: available, design: 'frontend', difficulty: 'dificil' }), { cli: 'codex', model: 'gpt-6.1-sol', effort: 'high' })
  assert.deepEqual(automaticTaskSeat({ ...base, rooms: available, design: 'motion' }), { cli: 'claude', model: 'claude-opus-5-5', effort: 'high' })
  assert.equal(automaticTaskSeat({ ...base, rooms: rooms([limit('codex-1', 10)]), design: 'motion' }), null)
  assert.equal(automaticTaskSeat({ ...base, catalog: { ...catalog, codex: { ...catalog.codex, models: [] } }, allowed: ['codex'], rooms: available, design: 'frontend' }), null)
  assert.equal(designWork('Crie animações com GSAP'), 'motion')
  assert.equal(designWork('Implemente frontend React'), 'frontend')
})

test('real helper launch uses second Codex quota, refuses unknown automatic capacity and preserves explicit seats', async () => {
  const { fixture } = await import('./r2Fixture.ts')
  const f = await fixture()
  try {
    const second = account('codex-2')
    f.core.store.saveAccount(second)
    const internal = f.core as any
    internal.catalog = catalog
    for (const id of ['codex', second.id, 'claude']) internal.accountStatus.set(id, { accountId: id, loggedIn: true, busy: null, checkedAt: now })
    f.core.store.setLimits(limit('codex', 80))
    f.core.store.setLimits(limit(second.id, 10))
    f.core.store.setLimits(limit('claude', 70, 'claude'))
    const opened = await f.core.spawnHelper(f.lead, { title: 'Bug', task: 'Corrija um bug no parser', taskTypeId: 'bug', model: null, readOnly: true })
    assert.deepEqual([opened.pane.cli, opened.pane.model, opened.pane.accountId], ['codex', 'gpt-6.1-sol', second.id])
    assert.equal(f.core.store.currentPaneAttempt(opened.pane.id)?.decision?.source, 'rule', 'quota policy is not benchmark evidence')
    // A human-pinned CLI default survives quota fallback and reaches the actual launch.
    internal.catalog.codex.defaultModel = 'gpt-6.1-sol'
    internal.catalog.codex.defaultEffort = 'high'
    const routing = f.core.store.routing()
    routing.taskTypes.find(t => t.id === 'bug')!.alt = { cli: 'codex', model: null, effort: null, pinned: true }
    f.core.store.saveRouting(routing)
    f.core.store.setLimits(limit('claude', 100, 'claude'))
    const fallback = await f.core.spawnHelper(f.lead, { title: 'Pinned fallback', task: 'Corrija o parser de texto', taskTypeId: 'bug', difficulty: 'simples', model: null, readOnly: true })
    assert.deepEqual([fallback.pane.cli, fallback.pane.model, fallback.pane.effort, fallback.pane.accountId], ['codex', 'gpt-6.1-sol', 'high', second.id])
    assert.match(fallback.receipt.join('\n'), /equivalente fixado pelo usuário.*padrão da CLI resolvido/)
    for (const id of ['codex', second.id, 'claude']) f.core.store.setLimits({ ...limit(id, 10, id === 'claude' ? 'claude' : 'codex'), refreshError: 'synthetic quota refresh failure' })
    await assert.rejects(f.core.spawnHelper(f.lead, { title: 'Next bug', task: 'Corrija outro bug', taskTypeId: 'bug', model: null, readOnly: true }), /nenhuma conta com quota válida/)
    const pinned = await f.core.spawnHelper(f.lead, { title: 'Explicit', task: 'Inspect parser', cli: 'codex', model: 'gpt-6.1-sol', effort: 'high', readOnly: true })
    assert.deepEqual([pinned.pane.cli, pinned.pane.accountId, pinned.pane.model, pinned.pane.effort], ['codex', 'codex', 'gpt-6.1-sol', 'high'])
  } finally { await f.core.shutdown() }
})
