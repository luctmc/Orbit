import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { startServer } from '../src/server.ts'
import { seedCatalog } from './catalogFixture.ts'
import { DEFAULT_ROUTING } from '../src/routing.ts'
import type { AgentLaunch } from '../src/command.ts'
import { offline, TOKEN, ORIGIN, seedRoutingQuota } from './helpers.ts'

const coordination = ['activity_status', 'agent_list', 'agent_read', 'agent_send', 'context_read', 'delivery_ack', 'delivery_status', 'handoff_submit', 'mission_status', 'model_catalog', 'project_memory', 'skill_catalog', 'skill_load', 'whoami'].sort()
const verification = ['result_inspect', 'verification_status', 'verification_submit']
const reviewIds = ['revisao', 'revisor', 'verificador', 'qa', 'seguranca', 'performance', 'qualidade']
const shared = ['board_add', 'board_list', 'board_update', 'browser_click', 'browser_console', 'browser_key', 'browser_open', 'browser_screenshot', 'browser_scroll', 'browser_text', 'browser_type'].sort()
const leader = ['accounts_status', 'activity_status', 'agent_close', 'agent_interrupt', 'agent_list', 'agent_read', 'agent_resume', 'agent_send', 'agent_spawn', 'agent_spawn_many', 'ask_user', ...shared, 'context_read', 'delivery_ack', 'delivery_status', 'handoff_list', 'mission_briefing', 'mission_note', 'mission_ready', 'mission_status', 'model_catalog', 'project_memory', 'project_note', 'result_inspect', 'routing_propose', 'skill_catalog', 'skill_load', 'verification_status', 'verification_submit', 'whoami'].sort()

async function fixture(options: { lead?: boolean; kind?: string; role?: string }, body: (client: Client, role: string, server: Awaited<ReturnType<typeof startServer>>, launches: AgentLaunch[]) => Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), 'orbit-tool-groups-'))
  const launches: AgentLaunch[] = []
  const server = await startServer({ port: 0, token: TOKEN, allowedOrigins: [ORIGIN], dataDir: join(root, 'data'),
    shell: '/bin/sh', browser: null, run: offline, scheduler: false,
    agentCommand: launch => { launches.push(launch); return { file: '/bin/sh', args: ['-c', 'while read line; do :; done'] } },
  })
  const client = new Client({ name: 'tool-groups', version: '1' })
  try {
    await server.initialized
    const core = server.core
    seedCatalog(core)
    await core.handle({ type: 'workspace.open', path: root })
    if (options.kind) await core.handle({ type: 'routing.save', routing: { ...DEFAULT_ROUTING, taskTypes: [
      ...DEFAULT_ROUTING.taskTypes.filter(t => t.id !== options.kind), { ...DEFAULT_ROUTING.taskTypes[0]!, id: options.kind, name: 'Tipo com nome personalizado', model: 'claude-opus-5-5', effort: 'medium', method: '' },
    ] } })
    if (options.role) await core.handle({ type: 'squad.save', squad: { id: 'tools', name: 'Tools', description: '', playbook: 'Execute a tarefa.',
      lead: { cli: 'claude', model: null }, roles: [{ id: options.role, name: 'Papel com nome personalizado', cli: 'claude', model: null, brief: 'Execute a tarefa.', skills: [], onlySkills: false }],
    } })
    await core.handle({ type: 'mission.create', workspaceId: core.store.snapshot().workspaces[0]!.id, title: 'Groups', objective: '', allowOriginal: true,
      mode: options.role ? 'squad' : 'agentica', ...(options.role ? { squadId: core.store.squads().find(s => s.name === 'Tools')!.id } : {}), lead: { cli: 'claude', model: null, title: 'Líder' } })
    const mission = core.store.snapshot().missions[0]!
    // Um quadro existente não deve aumentar o catálogo de um executor comum.
    await core.handle({ type: 'card.add', missionId: mission.id, title: 'Tarefa' })
    if (!options.lead) await core.handle({ type: 'pane.spawn', request: { missionId: mission.id, role: 'crew', cli: 'claude', model: null, title: 'Helper',
      ...(options.kind ? { taskTypeId: options.kind } : {}), ...(options.role ? { squadRoleId: options.role } : {}),
    } })
    const launch = launches.at(-1)!
    const config = JSON.parse(readFileSync(launch.mcpConfigPath!, 'utf8'))
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.port}/mcp`), { requestInit: { headers: config.mcpServers.orbit.headers } }))
    await body(client, readFileSync(launch.rolePromptPath!, 'utf8'), server, launches)
  } finally { await client.close(); await server.close(); rmSync(root, { recursive: true, force: true }) }
}

test('helper padrão preserva coordenação e entrega sem board/browser/verification mesmo com quadro', async () => {
  await fixture({}, async (client, role) => {
    const tools = (await client.listTools()).tools
    assert.deepEqual(tools.map(t => t.name).sort(), coordination)
    assert.equal(tools.length, 14)
    assert.ok(Buffer.byteLength(JSON.stringify(tools)) < 15502)
    assert.doesNotMatch(role, /browser_open|board_update/)
    assert.match(role, /agent_send.*handoff_submit.*blocked/)
    const identity = await client.callTool({ name: 'whoami', arguments: {} })
    assert.equal(identity.isError, undefined)
  })
})

test('tools ausentes retornam erro MCP explícito sem executar board/browser/verification', async () => {
  await fixture({}, async client => {
    for (const name of ['board_list', 'browser_open', ...verification]) {
      const result = await client.callTool({ name, arguments: name === 'browser_open' ? { url: 'https://example.com' } : {} })
      assert.equal(result.isError, true)
      assert.match(JSON.stringify(result.content), new RegExp(`Tool ${name} not found`))
    }
  })
})

test('líder mantém catálogo completo e acesso ao quadro', async () => {
  await fixture({ lead: true }, async client => {
    const tools = (await client.listTools()).tools
    assert.deepEqual(tools.map(t => t.name).sort(), leader)
    assert.equal(tools.length, 40)
    assert.equal(Buffer.byteLength(JSON.stringify(tools)), 27000)
    assert.equal((await client.callTool({ name: 'board_list', arguments: {} })).isError, undefined)
  })
})

for (const kind of ['frontend', 'design', 'qa', 'browser', 'navegador', 'board', 'quadro', 'verificador']) {
  test(`helper qualificado por taskTypeId=${kind} mantém board/browser`, async () => {
    await fixture({ kind }, async (client, role) => {
      assert.deepEqual((await client.listTools()).tools.map(t => t.name).sort(), [...coordination, ...shared, ...(['qa', 'verificador'].includes(kind) ? verification : [])].sort())
      assert.match(role, /browser_open/)
      assert.match(role, /board_update/)
      assert.equal((await client.callTool({ name: 'board_list', arguments: {} })).isError, undefined)
      const result = await client.callTool({ name: 'browser_text', arguments: {} })
      assert.doesNotMatch(JSON.stringify(result.content), /not found/)
    })
  })
}

test('helper qualificado por squadRoleId mantém grupos mesmo com nome personalizado', async () => {
  await fixture({ role: 'qa' }, async (client, role) => {
    assert.deepEqual((await client.listTools()).tools.map(t => t.name).sort(), [...coordination, ...shared, ...verification].sort())
    assert.match(role, /browser_open/)
    assert.match(role, /board_update/)
  })
})

test('IDs com prefixo semelhante não qualificam o helper', async () => {
  await fixture({ kind: 'qa-backend' }, async (client, role) => {
    assert.deepEqual((await client.listTools()).tools.map(t => t.name).sort(), coordination)
    assert.doesNotMatch(role, /browser_open|board_update/)
  })
})

for (const id of reviewIds) {
  for (const signal of ['kind', 'role'] as const) {
    test(`helper revisor por ${signal}=${id} preserva verification com nome personalizado`, async () => {
      await fixture({ [signal]: id }, async client => {
        const names = (await client.listTools()).tools.map(t => t.name)
        for (const name of verification) assert.ok(names.includes(name), name)
        const result = await client.callTool({ name: 'verification_status', arguments: {} })
        assert.notEqual(result.isError, true)
      })
    })
  }
}

for (const signal of ['kind', 'role'] as const) {
  test(`ID ${signal}=revisao-x não recebe verification`, async () => {
    await fixture({ [signal]: 'revisao-x' }, async client => {
      assert.deepEqual((await client.listTools()).tools.map(t => t.name).sort(), coordination)
    })
  })
}

test('líder abre revisor qualificado via MCP e o revisor inspeciona e aceita resultado', async () => {
  await fixture({ lead: true }, async (lead, _role, server, launches) => {
    await seedRoutingQuota(server.core)
    const clients: Client[] = []
    const textOf = (result: unknown) => (result as { content: Array<{ text: string }> }).content[0]!.text
    const call = async (client: Client, name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: args })
      assert.notEqual(result.isError, true, textOf(result))
      return textOf(result)
    }
    const spawn = async (kind: string, task: string) => {
      await call(lead, 'agent_spawn', { title: kind, kind, task, agent: 'claude', model: 'claude-sonnet-5-5' })
      const launch = launches.at(-1)!
      const config = JSON.parse(readFileSync(launch.mcpConfigPath!, 'utf8'))
      const client = new Client({ name: kind, version: '1' })
      clients.push(client)
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.port}/mcp`), { requestInit: { headers: config.mcpServers.orbit.headers } }))
      return client
    }
    try {
      const worker = await spawn('investigacao', 'Leia o projeto sem editar; entregue observação sintética.')
      await call(worker, 'handoff_submit', { summary: 'Leitura sintética concluída', evidence: 'Observação da fixture MCP' })
      const missionId = server.core.store.snapshot().missions[0]!.id
      const resultId = server.core.store.activityHistory(missionId).results.at(-1)!.id
      const reviewer = await spawn('revisao', `Revise o resultado ${resultId} sem editar.`)
      const inspection = JSON.parse(await call(reviewer, 'result_inspect', { resultId }))
      const record = JSON.parse(await call(reviewer, 'verification_submit', {
        inspectionId: inspection.id, verdict: 'accepted', summary: 'Contrato sintético conferido',
        checks: [{ command: 'observação sintética MCP', exitCode: 0, summary: 'Fluxo conferido' }],
        criteria: inspection.acceptance.map((_: string, i: number) => ({ item: i + 1, met: true, how: 'Observação sintética' })),
      }))
      assert.equal(record.verdict, 'accepted')
      assert.equal(server.core.store.verifications(missionId).at(-1)!.id, record.id)
    } finally { for (const client of clients) await client.close() }
  })
})
