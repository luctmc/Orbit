import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { startServer } from '../src/server.ts'
import { connect, ORIGIN, TOKEN, offline } from './helpers.ts'
import type { AgentLaunch } from '../src/command.ts'
import type { EventEmitter } from 'node:events'

async function mcpClient(port: number, token: string) {
  const client = new Client({ name: 'test', version: '0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  }))
  return client
}

const textOf = (result: unknown) => ((result as { content: Array<{ text: string }> }).content[0]?.text ?? '')

test('lead and helper coordinate through MCP, handoffs and hooks', async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'orbit-data-'))
  const server = await startServer({ port: 0, token: TOKEN, allowedOrigins: [ORIGIN], dataDir, shell: '/bin/sh', run: offline })
  const ui = connect(server.port)
  const paneText = (paneId: number) => ui.inbox.flatMap(m => m.type === 'pane.data' && m.paneId === paneId ? [m.data] : []).join('')
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
      await ui.next('pane.data', (m) => m.paneId === paneId && /TOKEN:[\w-]{20,}:/.test(paneText(paneId)))
      return /TOKEN:([\w-]{20,}):/.exec(paneText(paneId))![1]!
    }
    const leadToken = await tokenOf(lead.id)
    const crewToken = await tokenOf(crew.id)
    assert.notEqual(leadToken, crewToken)

    const leadMcp = await mcpClient(server.port, leadToken)
    const crewMcp = await mcpClient(server.port, crewToken)
    clients.push(leadMcp, crewMcp)

    const leadTools = (await leadMcp.listTools()).tools.map((t) => t.name).sort()
    assert.deepEqual(leadTools, ['accounts_status', 'activity_status', 'agent_close', 'agent_interrupt', 'agent_list', 'agent_read', 'agent_resume', 'agent_send', 'agent_spawn', 'agent_spawn_many', 'ask_user', 'board_add', 'board_list', 'board_update', 'browser_click', 'browser_console', 'browser_key', 'browser_open', 'browser_screenshot', 'browser_scroll', 'browser_text', 'browser_type', 'context_read', 'delivery_ack', 'delivery_status', 'handoff_list', 'mission_briefing', 'mission_note', 'mission_ready', 'mission_status', 'model_catalog', 'project_memory', 'project_note', 'result_inspect', 'routing_propose', 'skill_catalog', 'skill_load', 'verification_status', 'verification_submit', 'whoami'])
    const models = JSON.parse(textOf(await leadMcp.callTool({ name: 'model_catalog', arguments: {} })))
    assert.ok(models.some((entry: { cli: string; selection: unknown[] }) => entry.cli === 'codex' && entry.selection.length === 3))
    const crewTools = (await crewMcp.listTools()).tools.map((t) => t.name).sort()
    assert.ok(crewTools.includes('handoff_submit') && !crewTools.includes('agent_spawn'))

    const whoami = JSON.parse(textOf(await crewMcp.callTool({ name: 'whoami', arguments: {} })))
    assert.equal(whoami.agent.id, crew.id)
    assert.equal(whoami.mission.title, 'Coordenação')
    const skillPage = JSON.parse(textOf(await crewMcp.callTool({ name: 'skill_catalog', arguments: { limit: 50 } })))
    assert.deepEqual(skillPage.items, [], 'plain shells have no CLI skill resources')
    assert.equal((await crewMcp.callTool({ name: 'context_read', arguments: { sha256: '0'.repeat(64) } })).isError, true)

    // The lead reads the helper's screen.
    ui.send({ type: 'pane.input', paneId: crew.id, data: 'echo tela-do-ajudante\r' })
    await ui.next('pane.data', (m) => m.paneId === crew.id && paneText(crew.id).includes('tela-do-ajudante'))
    await new Promise((r) => setTimeout(r, 100))
    assert.match(textOf(await leadMcp.callTool({ name: 'agent_read', arguments: { agent: crew.id } })), /tela-do-ajudante/)

    // The helper hands off; the lead's terminal receives it and the flow records it.
    // PTY data has no message boundaries. Exercise a valid split at the real PTY event boundary.
    const panes = (server.core as unknown as { panes: EventEmitter }).panes
    const emit = panes.emit.bind(panes)
    panes.emit = ((event: string | symbol, ...args: any[]) => {
      if (event === 'data' && args[0] === lead.id && typeof args[1] === 'string') {
        for (let at = 0; at < args[1].length; at += 4) emit(event, args[0], args[1].slice(at, at + 4))
        return true
      }
      return emit(event, ...args)
    }) as typeof panes.emit
    const result = await crewMcp.callTool({ name: 'handoff_submit', arguments: { summary: 'testes passando', evidence: 'npm test', details: '12 ok' } })
    assert.match(textOf(result), new RegExp(`enfileirado para #${lead.id}`))
    await ui.next('event.added', (m) => m.event.kind === 'handoff' && m.event.paneId === crew.id)
    await ui.next('pane.data', (m) => m.paneId === lead.id && paneText(lead.id).includes(`[Orbit] Retorno de #${crew.id}`))
    const handoffs = JSON.parse(textOf(await leadMcp.callTool({ name: 'handoff_list', arguments: {} })))
    assert.equal(handoffs[0].text, 'testes passando\n\nEvidência: npm test\n\n12 ok')
    const summaries = JSON.parse(textOf(await leadMcp.callTool({ name: 'handoff_list', arguments: { view: 'summary' } })))
    assert.equal(summaries[0].summary, 'testes passando')
    assert.equal(summaries[0].text, undefined)
    assert.equal(summaries[0].evidenceAvailable, true)
    const detail = JSON.parse(textOf(await leadMcp.callTool({ name: 'handoff_list', arguments: { resultId: handoffs[0].resultId, view: 'detail' } })))
    assert.equal(detail[0].text, handoffs[0].text)
    assert.equal((await leadMcp.callTool({ name: 'handoff_list', arguments: { resultId: handoffs[0].resultId, after: handoffs[0].resultId } })).isError, true)
    let notices: Array<{ id: string; state: string; resultId: string }> = []
    for (let n = 0; n < 50; n++) {
      notices = JSON.parse(textOf(await leadMcp.callTool({ name: 'delivery_status', arguments: {} })))
      if (notices[0]?.state === 'pty_accepted') break
      await new Promise(r => setTimeout(r, 20))
    }
    assert.equal(notices[0]?.state, 'pty_accepted')
    assert.equal((await crewMcp.callTool({ name: 'delivery_ack', arguments: { deliveryId: notices[0]!.id } })).isError, true)
    const acknowledged = JSON.parse(textOf(await leadMcp.callTool({ name: 'delivery_ack', arguments: { deliveryId: notices[0]!.id } })))
    assert.equal(acknowledged.state, 'agent_acknowledged')
    assert.equal(acknowledged.resultId, handoffs[0].resultId)
    const packet = JSON.parse(textOf(await leadMcp.callTool({ name: 'delivery_ack', arguments: { deliveryId: notices[0]!.id, includeResult: true } })))
    assert.equal(packet.context.result.id, handoffs[0].resultId)
    assert.equal(packet.context.result.evidence, 'npm test')
    assert.equal(packet.context.current, true)
    assert.equal(packet.context.sourceFreshness, 'not_checked')
    assert.match(textOf(result), new RegExp(handoffs[0].resultId))
    const history = JSON.parse(textOf(await leadMcp.callTool({ name: 'activity_status', arguments: { activityId: handoffs[0].activityId } })))
    assert.equal(history.results[0].id, handoffs[0].resultId)
    assert.equal(history.activities[0].state, 'awaiting_validation')
    assert.equal(history.attempts[0].pane, undefined, 'status avoids repeating full terminal snapshots')
    const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value, null, 2))
    t.diagnostic(JSON.stringify({ measurement: 'same-delivery-context', baselineReads: 4, compactReads: 1, baselineReplyBytes: [acknowledged, handoffs, history, notices].reduce((n, value) => n + bytes(value), 0), compactReplyBytes: bytes(packet), unit: 'UTF-8 bytes; not provider tokens' }))
    for (let n = 0; n < 210; n++) server.core.store.addEvent({ missionId: mission.id, paneId: null, kind: 'pane.spawned', title: `Noise ${n}`, body: '' })
    assert.equal(server.core.missionEvents(mission.id, 'handoff').length, 0)
    const retained = JSON.parse(textOf(await leadMcp.callTool({ name: 'handoff_list', arguments: { resultId: handoffs[0].resultId } })))
    assert.equal(retained[0].text, handoffs[0].text)
    const duplicate = await crewMcp.callTool({ name: 'handoff_submit', arguments: { summary: 'testes passando', evidence: 'npm test', details: '12 ok' } })
    assert.match(textOf(duplicate), /Reenvio reconhecido/)
    assert.equal(server.core.missionEvents(mission.id, 'handoff').length, 0)
    assert.deepEqual(JSON.parse(textOf(await leadMcp.callTool({ name: 'handoff_list', arguments: { after: handoffs[0].resultId } }))), [])
    assert.equal((await leadMcp.callTool({ name: 'handoff_list', arguments: { resultId: 'another-mission-result' } })).isError, true)

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

test('an agent reads a packaged skill through authenticated MCP without executing its content', async () => {
  const launches: AgentLaunch[] = []
  const server = await startServer({ port: 0, token: TOKEN, allowedOrigins: [ORIGIN], dataDir: mkdtempSync(join(tmpdir(), 'orbit-skill-mcp-')), shell: '/bin/sh', run: offline, browser: null,
    agentCommand: launch => { launches.push(launch); return { file: '/bin/sh', args: ['-c', 'while read line; do :; done'] } } })
  const ui = connect(server.port)
  let client: Client | undefined
  try {
    await ui.opened
    ui.send({ type: 'workspace.open', path: realpathSync(mkdtempSync(join(tmpdir(), 'orbit-skill-ws-'))) })
    const { workspace } = await ui.next('workspace.updated')
    ui.send({ type: 'mission.create', workspaceId: workspace.id, title: 'Skills', objective: 'Read a skill', mode: 'livre', lead: { cli: 'claude', model: null, title: 'Lead' } })
    await ui.next('pane.updated', m => m.pane.role === 'lead')
    const config = JSON.parse(readFileSync(launches[0]!.mcpConfigPath!, 'utf8'))
    client = await mcpClient(server.port, config.mcpServers.orbit.headers.Authorization.slice(7))
    const page = JSON.parse(textOf(await client.callTool({ name: 'skill_catalog', arguments: {} })))
    const item = page.items.find((s: { name: string }) => s.name === 'orbit-pilot')
    assert.ok(item.available && item.selected)
    assert.equal(item.loaded, null)
    const loaded = JSON.parse(textOf(await client.callTool({ name: 'skill_load', arguments: { id: item.id, sha256: item.sha256 } })))
    assert.match(loaded.text, /unresolved required work/)
    assert.equal(loaded.fulfilled, null)
    assert.equal((await client.callTool({ name: 'skill_load', arguments: { id: item.id, sha256: '0'.repeat(64) } })).isError, true)
    const now = JSON.parse(textOf(await client.callTool({ name: 'skill_catalog', arguments: {} })))
    assert.equal(now.items.find((s: { id: string }) => s.id === item.id).loaded.sha256, item.sha256)
  } finally { await client?.close(); ui.ws.close(); await server.close() }
})

test('authenticated finalization accepts only the lead final integration review and returns its durable completion', async () => {
  const launches: AgentLaunch[] = []
  const server = await startServer({ port: 0, token: TOKEN, allowedOrigins: [ORIGIN], dataDir: mkdtempSync(join(tmpdir(), 'orbit-final-mcp-')), shell: '/bin/sh', run: offline, browser: null, scheduler: false,
    agentCommand: launch => { launches.push(launch); return { file: '/bin/sh', args: ['-c', 'printf "READY\\n"; while read line; do :; done'] } } })
  const clients: Client[] = []
  const ui = connect(server.port)
  try {
    await ui.opened
    server.core.handle({ type: 'workspace.open', path: realpathSync(mkdtempSync(join(tmpdir(), 'orbit-final-source-'))) })
    server.core.handle({ type: 'mission.create', workspaceId: server.core.store.snapshot().workspaces[0]!.id, title: 'Finalization fixture', objective: 'Synthetic lifecycle', mode: 'agentica', lead: { cli: 'claude', model: null, title: 'Lead' } })
    const lead = server.core.store.snapshot().panes.find(p => p.role === 'lead')!
    const { pane } = await server.core.spawnHelper(lead, { title: 'Worker', task: 'Synthetic read', cli: 'claude', model: null, readOnly: true })
    const result = server.core.handoff(pane, { summary: 'Synthetic result', evidence: 'Synthetic observation' })
    for (const launch of launches) {
      const config = JSON.parse(readFileSync(launch.mcpConfigPath!, 'utf8'))
      clients.push(await mcpClient(server.port, config.mcpServers.orbit.headers.Authorization.slice(7)))
    }
    const [leadMcp, crewMcp] = clients as [Client, Client]
    const inspect = async (scope: 'result' | 'integration') => {
      const reply = await leadMcp.callTool({ name: 'result_inspect', arguments: { resultId: result.resultId, scope } })
      assert.notEqual(reply.isError, true, textOf(reply))
      return JSON.parse(textOf(reply))
    }
    const verdict = (inspection: { id: string; acceptance: string[] }) => ({ inspectionId: inspection.id, verdict: 'accepted', summary: 'Synthetic transport fixture review', checks: [{ command: 'synthetic MCP lifecycle observation', exitCode: 0, summary: 'Fixture contract observed' }], criteria: inspection.acceptance.map((_, i) => ({ item: i + 1, met: true, how: 'Synthetic fixture observation' })) })
    const accepted = await leadMcp.callTool({ name: 'verification_submit', arguments: verdict(await inspect('result')) })
    assert.notEqual(accepted.isError, true, textOf(accepted))
    const integration = await inspect('integration')
    assert.equal((await crewMcp.callTool({ name: 'verification_submit', arguments: { ...verdict(integration), readySummary: 'Helper cannot finalize' } })).isError, true)
    const final = await leadMcp.callTool({ name: 'verification_submit', arguments: { ...verdict(integration), readySummary: 'Fixture concluída com revisão sintética.' } })
    assert.notEqual(final.isError, true, textOf(final))
    const complete = JSON.parse(textOf(final))
    assert.equal(complete.scope, 'integration')
    assert.equal(complete.completion.readyAt, server.core.store.mission(lead.missionId)!.readyAt)
    assert.equal(server.core.missionEvents(lead.missionId, 'mission.ready').length, 1)
    const updated = await ui.next('mission.updated', m => m.mission.id === lead.missionId && m.mission.readyAt === complete.completion.readyAt)
    assert.equal(updated.mission.readySummary, complete.completion.summary)
    await ui.next('event.added', m => m.event.id === complete.completion.eventId && m.event.kind === 'mission.ready')
  } finally { for (const client of clients) await client.close(); ui.ws.close(); await server.close() }
})
