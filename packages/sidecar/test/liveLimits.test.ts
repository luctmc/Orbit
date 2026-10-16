import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { HOMES } from './helpers.ts'
import { OrbitCore } from '../src/core.ts'
import { Store } from '../src/store.ts'
import { fromCodexRollout } from '../src/usage.ts'
import { parseClaudeUsage } from '../src/claudeUsage.ts'
import { BUILTIN_ACCOUNTS } from '../src/accounts.ts'

test('an older session observation cannot replace newer account limits', () => {
  const store = new Store(mkdtempSync(join(tmpdir(), 'orbit-limit-store-')))
  const limits = { accountId: 'codex', cli: 'codex' as const, fiveHour: { usedPercent: 53, resetsAt: Date.now() + 3600000, windowMinutes: 300 }, weekly: null, plan: 'plus', updatedAt: 200 }
  store.setLimits(limits)
  store.setLimits({ ...limits, fiveHour: { ...limits.fiveHour, usedPercent: 24 }, updatedAt: 100 })
  assert.equal(store.limits()[0]!.fiveHour!.usedPercent, 53)
})

test('rollout limits retain the event observation time rather than the file read time', () => {
  const at = Date.now() - 3600000
  const event = { timestamp: new Date(at).toISOString(), payload: { type: 'token_count', rate_limits: { primary: { used_percent: 24, resets_at: Date.now() / 1000 + 3600 } } } }
  assert.equal(fromCodexRollout(JSON.stringify(event)).limits?.updatedAt, at)
})

test('Claude text with an unrecognized reset does not invent a new quota window', () => {
  assert.equal(parseClaudeUsage('Current session: 50% used · resets ???')?.fiveHour ?? null, null)
})

test('Codex account check reads current provider limits instead of an old rollout', async () => {
  const now = Date.now(), path = join(HOMES.codex, 'sessions', '2026', '10', '15')
  mkdirSync(path, { recursive: true })
  writeFileSync(join(path, 'rollout-old.jsonl'), JSON.stringify({ timestamp: new Date(now - 3600000).toISOString(), payload: { type: 'token_count', rate_limits: { primary: { used_percent: 24, resets_at: now / 1000 + 3600 } } } }))
  const commands: string[] = []
  const core = new OrbitCore({ dataDir: mkdtempSync(join(tmpdir(), 'orbit-live-limits-')), shell: '/bin/sh', browser: null, broadcast: () => {}, run: async command => {
    commands.push(command)
    if (command.endsWith('codex login status')) return { code: 0, stdout: 'Logged in using ChatGPT', stderr: '' }
    if (command.includes('read-codex-limits.mjs')) return { code: 0, stdout: JSON.stringify({ rateLimitsByLimitId: { codex: { primary: { usedPercent: 53, resetsAt: now / 1000 + 3600, windowDurationMins: 300 }, secondary: null, planType: 'plus' } } }), stderr: '' }
    return { code: 127, stdout: '', stderr: 'offline' }
  } })
  try {
    await core.checkAccount('codex')
    assert.equal(core.store.limits().find(l => l.accountId === 'codex')?.fiveHour?.usedPercent, 53)
    assert(commands.some(c => c.includes('read-codex-limits.mjs')))
  } finally { await core.shutdown() }
})

test('a failed live read preserves the last observation and exposes the failed attempt', async () => {
  const at = Date.now() - 10000
  const core = new OrbitCore({ dataDir: mkdtempSync(join(tmpdir(), 'orbit-limit-failure-')), shell: '/bin/sh', browser: null, broadcast: () => {}, run: async command => command.endsWith('codex login status') ? { code: 0, stdout: 'Logged in using ChatGPT', stderr: '' } : { code: 1, stdout: '', stderr: 'synthetic outage' } })
  core.store.setLimits({ accountId: 'codex', cli: 'codex', fiveHour: { usedPercent: 53, windowMinutes: 300, resetsAt: Date.now() + 3600000 }, weekly: null, plan: 'plus', updatedAt: at })
  try {
    await core.checkAccount('codex')
    const value = core.store.limits().find(l => l.accountId === 'codex')!
    assert.equal(value.fiveHour?.usedPercent, 53)
    assert.equal(value.updatedAt, at)
    assert(value.refreshError)
    assert(value.checkedAt! > at)
  } finally { await core.shutdown() }
})

test('current quota queries keep account profiles and percentages separate', async () => {
  const commands: string[] = []
  const core = new OrbitCore({ dataDir: mkdtempSync(join(tmpdir(), 'orbit-limit-profiles-')), shell: '/bin/sh', browser: null, broadcast: () => {}, run: async command => {
    commands.push(command)
    if (command.endsWith('codex login status')) return { code: 0, stdout: 'Logged in using ChatGPT', stderr: '' }
    return { code: 0, stdout: JSON.stringify({ rateLimits: { primary: { usedPercent: command.startsWith('CODEX_HOME=') ? 60 : 10, resetsAt: Date.now() / 1000 + 3600, windowDurationMins: 300 }, secondary: null } }), stderr: '' }
  } })
  core.store.saveAccount({ ...BUILTIN_ACCOUNTS[1]!, id: 'work', builtin: false, name: 'Work' })
  try {
    await Promise.all([core.checkAccount('codex'), core.checkAccount('work')])
    assert.equal(core.store.limits().find(l => l.accountId === 'codex')?.fiveHour?.usedPercent, 10)
    assert.equal(core.store.limits().find(l => l.accountId === 'work')?.fiveHour?.usedPercent, 60)
    assert(commands.some(c => c.startsWith('CODEX_HOME=') && c.includes('/accounts/work/codex') && c.includes('read-codex-limits.mjs')))
  } finally { await core.shutdown() }
})
