import { test } from 'node:test'
import assert from 'node:assert/strict'
import { accountRooms, chooseAccount, cliLoad, seatForDifficulty } from '../src/maestro.ts'
import { BUILTIN_ACCOUNTS } from '../src/accounts.ts'
import type { AccountLimits, AccountStatus, Effort } from '@orbit/protocol'
const now = Date.now(), account = BUILTIN_ACCOUNTS.find(a => a.cli === 'codex')!
const status: AccountStatus = { accountId: account.id, loggedIn: true, checkedAt: now, busy: null, email: null, method: 'test', plan: null, loginPaneId: null, message: null }
const limits = (extra: Partial<AccountLimits> = {}): AccountLimits => ({ accountId: account.id, cli: 'codex', source: 'provider', fiveHour: { usedPercent: 10, resetsAt: now + 10000, windowMinutes: 300 }, weekly: null, updatedAt: now, plan: null, ...extra })
const rooms = (l: AccountLimits[]) => accountRooms('codex', [account], [status], l, new Map(), now)
test('expired and stale quota never becomes an observed zero, nor clears saturated capacity', () => {
  for (const limit of [limits({ fiveHour: null }), limits({ updatedAt: now - 100000 }), limits({ updatedAt: now + 10000 }), limits({ refreshError: 'offline' }), limits({ fiveHour: { usedPercent: 10, resetsAt: now - 1, windowMinutes: 300 } })]) {
    assert.equal(rooms([limit])[0]!.used, null)
  }
  assert.equal(rooms([limits({ updatedAt: now - 100000, fiveHour: { usedPercent: 99, resetsAt: now - 1, windowMinutes: 300 } })])[0]!.full, true)
  assert.equal(cliLoad(rooms([])), null, 'unknown capacity does not take part in load balancing')
})
test('all saturated windows must reset before reporting account recovery', () => {
  const r = rooms([limits({ fiveHour: { usedPercent: 90, resetsAt: now + 1000, windowMinutes: 300 }, weekly: { usedPercent: 99, resetsAt: now + 100000, windowMinutes: 10080 } })])[0]!
  assert.equal(r.full, true)
  assert.equal(r.resetsAt, now + 100000)
  const healthy = { ...r, account: { ...account, id: 'healthy' }, used: 60, full: false }
  const unknown = { ...r, used: null, full: false }
  assert.equal(chooseAccount([unknown, healthy]).account?.id, 'healthy')
})
test('hard tasks never select the lowest effort because medium is absent', () => {
  const levels = () => ['low', 'high', 'xhigh'] as Effort[]
  assert.equal(seatForDifficulty('codex', null, null, 'dificil', levels).effort, 'high')
})
