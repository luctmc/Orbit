import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OrbitCore } from '../src/core.ts'
import { providerSetup, PROVIDER_SETUP } from '../src/providerSetup.ts'
import { offline } from './helpers.ts'

test('provider commands are fixed official actions and reject arbitrary shell/provider input', () => {
  for (const id of Object.keys(PROVIDER_SETUP)) {
    const install = providerSetup(id, 'install')
    assert.match(install.command, / --version$/)
    assert.ok(install.docs.startsWith('https://'))
    assert.ok(providerSetup(id, 'connect').command)
  }
  assert.throws(() => providerSetup('grok; touch /tmp/owned', 'install'))
  assert.throws(() => providerSetup('__proto__', 'install'))
  assert.throws(() => providerSetup('grok', 'curl arbitrary'))
})

test('installed OpenCode is preserved and unknown setup actions launch no terminal', async () => {
  const probes: string[] = [], replies: any[] = []
  let launches = 0
  const core = new OrbitCore({ dataDir: mkdtempSync(join(tmpdir(), 'orbit-provider-')), shell: '/bin/sh', browser: null, broadcast: () => {}, run: async command => { probes.push(command); return { code: 0, stdout: '/fixture/opencode', stderr: '' } }, agentCommand: () => { launches++; return { file: '/bin/sh', args: ['-c', 'exit 0'] } } })
  try {
    await core.handle({ type: 'provider.setup', provider: 'opencode', action: 'install', requestId: 'preserve-v2' }, m => replies.push(m))
    assert.equal(replies[0].phase, 'failed')
    assert.match(replies[0].message, /preservada/)
    assert.equal(launches, 0)
    assert.deepEqual(probes, ['command -v opencode'])
    await core.handle({ type: 'provider.setup', provider: 'x; echo injected', action: 'install', requestId: 'reject' } as any, m => replies.push(m))
    assert.equal(launches, 0)
    assert.equal(probes.length, 1)
  } finally { await core.shutdown() }
})

test('setup gets a visible PTY, retry retains it, and real process failure is reported', async () => {
  const replies: any[] = [], messages: any[] = [], probes: string[] = []
  const core = new OrbitCore({ dataDir: mkdtempSync(join(tmpdir(), 'orbit-provider-pty-')), shell: '/bin/sh', browser: null, broadcast: m => messages.push(m), run: async command => { probes.push(command); return offline() },
    // Read the fixed shell text without executing it; no external installer is run by this test.
    agentCommand: () => ({ file: '/bin/sh', args: ['-c', 'read line; printf "synthetic setup failure\\n"; exit 9'] }) })
  try {
    const request = { type: 'provider.setup' as const, provider: 'grok' as const, action: 'install' as const, requestId: 'visible-setup' }
    await core.handle(request, m => replies.push(m))
    assert.equal(replies[0].phase, 'running')
    assert.ok(replies[0].paneId)
    assert.ok(await core.paneSnapshot(replies[0].paneId))
    await core.handle(request, m => replies.push(m))
    assert.equal(replies[1].paneId, replies[0].paneId)
    for (let i = 0; i < 40 && !messages.some(m => m.type === 'provider.setup.result' && m.phase === 'failed'); i++) await new Promise(r => setTimeout(r, 25))
    assert.match(messages.find(m => m.type === 'provider.setup.result' && m.phase === 'failed')?.message ?? '', /código 9/)
    assert.deepEqual(probes, ['command -v grok'])
  } finally { await core.shutdown() }
})

test('targeted catalog refresh retries a cached failure only for selected account and preserves model effort', async () => {
  const probes: string[] = [], replies: any[] = []
  let available = false
  const core = new OrbitCore({ dataDir: mkdtempSync(join(tmpdir(), 'orbit-one-catalog-')), shell: '/bin/sh', browser: null, broadcast: () => {}, run: async command => {
    probes.push(command)
    if (!available) return offline()
    return { code: 0, stderr: '', stdout: JSON.stringify({ models: [{ slug: 'gpt-6.1-sol', visibility: 'list', supported_reasoning_levels: [{ effort: 'medium' }], default_reasoning_level: 'medium' }] }) }
  } })
  try {
    const internals = core as any
    await internals.catalogForAccount(core.store.account('claude'))
    const unrelated = internals.accountCatalogs.claude
    await internals.catalogForAccount(core.store.account('codex'))
    const before = probes.length
    available = true
    await core.handle({ type: 'account.catalog.refresh', accountId: 'codex', requestId: 'refresh-selected' }, m => replies.push(m))
    assert.equal(probes.length, before + 1)
    assert.match(probes.at(-1)!, /codex debug models$/)
    assert.equal(internals.accountCatalogs.claude, unrelated)
    await internals.catalogForAccount(core.store.account('claude'))
    assert.equal(probes.length, before + 1, 'other provider cache was not invalidated')
    assert.equal(replies[0].ok, true)
    assert.deepEqual(replies[0].catalog.efforts, [], 'aggregate efforts are not model capabilities')
    assert.deepEqual(replies[0].catalog.models[0].efforts, ['medium'])
    const { effortsFor } = await import('@orbit/protocol')
    const selected = replies[0].catalog
    assert.deepEqual(effortsFor({ claude: unrelated, codex: selected, gemini: unrelated, antigravity: unrelated }, 'codex', 'gpt-6.1-sol'), ['medium'])
    const count = probes.length
    await core.handle({ type: 'account.catalog.refresh', accountId: 'unknown', requestId: 'invalid-refresh' }, m => replies.push(m))
    assert.equal(replies[1].ok, false)
    assert.equal(probes.length, count)
  } finally { await core.shutdown() }
})

test('expired catalog is pending while selected probe runs and fresh model capabilities replace sentinel', async () => {
  let release!: (value: any) => void
  const core = new OrbitCore({ dataDir: mkdtempSync(join(tmpdir(), 'orbit-expired-catalog-')), shell: '/bin/sh', browser: null, broadcast: () => {}, run: () => new Promise(resolve => { release = resolve }) })
  try {
    const internals = core as any, account = core.store.account('codex')!
    const { accountCatalogKey } = await import('../src/accountCatalog.ts')
    internals.accountCatalogs.codex = { source: 'cli', models: [], efforts: [], expiresAt: Date.now() - 1 }
    internals.catalogKeys.set('codex', accountCatalogKey(account, internals.accountFiles, null))
    const pending = internals.currentAccountCatalog(account)
    assert.equal(pending.origin, 'unavailable')
    assert.match(pending.reason, /atualização solicitada/)
    await Promise.resolve(); await Promise.resolve()
    release({ code: 0, stderr: '', stdout: JSON.stringify({ models: [{ slug: 'gpt-6.1-sol', visibility: 'list', supported_reasoning_levels: [{ effort: 'medium' }] }] }) })
    await internals.catalogForAccount(account)
    assert.deepEqual(internals.currentAccountCatalog(account).models[0].efforts, ['medium'])
    assert.equal(core.store.snapshot().panes.length, 0, 'refresh never launches an agent')
  } finally { await core.shutdown() }
})
