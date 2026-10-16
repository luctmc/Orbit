import { test } from 'node:test'
import assert from 'node:assert/strict'
import { harnessAccounts, harnessCandidates } from '../src/harnessEligibility.ts'
import { BUILTIN_ACCOUNTS } from '../src/accounts.ts'
import { blankStatus } from '../src/clis.ts'
import type { AccountLimits, AccountStatus, Catalog } from '@orbit/protocol'
const now = Date.now()
const account = BUILTIN_ACCOUNTS.find(a => a.cli === 'codex')!
const status: AccountStatus = { accountId: account.id, loggedIn: true, checkedAt: now, busy: null, email: null, method: 'fixture', plan: 'fixture', loginPaneId: null, message: null }
const window = { usedPercent: 10, resetsAt: now + 100000, windowMinutes: 300 }
const limit: AccountLimits = { accountId: account.id, cli: 'codex', source: 'provider', fiveHour: window, weekly: window, plan: null, updatedAt: now }
test('adaptive admission rejects stale, failed, incomplete and saturated quota, unknown auth and API seats', () => {
  assert.equal(harnessAccounts([account], [status], [limit], now).length, 1)
  for (const bad of [{ ...limit, updatedAt: now - 91000 }, { ...limit, updatedAt: now + 1 }, { ...limit, refreshError: 'fixture failure' }, { ...limit, weekly: null }, { ...limit, source: 'session' as const }, { ...limit, fiveHour: { ...window, usedPercent: 85 } }, { ...limit, fiveHour: { ...window, resetsAt: now - 1 } }]) assert.equal(harnessAccounts([account], [status], [bad], now).length, 0)
  assert.equal(harnessAccounts([account], [{ ...status, loggedIn: null }], [limit], now).length, 0)
  assert.equal(harnessAccounts([{ ...account, kind: 'api' }], [status], [limit], now).length, 0)
})
test('candidates enumerate native model/effort availability and preserve mission/sandbox restrictions', () => {
  const entry = { models: [{ id: 'fixture-model', label: 'Fixture', description: '', efforts: ['low', 'high'] as Array<'low' | 'high'>, defaultEffort: null }], efforts: ['low', 'high'] as Array<'low' | 'high'>, source: 'cli' as const }
  const catalog: Catalog = { codex: entry, claude: { ...entry, source: 'builtin' }, gemini: { ...entry, source: 'builtin' }, antigravity: { ...entry, source: 'builtin' } }
  const installed = { ...blankStatus('codex'), installed: true, version: 'fixture-v1' }
  assert.deepEqual(harnessCandidates(catalog, [installed], [account], ['codex'], true).map(c => c.effort), ['low', 'high'])
  assert.equal(harnessCandidates(catalog, [installed], [account], ['claude'], false).length, 0)
  assert.equal(harnessCandidates({ ...catalog, codex: { ...entry, source: 'builtin' } }, [installed], [account], ['codex'], false).length, 0)
  assert.equal(harnessCandidates(catalog, [{ ...installed, installed: false }], [account], ['codex'], false).length, 0)
})
