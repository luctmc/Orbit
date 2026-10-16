import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Account, AccountLimits, AccountStatus } from '@orbit/protocol'
import { BUILTIN_ACCOUNTS, normalizeAccount, pickAccount } from '../src/accounts.ts'
import type { Run } from '../src/clis.ts'
import type { AgentLaunch } from '../src/command.ts'
import { startServer } from '../src/server.ts'
import { connect, ORIGIN, TOKEN, HOMES } from './helpers.ts'

const account = (patch: Partial<Account>): Account => ({ id: 'x', cli: 'claude', name: 'x', kind: 'assinatura', builtin: false, baseUrl: null, model: null, keyHint: null, auto: true, createdAt: 1, ...patch })
const limits = (accountId: string, usedPercent: number): AccountLimits => ({ accountId, cli: 'claude', fiveHour: { usedPercent, resetsAt: Date.now() + 3_600_000, windowMinutes: 300 }, weekly: null, plan: null, updatedAt: 1 })
const status = (accountId: string, loggedIn: boolean | null): AccountStatus => ({ accountId, loggedIn, method: null, email: null, plan: null, checkedAt: 1, busy: null, loginPaneId: null, message: null })

test('Orbit picks the subscription with the most room, and API keys only when they are all used up', () => {
  const here = { ...BUILTIN_ACCOUNTS[0]! }
  const second = account({ id: 'second', createdAt: 2 })
  const api = account({ id: 'api', kind: 'api', keyHint: '…abcd', createdAt: 3 })
  const all = [here, second, api]
  assert.equal(pickAccount('claude', all, [], [limits('claude', 60), limits('second', 20)]).id, 'second')
  assert.equal(pickAccount('claude', all, [], [limits('claude', 10), limits('second', 20)]).id, 'claude')
  assert.equal(pickAccount('claude', all, [], []).id, 'claude', 'ties go to this Mac')
  assert.equal(pickAccount('claude', all, [status('claude', false)], [limits('second', 50)]).id, 'second', 'logged-out accounts are skipped')
  assert.equal(pickAccount('claude', all, [], [limits('claude', 99), limits('second', 97)]).id, 'api', 'used up: the API key takes over')
  assert.equal(pickAccount('claude', [here, second, { ...api, auto: false }], [], [limits('claude', 99), limits('second', 97)]).id, 'second', 'not marked for automatic use')
  assert.equal(pickAccount('codex', [...all, { ...BUILTIN_ACCOUNTS[1]!, auto: false }], [], []).id, 'codex', 'falls back to the built-in account')
})

test('accounts are validated before anything is stored', () => {
  assert.throws(() => normalizeAccount({ cli: 'claude', name: ' ', kind: 'assinatura' }, undefined, 'a'), /nome/)
  assert.throws(() => normalizeAccount({ cli: 'claude', name: 'p', kind: 'api', baseUrl: 'http://example.com' }, undefined, 'a'), /https/)
  assert.throws(() => normalizeAccount({ cli: 'claude', name: 'p', kind: 'api', model: 'x; rm -rf /' }, undefined, 'a'), /Modelo inválido/)
  const ok = normalizeAccount({ cli: 'claude', name: 'OpenRouter', kind: 'api', baseUrl: 'https://openrouter.ai/api/', model: 'anthropic/claude-sonnet-5.5' }, undefined, 'a')
  assert.equal(ok.baseUrl, 'https://openrouter.ai/api')
  assert.equal(ok.auto, false, 'API accounts are not picked automatically unless asked')
  assert.equal(normalizeAccount({ cli: 'claude', name: 'local', kind: 'api', baseUrl: 'http://localhost:4000' }, undefined, 'a').baseUrl, 'http://localhost:4000')
})

test('accounts: each runs in its own folder, keys stay in the sidecar, logins open a terminal', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'orbit-data-'))
  // The person's own config folders, shared with extra accounts.
  const claudeHome = mkdtempSync(join(tmpdir(), 'claude-home-'))
  writeFileSync(join(claudeHome, 'CLAUDE.md'), '# minhas regras')
  mkdirSync(join(claudeHome, 'skills'))
  process.env.CLAUDE_CONFIG_DIR = claudeHome
  process.env.CODEX_HOME = mkdtempSync(join(tmpdir(), 'codex-home-'))

  const ran: string[] = []
  const run: Run = async (command) => {
    ran.push(command)
    const extra = command.startsWith('CLAUDE_CONFIG_DIR=') || command.startsWith('CODEX_HOME=')
    if (command.endsWith('claude auth status')) return { code: 0, stdout: JSON.stringify(extra ? { loggedIn: false, authMethod: 'none' } : { loggedIn: true, authMethod: 'claude.ai', email: 'pessoa@exemplo.dev', subscriptionType: 'max' }), stderr: '' }
    if (command.endsWith('codex login status')) return { code: 0, stdout: extra ? 'Not logged in\n' : 'Logged in using ChatGPT\n', stderr: '' }
    if (command.includes('codex login --with-api-key <')) return { code: 0, stdout: 'Successfully logged in\n', stderr: '' }
    return { code: 127, stdout: '', stderr: 'offline' }
  }
  const fake = (launch: AgentLaunch, shell: string) => ({
    file: shell,
    args: ['-c', launch.login
      ? `echo "LOGIN ${launch.cli} \${${launch.cli === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME'}:-}"`
      : `echo "ENV:\${CLAUDE_CONFIG_DIR:-none}|\${ANTHROPIC_BASE_URL:-none}|\${ANTHROPIC_DEFAULT_HAIKU_MODEL:-none}:"; exec ${shell}`],
  })
  const server = await startServer({ port: 0, token: TOKEN, allowedOrigins: [ORIGIN], dataDir, shell: '/bin/sh', run, agentCommand: fake })
  const ui = connect(server.port)
  const KEY = 'sk-or-v1-segredo-de-teste-9f3k'
  try {
    await ui.opened
    const { snapshot } = await ui.next('snapshot')
    assert.deepEqual(snapshot.accounts.map((a) => a.id), ['claude', 'codex', 'gemini', 'antigravity'])
    await ui.next('account.status', (m) => m.statuses.find((s) => s.accountId === 'claude')?.email === 'pessoa@exemplo.dev')

    // A Claude account on an Anthropic-compatible provider.
    ui.send({ type: 'account.save', account: { cli: 'claude', name: 'OpenRouter', kind: 'api', baseUrl: 'https://openrouter.ai/api', model: 'anthropic/claude-sonnet-5.5', key: KEY } })
    const { accounts } = await ui.next('accounts', (m) => m.accounts.length === 5)
    const openrouter = accounts[4]!
    assert.equal(openrouter.keyHint, '…9f3k')
    const keyFile = join(dataDir, 'accounts', openrouter.id, 'key')
    assert.equal(statSync(keyFile).mode & 0o777, 0o600)
    await ui.next('account.status', (m) => m.statuses.some((s) => s.accountId === openrouter.id && s.loggedIn === true))
    assert.ok(existsSync(join(dataDir, 'accounts', openrouter.id, 'claude', 'CLAUDE.md')), 'instructions are shared')
    assert.ok(existsSync(join(dataDir, 'accounts', openrouter.id, 'claude', 'skills')), 'skills are shared')

    // An agent on that account: its own config folder, the provider, the key through apiKeyHelper.
    const ws = realpathSync(mkdtempSync(join(tmpdir(), 'orbit-ws-')))
    ui.send({ type: 'workspace.open', path: ws })
    const { workspace } = await ui.next('workspace.updated')
    ui.send({ type: 'mission.create', workspaceId: workspace.id, title: 'Contas', objective: '', mode: 'livre', lead: { cli: 'claude', model: null, title: '', accountId: openrouter.id } })
    const { pane: lead } = await ui.next('pane.updated', (m) => m.pane.role === 'lead')
    assert.equal(lead.accountId, openrouter.id)
    assert.equal(lead.model, 'anthropic/claude-sonnet-5.5', "the account's model is the default")
    const env = await ui.next('pane.data', (m) => m.paneId === lead.id && m.data.includes('ENV:'))
    assert.match(env.data, new RegExp(`ENV:${join(dataDir, 'accounts', openrouter.id, 'claude')}\\|https://openrouter.ai/api\\|anthropic/claude-sonnet-5.5:`))
    const settings = JSON.parse(readFileSync(join(dataDir, 'panes', String(lead.id), 'settings.json'), 'utf8'))
    assert.equal(settings.apiKeyHelper, `cat '${keyFile}'`)

    // A second Codex subscription: logged out until the person logs in through a terminal.
    ui.send({ type: 'account.save', account: { cli: 'codex', name: 'Codex trabalho', kind: 'assinatura' } })
    const work = (await ui.next('accounts', (m) => m.accounts.length === 6)).accounts[5]!
    await ui.next('account.status', (m) => m.statuses.some((s) => s.accountId === work.id && s.loggedIn === false))
    ui.send({ type: 'account.login', accountId: work.id })
    const { statuses } = await ui.next('account.status', (m) => m.statuses.some((s) => s.accountId === work.id && s.loginPaneId !== null))
    const loginPane = statuses.find((s) => s.accountId === work.id)!.loginPaneId!
    assert.match((await ui.next('pane.data', (m) => m.paneId === loginPane && m.data.includes('LOGIN'))).data, new RegExp(`LOGIN codex ${join(dataDir, 'accounts', work.id, 'codex')}`))
    assert.ok(!ui.inbox.some((m) => m.type === 'pane.updated' && m.pane.id === loginPane), 'a login is not an agent of any mission')
    ui.send({ type: 'pane.close', paneId: loginPane })
    await ui.next('pane.removed', (m) => m.paneId === loginPane)
    await ui.next('account.status', (m) => m.statuses.some((s) => s.accountId === work.id && s.loginPaneId === null && s.busy === null))

    // Without a choice, Codex agents go to the logged-in account.
    ui.send({ type: 'pane.spawn', request: { missionId: lead.missionId, role: 'crew', cli: 'codex', model: null, title: 'auto', readOnly: true } })
    assert.equal((await ui.next('pane.updated', (m) => m.pane.title === 'auto')).pane.accountId, 'codex')
    // Limits are recorded per account.
    ui.send({ type: 'pane.input', paneId: lead.id, data: 'echo "TOKEN:$ORBIT_PANE_TOKEN:"\r' })
    const token = /TOKEN:([\w-]{20,}):/.exec((await ui.next('pane.data', (m) => m.paneId === lead.id && /TOKEN:[\w-]{20,}:/.test(m.data))).data)![1]!
    await fetch(`http://127.0.0.1:${server.port}/status`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ rate_limits: { five_hour: { used_percentage: 12, resets_at: Date.now() / 1000 + 3600 } } }) })
    await ui.next('limits', (m) => m.limits.some((l) => l.accountId === openrouter.id && l.fiveHour?.usedPercent === 12))

    // A Codex API key is handed to `codex login` from the file, never on a command line.
    ui.send({ type: 'account.save', account: { cli: 'codex', name: 'OpenAI', kind: 'api', key: KEY } })
    await ui.next('accounts', (m) => m.accounts.length === 7)
    await new Promise((r) => setTimeout(r, 200))
    assert.ok(ran.some((c) => c.includes('codex login --with-api-key <')))
    assert.ok(!ran.some((c) => c.includes(KEY)), 'the key never reaches a command line')
    assert.ok(!JSON.stringify(ui.inbox).includes(KEY), 'the key never goes back to the UI')

    ui.send({ type: 'account.delete', accountId: work.id })
    await ui.next('accounts', (m) => !m.accounts.some((a) => a.id === work.id) && m.accounts.length === 6)
    await new Promise((r) => setTimeout(r, 200))
    assert.ok(ran.some((c) => c.endsWith('codex logout') && c.includes(work.id)))
    assert.ok(!existsSync(join(dataDir, 'accounts', work.id)))
    ui.send({ type: 'account.delete', accountId: 'claude' })
    assert.match((await ui.next('error')).message, /não podem ser removidas/)
  } finally {
    process.env.CLAUDE_CONFIG_DIR = HOMES.claude
    process.env.CODEX_HOME = HOMES.codex
    ui.ws.close()
    await server.close()
  }
})
