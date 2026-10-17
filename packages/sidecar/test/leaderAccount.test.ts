import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startServer } from '../src/server.ts'
import { Store } from '../src/store.ts'
import { normalizeRouting } from '../src/routing.ts'
import { accountRooms, chooseAccount } from '../src/maestro.ts'
import { BUILTIN_ACCOUNTS } from '../src/accounts.ts'
import { connect, ORIGIN, TOKEN, seedRoutingQuota } from './helpers.ts'

test('95% weekly use is available; windows and accounts never borrow another account quota', () => {
  const now = Date.now()
  const accounts = [BUILTIN_ACCOUNTS[0]!, { ...BUILTIN_ACCOUNTS[0]!, id: 'claude-other', builtin: false }]
  const rooms = accountRooms('claude', accounts, [], [{ accountId: 'claude', cli: 'claude', source: 'provider', updatedAt: now, plan: null, fiveHour: { usedPercent: 0, resetsAt: now + 3600000, windowMinutes: 300 }, weekly: { usedPercent: 95, resetsAt: now + 45.75 * 3600000, windowMinutes: 10080 } }], new Map(), now)
  assert.equal(rooms[0]!.full, false, '5% remains; do not claim the provider is exhausted')
  assert.equal(rooms[1]!.used, null, 'missing reading is unknown, never zero or another account use')
  assert.equal(chooseAccount(rooms).backAt, null)
})

test('leader CLI, model and account persist and reach the real launcher; adaptation never replaces CLI/account', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'orbit-leader-'))
  const launched: string[] = []
  const server = await startServer({ port: 0, token: TOKEN, allowedOrigins: [ORIGIN], dataDir, shell: '/bin/sh', browser: null, scheduler: false,
    run: async () => ({ code: 127, stdout: '', stderr: 'offline' }),
    agentCommand: (launch, shell) => { launched.push(launch.cli); return { file: shell, args: ['-c', `printf 'ACCOUNT_HOME:%s:END\\n' "$CODEX_HOME"; exec ${shell}`] } } })
  const ui = connect(server.port)
  try {
    await ui.opened
    ui.send({ type: 'account.save', account: { cli: 'codex', name: 'Codex 2', kind: 'assinatura', auto: false } })
    const selected = (await ui.next('accounts', m => m.accounts.some(a => a.name === 'Codex 2'))).accounts.find(a => a.name === 'Codex 2')!
    await seedRoutingQuota(server.core)
    const routing = server.core.store.routing()
    const saved = normalizeRouting({ ...routing, lead: { cli: 'codex', model: 'gpt-6.1-sol', effort: 'medium', accountId: selected.id } })
    server.core.store.saveRouting(saved)
    server.core.store.flush()
    assert.equal(new Store(dataDir).routing().lead.accountId, selected.id)
    ui.send({ type: 'workspace.open', path: realpathSync(mkdtempSync(join(tmpdir(), 'orbit-leader-ws-'))) })
    const { workspace } = await ui.next('workspace.updated')
    // A global default must never overwrite the user's per-mission choice.
    server.core.store.saveRouting({ ...server.core.store.routing(), lead: { cli: 'claude', model: 'claude-opus-5-5', effort: 'high' } })
    for (const adaptiveLead of [false, true]) {
      ui.send({ type: 'mission.create', allowOriginal: true, workspaceId: workspace.id, title: `Leader ${adaptiveLead}`, objective: '', mode: 'agentica', adaptiveLead,
        lead: { cli: 'codex', model: 'gpt-6.1-sol', effort: 'medium', accountId: selected.id, title: '' } })
      const mission = (await ui.next('mission.updated', m => m.mission.title === `Leader ${adaptiveLead}`)).mission
      const pane = (await ui.next('pane.updated', m => m.pane.missionId === mission.id && m.pane.role === 'lead')).pane
      assert.equal(pane.cli, 'codex')
      assert.equal(pane.accountId, selected.id)
      if (!adaptiveLead) assert.deepEqual([pane.model, pane.effort], ['gpt-6.1-sol', 'medium'])
      const output = await ui.next('pane.data', m => m.paneId === pane.id && m.data.includes('ACCOUNT_HOME:'))
      assert.ok(output.data.includes(join(dataDir, 'accounts', selected.id, 'codex')), 'actual process uses selected account environment')
    }
    assert.deepEqual(launched, ['codex', 'codex'])
  } finally { ui.ws.close(); await server.close() }
})
