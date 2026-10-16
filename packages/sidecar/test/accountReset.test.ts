import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OrbitCore } from '../src/core.ts'

const requestId = '12345678-1234-1234-1234-123456789012'
test('free reset routes through the selected account only and refuses unconfirmed, unknown, expired and non-Codex benefits', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orbit-reset-core-'))
  const commands: string[] = []
  const core = new OrbitCore({ dataDir: root, shell: '/bin/sh', broadcast: () => {}, browser: null, run: async command => {
    commands.push(command)
    if (command.includes('--reset-credit')) return { code: 0, stdout: JSON.stringify({ outcome: 'nothingToReset' }), stderr: '' }
    return { code: 127, stdout: '', stderr: 'offline' }
  } })
  try {
    await core.handle({ type: 'account.save', account: { cli: 'codex', kind: 'assinatura', name: 'Second synthetic account', auto: false } })
    const account = core.store.accounts().find(a => a.name === 'Second synthetic account')!
    const now = Date.now()
    core.store.setLimits({ accountId: account.id, cli: 'codex', fiveHour: { usedPercent: 75, resetsAt: now + 3600000, windowMinutes: 300 }, weekly: null, plan: 'plus', updatedAt: now, resetCredits: { availableCount: 1, credits: [{ id: 'free-only', resetType: 'codexRateLimits', expiresAt: now + 100000 }] } })
    const results: any[] = []
    const request = { type: 'account.reset' as const, accountId: account.id, requestId, creditId: 'free-only', confirmed: true as const }
    for (const bad of [{ ...request, confirmed: false }, { ...request, creditId: 'unadvertised' }, { ...request, accountId: 'claude' }]) {
      const before = commands.filter(c => c.includes('--reset-credit')).length
      await core.handle(bad as any, m => results.push(m))
      assert.equal(results.at(-1).type, 'account.reset.error')
      assert.equal(commands.filter(c => c.includes('--reset-credit')).length, before)
    }
    await core.handle(request, m => results.push(m))
    assert.equal(results.at(-1).type, 'account.reset.result')
    assert.equal(results.at(-1).outcome, 'nothingToReset')
    const consume = commands.find(c => c.includes('--reset-credit'))!
    assert.match(consume, /CODEX_HOME=/)
    assert.ok(consume.includes(account.id))
    assert.ok(consume.includes(requestId) && consume.includes('free-only'))
    assert.equal(commands.filter(c => c.includes('--reset-credit')).length, 1)
    core.store.setLimits({ ...core.store.limits().find(l => l.accountId === account.id)!, updatedAt: now + 1, resetCredits: { availableCount: 1, credits: [{ id: 'expired', resetType: 'codexRateLimits', expiresAt: now - 1 }] } })
    await core.handle({ ...request, creditId: 'expired' }, m => results.push(m))
    assert.equal(results.at(-1).type, 'account.reset.error')
    assert.equal(commands.filter(c => c.includes('--reset-credit')).length, 1)
  } finally { await core.shutdown(); rmSync(root, { recursive: true, force: true }) }
})
