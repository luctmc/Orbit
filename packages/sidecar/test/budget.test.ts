import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentLaunch } from '../src/command.ts'
import { startServer } from '../src/server.ts'
import { connect, offline, ORIGIN, TOKEN } from './helpers.ts'

const status = (input: number) => ({ model: { display_name: 'Opus' }, cost: { total_cost_usd: input / 100_000 }, context_window: { total_input_tokens: input, total_output_tokens: 0, used_percentage: 5 }, orbit_session_usage: { format: 'claude-transcript-v1', input: input, output: 0, cacheRead: 0, cacheWrite: 0, total: input + 0 } })

test('a mission budget warns at 80%, keeps agents and tools running at 100% and resets warnings when raised; usage goes to the ledger', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'orbit-data-'))
  const fake = (_launch: AgentLaunch, shell: string) => ({ file: shell, args: ['-c', `exec ${shell}`] })
  const server = await startServer({ port: 0, token: TOKEN, allowedOrigins: [ORIGIN], dataDir, shell: '/bin/sh', run: offline, agentCommand: fake, browser: null, scheduler: false })
  const ui = connect(server.port)
  try {
    await ui.opened
    ui.send({ type: 'workspace.open', path: realpathSync(mkdtempSync(join(tmpdir(), 'orbit-ws-'))) })
    const { workspace } = await ui.next('workspace.updated')
    ui.send({ type: 'mission.create', workspaceId: workspace.id, title: 'Com limite', objective: '', mode: 'livre', lead: { cli: 'claude', model: 'opus', title: '' }, budget: { tokens: 50_000, costUsd: null } })
    const { mission } = await ui.next('mission.updated')
    assert.deepEqual(mission.budget, { tokens: 50_000, costUsd: null, warned: false, exceeded: false })
    const { pane } = await ui.next('pane.updated', (m) => m.pane.role === 'lead')
    ui.send({ type: 'pane.input', paneId: pane.id, data: 'echo "TOKEN:$ORBIT_PANE_TOKEN:"\r' })
    const token = /TOKEN:([\w-]{20,}):/.exec((await ui.next('pane.data', (m) => m.paneId === pane.id && /TOKEN:[\w-]{20,}:/.test(m.data))).data)![1]!
    const post = (path: string, body: object) => fetch(`http://127.0.0.1:${server.port}${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const tool = { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } }

    await post('/status', status(41_000))
    await ui.next('event.added', (m) => m.event.kind === 'budget' && m.event.title === 'Orçamento em 82%')
    assert.equal((await post('/hooks', tool)).status, 204, 'still working under the limit')

    const before = server.core.store.pane(pane.id)!
    const terminalWrites: string[] = []
    const terminals = (server.core as any).panes
    const originalWrite = terminals.write.bind(terminals)
    terminals.write = (id: number, data: string) => { terminalWrites.push(data); return originalWrite(id, data) }
    await post('/status', status(60_000))
    await ui.next('event.added', (m) => m.event.title === 'Orçamento atingido' && /continuam/.test(m.event.body))
    await ui.next('mission.updated', (m) => m.mission.budget?.exceeded === true)
    assert.notEqual(server.core.store.pane(pane.id)!.status, 'exited', 'budget must not end a live execution')
    assert.equal(server.core.store.pane(pane.id)!.pid, before.pid)
    assert.equal(server.core.store.pane(pane.id)!.executionEpoch, before.executionEpoch)
    assert.ok(!terminalWrites.includes('\x1b'), 'no escape is injected into existing work')
    const refused = await post('/hooks', tool)
    assert.equal(refused.status, 204, 'existing execution keeps native tool permissions')
    ui.send({ type: 'pane.spawn', request: { missionId: mission.id, role: 'crew', cli: 'claude', model: 'opus', title: 'mais um' } })
    const second = (await ui.next('pane.updated', m => m.pane.title === 'mais um')).pane
    assert.ok(second.pid)
    assert.equal(server.core.liveTerminalCount(), 2)
    assert.equal(server.core.store.pane(pane.id)!.pid, before.pid)

    // Raising it resets the warning; existing executions never lost their permissions.
    ui.send({ type: 'mission.budget', missionId: mission.id, tokens: 200_000, costUsd: null })
    const raised = await ui.next('mission.updated', (m) => m.mission.budget?.tokens === 200_000)
    assert.deepEqual([raised.mission.budget!.warned, raised.mission.budget!.exceeded], [false, false])
    assert.equal((await post('/hooks', tool)).status, 204)

    ui.send({ type: 'mission.budget', missionId: mission.id, tokens: null, costUsd: null })
    await ui.next('mission.updated', (m) => m.mission.id === mission.id && m.mission.budget === null)

    // The ledger has the day, the mission and the agent's setup.
    ui.send({ type: 'ledger.get', month: new Date().toISOString().slice(0, 7) })
    const { entries } = await ui.next('ledger')
    assert.deepEqual(entries.map((e) => [e.missionId, e.cli, e.model, e.tokens]), [[mission.id, 'claude', 'opus', 60_000]])
    assert.equal(entries[0]!.costUsd, 0.6)
  } finally {
    ui.ws.close()
    await server.close()
  }
})
