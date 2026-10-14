import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { startServer } from '../src/server.ts'
import { connect, ORIGIN, TOKEN, offline } from './helpers.ts'

async function mcpClient(port: number, token: string) {
  const client = new Client({ name: 'test', version: '0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  }))
  return client
}

const textOf = (result: unknown) => ((result as { content: Array<{ text: string }> }).content[0]?.text ?? '')

test('lead and helper coordinate through MCP, handoffs and hooks', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'orbit-data-'))
  const server = await startServer({ port: 0, token: TOKEN, allowedOrigins: [ORIGIN], dataDir, shell: '/bin/sh', run: offline })
  const ui = connect(server.port)
  const clients: Client[] = []
  try {
    await ui.opened
    await ui.next('snapshot')
    ui.send({ type: 'workspace.open', path: realpathSync(mkdtempSync(join(tmpdir(), 'orbit-ws-'))) })
    const { workspace } = await ui.next('workspace.updated')
    ui.send({ type: 'mission.create', workspaceId: workspace.id, title: 'Coordenação', objective: '', mode: 'agentica', lead: { cli: 'shell', model: null, title: 'Líder' } })
    const { mission } = await ui.next('mission.updated')
    const { pane: lead } = await ui.next('pane.updated', (m) => m.pane.role === 'lead')
    ui.send({ type: 'pane.spawn', request: { missionId: mission.id, role: 'crew', cli: 'shell', model: null, title: 'Testes' } })
    const { pane: crew } = await ui.next('pane.updated', (m) => m.pane.role === 'crew')

    // Each pane's token is only in its own environment.
    const tokenOf = async (paneId: number) => {
      ui.send({ type: 'pane.input', paneId, data: 'echo "TOKEN:$ORBIT_PANE_TOKEN:"\r' })
      const { data } = await ui.next('pane.data', (m) => m.paneId === paneId && /TOKEN:[\w-]{20,}:/.test(m.data))
      return /TOKEN:([\w-]{20,}):/.exec(data)![1]!
    }
    const leadToken = await tokenOf(lead.id)
    const crewToken = await tokenOf(crew.id)
    assert.notEqual(leadToken, crewToken)

    const leadMcp = await mcpClient(server.port, leadToken)
    const crewMcp = await mcpClient(server.port, crewToken)
    clients.push(leadMcp, crewMcp)

    const leadTools = (await leadMcp.listTools()).tools.map((t) => t.name).sort()
    assert.deepEqual(leadTools, ['accounts_status', 'agent_close', 'agent_list', 'agent_read', 'agent_send', 'agent_spawn', 'agent_spawn_many', 'board_add', 'board_list', 'board_update', 'browser_click', 'browser_console', 'browser_key', 'browser_open', 'browser_screenshot', 'browser_scroll', 'browser_text', 'browser_type', 'handoff_list', 'mission_status', 'whoami'])
    const crewTools = (await crewMcp.listTools()).tools.map((t) => t.name).sort()
    assert.ok(crewTools.includes('handoff_submit') && !crewTools.includes('agent_spawn'))

    const whoami = JSON.parse(textOf(await crewMcp.callTool({ name: 'whoami', arguments: {} })))
    assert.equal(whoami.agent.id, crew.id)
    assert.equal(whoami.mission.title, 'Coordenação')

    // The lead reads the helper's screen.
    ui.send({ type: 'pane.input', paneId: crew.id, data: 'echo tela-do-ajudante\r' })
    await ui.next('pane.data', (m) => m.paneId === crew.id && m.data.includes('tela-do-ajudante'))
    await new Promise((r) => setTimeout(r, 100))
    assert.match(textOf(await leadMcp.callTool({ name: 'agent_read', arguments: { agent: crew.id } })), /tela-do-ajudante/)

    // The helper hands off; the lead's terminal receives it and the flow records it.
    const result = await crewMcp.callTool({ name: 'handoff_submit', arguments: { summary: 'testes passando', details: '12 ok' } })
    assert.match(textOf(result), new RegExp(`líder #${lead.id}`))
    await ui.next('event.added', (m) => m.event.kind === 'handoff' && m.event.paneId === crew.id)
    await ui.next('pane.data', (m) => m.paneId === lead.id && m.data.includes(`[Orbit] Retorno de #${crew.id}`))
    const handoffs = JSON.parse(textOf(await leadMcp.callTool({ name: 'handoff_list', arguments: {} })))
    assert.equal(handoffs[0].text, 'testes passando\n\n12 ok')

    // A pane from another mission is out of reach.
    const denied = await leadMcp.callTool({ name: 'agent_read', arguments: { agent: 9999 } })
    assert.equal(denied.isError, true)

    // Hooks move the status and log when the agent needs the human.
    const hook = (token: string, body: object, headers: Record<string, string> = {}) =>
      fetch(`http://127.0.0.1:${server.port}/hooks`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
    assert.equal((await hook(crewToken, { hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Precisa aprovar Bash' })).status, 204)
    await ui.next('pane.updated', (m) => m.pane.id === crew.id && m.pane.status === 'waiting' && m.pane.attention === 'Precisa aprovar Bash')
    await ui.next('event.added', (m) => m.event.kind === 'pane.waiting' && m.event.paneId === crew.id)

    assert.equal((await hook('nope', {})).status, 401)
    assert.equal((await hook(crewToken, {}, { origin: 'https://evil.example' })).status, 403)

    // The lead closes the helper; its token stops working.
    assert.match(textOf(await leadMcp.callTool({ name: 'agent_close', arguments: { agent: crew.id } })), /fechado/)
    await ui.next('pane.removed', (m) => m.paneId === crew.id)
    assert.equal((await hook(crewToken, { hook_event_name: 'Stop' })).status, 401)
  } finally {
    for (const client of clients) await client.close()
    ui.ws.close()
    await server.close()
  }
})
