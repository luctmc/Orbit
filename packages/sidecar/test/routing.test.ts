import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Routing } from '@orbit/protocol'
import { DEFAULT_ROUTING, normalizeRouting } from '../src/routing.ts'
import { startServer } from '../src/server.ts'
import type { AgentLaunch } from '../src/command.ts'
import { connect, ORIGIN, TOKEN, offline } from './helpers.ts'

test('the default table is valid', () => {
  assert.deepEqual(normalizeRouting(DEFAULT_ROUTING), DEFAULT_ROUTING)
})

test('table validation rejects what would break a spawn', () => {
  const base = structuredClone(DEFAULT_ROUTING)
  assert.throws(() => normalizeRouting({ ...base, taskTypes: [] }), /pelo menos um tipo/)
  assert.throws(() => normalizeRouting({ ...base, taskTypes: [{ ...base.taskTypes[0]!, model: 'x; rm -rf ~' }] }), /modelo inválido/)
  assert.throws(() => normalizeRouting({ ...base, taskTypes: [{ ...base.taskTypes[0]!, effort: 'turbo' as never }] }), /esforço inválido/)
  assert.throws(() => normalizeRouting({ ...base, taskTypes: [base.taskTypes[0]!, { ...base.taskTypes[1]!, id: base.taskTypes[0]!.id }] }), /mesmo identificador/)
  const unnamedId = normalizeRouting({ ...base, taskTypes: [{ ...base.taskTypes[0]!, id: '', name: 'Revisão de PR' }] })
  assert.equal(unnamedId.taskTypes[0]!.id, 'revisao-de-pr')
})

const fakeAgent = (launch: AgentLaunch, shell: string) => ({ file: shell, args: ['-c', `echo "FAKE ${launch.cli} ${launch.model ?? '-'} ${launch.effort ?? '-'}"; exec ${shell}`] })

test('an agentic lead routes helpers through the table; the table is saved and reset from the UI', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'orbit-data-'))
  const server = await startServer({ port: 0, token: TOKEN, allowedOrigins: [ORIGIN], dataDir, shell: '/bin/sh', run: offline, agentCommand: fakeAgent })
  const ui = connect(server.port)
  let mcp: Client | undefined
  try {
    await ui.opened
    const { snapshot } = await ui.next('snapshot')
    assert.deepEqual({ ...snapshot.routing, revision: undefined }, { ...DEFAULT_ROUTING, revision: undefined })
    assert.match(snapshot.routing.revision!, /^[a-f0-9]{64}$/)

    // The user tweaks the table: tests go to Codex with high effort and a skill.
    const edited: Routing = structuredClone(DEFAULT_ROUTING)
    Object.assign(edited.taskTypes.find((t) => t.id === 'testes')!, { cli: 'codex', automatic: false, model: 'gpt-6.1', effort: 'high', skills: ['prova-antes'] })
    ui.send({ type: 'routing.save', routing: edited })
    const { routing } = await ui.next('routing.updated')
    assert.equal(routing.taskTypes.find((t) => t.id === 'testes')!.cli, 'codex')

    ui.send({ type: 'workspace.open', path: realpathSync(mkdtempSync(join(tmpdir(), 'orbit-ws-'))) })
    const { workspace } = await ui.next('workspace.updated')
    ui.send({ type: 'mission.create', allowOriginal: true, workspaceId: workspace.id, title: 'Login', objective: 'Arrumar o login', mode: 'agentica', lead: { cli: 'claude', model: 'claude-opus-5-5', title: '', effort: 'high' } })
    const { pane: lead } = await ui.next('pane.updated', (m) => m.pane.role === 'lead')
    assert.equal(lead.effort, 'high')
    const leadRole = readFileSync(join(dataDir, 'panes', String(lead.id), 'role.md'), 'utf8')
    assert.match(leadRole, /pass kind = the table type/)
    assert.match(leadRole, /kind "testes" \(Testes\).*Codex, gpt-6\.1, high effort/)

    ui.send({ type: 'pane.input', paneId: lead.id, data: 'echo "TOKEN:$ORBIT_PANE_TOKEN:"\r' })
    const token = /TOKEN:([\w-]{20,}):/.exec((await ui.next('pane.data', (m) => m.paneId === lead.id && /TOKEN:[\w-]{20,}:/.test(m.data))).data)![1]!
    mcp = new Client({ name: 'test', version: '0' })
    await mcp.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }))
    const spawn = (await mcp.listTools()).tools.find((t) => t.name === 'agent_spawn')!
    const props = spawn.inputSchema.properties as Record<string, { enum?: string[] }>
    assert.ok(props.kind?.enum?.includes('testes'))
    assert.equal(props.role, undefined, 'no squad, no roles')

    const result = await mcp.callTool({ name: 'agent_spawn', arguments: { kind: 'testes', task: 'Cubra o login com testes' } })
    const receipt = (result.content as Array<{ text: string }>)[0]!.text
    assert.match(receipt, /^Aberto:\n#\d+ Testes\n  ▸ tipo: Testes \(escolhido pelo líder\)\n  ▸ conta: Codex deste Mac|conta deste Mac/)
    assert.match(receipt, /▸ abriu: Codex · gpt-6\.1 · esforço alto/)
    const { pane: helper } = await ui.next('pane.updated', (m) => m.pane.taskType === 'Testes')
    assert.deepEqual([helper.cli, helper.model, helper.effort], ['codex', 'gpt-6.1', 'high'])
    await ui.next('pane.data', (m) => m.paneId === helper.id && m.data.includes('FAKE codex gpt-6.1 high'))
    const crewRole = readFileSync(join(dataDir, 'panes', String(helper.id), 'role.md'), 'utf8')
    assert.match(crewRole, /Kind of work: Testes/)
    assert.match(crewRole, /skills .*: prova-antes/)

    ui.send({ type: 'routing.reset' })
    const { routing: reset } = await ui.next('routing.updated', (m) => m.routing.taskTypes.find((t) => t.id === 'testes')!.model === 'gpt-6.1-sol')
    assert.deepEqual({ ...reset, revision: undefined }, { ...DEFAULT_ROUTING, revision: undefined })
  } finally {
    await mcp?.close()
    ui.ws.close()
    await server.close()
  }
})
