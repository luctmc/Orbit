import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { SquadInput } from '@orbit/protocol'
import { BUILTIN_SQUADS, normalizeSquad } from '../src/squads.ts'
import { startServer } from '../src/server.ts'
import type { AgentLaunch } from '../src/command.ts'
import { connect, ORIGIN, TOKEN } from './helpers.ts'

const custom = (patch: Partial<SquadInput> = {}): SquadInput => ({
  id: '',
  name: 'Revisão rápida',
  description: 'Um revisor só',
  lead: { cli: 'claude', model: 'claude-sonnet-5-5' },
  playbook: '1. Abra o Revisor.',
  roles: [{ id: 'revisor', name: 'Revisor', cli: 'claude', model: null, brief: 'Revise sem editar.' }],
  ...patch,
})

test('builtin squads are valid and have unique role ids', () => {
  assert.equal(BUILTIN_SQUADS.length, 3)
  for (const squad of BUILTIN_SQUADS) {
    const again = normalizeSquad(squad, new Set())
    assert.deepEqual(again.roles.map((r) => r.id), squad.roles.map((r) => r.id))
  }
})

test('squad validation rejects what would break a mission', () => {
  assert.throws(() => normalizeSquad(custom({ name: ' ' }), new Set()), /nome/)
  assert.throws(() => normalizeSquad(custom({ roles: [] }), new Set()), /pelo menos um papel/)
  assert.throws(() => normalizeSquad(custom({ playbook: '' }), new Set()), /roteiro/)
  const bad = custom({ roles: [{ id: 'x', name: 'X', cli: 'claude', model: 'opus; rm -rf ~', brief: 'b' }] })
  assert.throws(() => normalizeSquad(bad, new Set()), /modelo inválido/)
  const dup = custom({ roles: [{ id: 'a', name: 'A', cli: 'claude', model: null, brief: 'b' }, { id: 'a', name: 'B', cli: 'codex', model: null, brief: 'b' }] })
  assert.throws(() => normalizeSquad(dup, new Set()), /mesmo identificador/)
})

test('saving keeps the id of an existing custom squad; duplicating a builtin gets a new one', () => {
  const created = normalizeSquad(custom(), new Set())
  assert.match(created.id, /^revisao-rapida-[0-9a-f]{4}$/)
  assert.equal(normalizeSquad(custom({ id: created.id }), new Set([created.id])).id, created.id)
  const copy = normalizeSquad({ ...BUILTIN_SQUADS[0]! }, new Set())
  assert.notEqual(copy.id, BUILTIN_SQUADS[0]!.id)
  assert.equal(copy.builtin, false)
})

/** Stands in for the agent CLIs: a shell that prints what would have been launched. */
const fakeAgent = (launch: AgentLaunch, shell: string) => ({ file: shell, args: ['-c', `echo "FAKE ${launch.cli} ${launch.model ?? '-'}"; exec ${shell}`] })

test('a squad mission briefs the lead with the script and opens helpers by role', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'orbit-data-'))
  const server = await startServer({ port: 0, token: TOKEN, allowedOrigins: [ORIGIN], dataDir, shell: '/bin/sh', agentCommand: fakeAgent })
  const ui = connect(server.port)
  let mcp: Client | undefined
  try {
    await ui.opened
    const { snapshot } = await ui.next('snapshot')
    assert.deepEqual(snapshot.squads.map((s) => s.id), ['caca-bugs', 'funcionalidade', 'auditoria'])

    // Custom squads round-trip; builtins are protected.
    ui.send({ type: 'squad.save', squad: custom() })
    const { squad: saved } = await ui.next('squad.updated')
    ui.send({ type: 'squad.delete', squadId: 'caca-bugs' })
    assert.match((await ui.next('error')).message, /não podem ser apagados/)
    ui.send({ type: 'squad.delete', squadId: saved.id })
    await ui.next('squad.removed', (m) => m.squadId === saved.id)

    ui.send({ type: 'workspace.open', path: realpathSync(mkdtempSync(join(tmpdir(), 'orbit-ws-'))) })
    const { workspace } = await ui.next('workspace.updated')
    ui.send({ type: 'mission.create', workspaceId: workspace.id, title: 'Sem squad', objective: '', mode: 'squad', lead: { cli: 'claude', model: null, title: '' } })
    assert.match((await ui.next('error', (m) => /squad/.test(m.message))).message, /Escolha um squad/)

    ui.send({ type: 'mission.create', workspaceId: workspace.id, title: 'Bug do login', objective: 'O login falha com senha válida', mode: 'squad', squadId: 'caca-bugs', lead: { cli: 'claude', model: 'claude-opus-5-5', title: '' } })
    const { mission } = await ui.next('mission.updated', (m) => m.mission.title === 'Bug do login')
    assert.equal(mission.squadId, 'caca-bugs')
    const { pane: lead } = await ui.next('pane.updated', (m) => m.pane.missionId === mission.id && m.pane.role === 'lead')
    const leadRole = readFileSync(join(dataDir, 'panes', String(lead.id), 'role.md'), 'utf8')
    assert.match(leadRole, /squad "Caça-bugs"/)
    assert.match(leadRole, /Abra o Batedor com o relato do bug/)
    assert.match(readFileSync(join(dataDir, 'panes', String(lead.id), 'task.md'), 'utf8'), /O login falha/)

    ui.send({ type: 'pane.input', paneId: lead.id, data: 'echo "TOKEN:$ORBIT_PANE_TOKEN:"\r' })
    const token = /TOKEN:([\w-]{20,}):/.exec((await ui.next('pane.data', (m) => m.paneId === lead.id && /TOKEN:[\w-]{20,}:/.test(m.data))).data)![1]!

    mcp = new Client({ name: 'test', version: '0' })
    await mcp.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }))
    const spawn = (await mcp.listTools()).tools.find((t) => t.name === 'agent_spawn')!
    assert.deepEqual((spawn.inputSchema.properties as Record<string, { enum?: string[] }>).role?.enum, ['batedor', 'construtor', 'revisor'])

    const result = await mcp.callTool({ name: 'agent_spawn', arguments: { role: 'revisor', task: 'Revise src/login.ts' } })
    assert.match((result.content as Array<{ text: string }>)[0]!.text, /^Revisor #\d+ aberto/)
    const { pane: reviewer } = await ui.next('pane.updated', (m) => m.pane.squadRole === 'Revisor')
    assert.equal(reviewer.title, 'Revisor')
    assert.equal(reviewer.model, 'claude-opus-5-5', 'the role decides the model')
    await ui.next('pane.data', (m) => m.paneId === reviewer.id && m.data.includes('FAKE claude claude-opus-5-5'))
    const crewRole = readFileSync(join(dataDir, 'panes', String(reviewer.id), 'role.md'), 'utf8')
    assert.match(crewRole, /Você é o Revisor/)
    assert.match(crewRole, /Você revisa a mudança do Construtor sem editar nada/)

    const unknown = await mcp.callTool({ name: 'agent_spawn', arguments: { role: 'astronauta', task: 'x' } })
    assert.equal(unknown.isError, true)
  } finally {
    await mcp?.close()
    ui.ws.close()
    await server.close()
  }
})
