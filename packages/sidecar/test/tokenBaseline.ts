import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { startServer } from '../src/server.ts'
import { HarnessMeasurements } from '../src/measurements.ts'
import { toolkitSections } from '../src/toolkitPolicy.ts'
import { leadRole, crewRole } from '../src/prompts.ts'
import type { AgentLaunch } from '../src/command.ts'
import type { ServerMessage } from '@orbit/protocol'
import { offline, TOKEN, ORIGIN } from './helpers.ts'

const size = (text: string) => ({ bytes: Buffer.byteLength(text), estimatedTokens: Buffer.byteLength(text) / 4 })

/** Fixture local com PTY sintético e MCP real; nunca executa uma CLI de provedor. */
export async function tokenBaseline() {
  const root = mkdtempSync(join(tmpdir(), 'orbit-token-baseline-'))
  const launches: AgentLaunch[] = []
  const measurements = new HarnessMeasurements()
  const server = await startServer({ port: 0, token: TOKEN, allowedOrigins: [ORIGIN], dataDir: join(root, 'data'),
    shell: '/bin/sh', browser: null, run: offline, scheduler: false, measurements,
    agentCommand: launch => { launches.push(launch); return { file: '/bin/sh', args: ['-c', 'while read line; do :; done'] } },
  })
  try {
    const core = server.core
    await core.handle({ type: 'workspace.open', path: root })
    await core.handle({ type: 'mission.create', workspaceId: core.store.snapshot().workspaces[0]!.id,
      title: 'Baseline', objective: '', allowOriginal: true, mode: 'agentica', lead: { cli: 'claude', model: null, title: 'Líder' } })
    const lead = core.store.snapshot().panes[0]!
    await core.handle({ type: 'pane.spawn', request: { missionId: lead.missionId, role: 'crew', cli: 'claude', model: null, title: 'Helper' } })
    const panes = core.store.snapshot().panes
    const components = []
    for (const [index, pane] of panes.entries()) {
      const launch = launches[index]!
      const config = JSON.parse(readFileSync(launch.mcpConfigPath!, 'utf8'))
      const client = new Client({ name: 'baseline', version: '1' })
      try {
        await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.port}/mcp`), {
          requestInit: { headers: config.mcpServers.orbit.headers },
        }))
        const tools = (await client.listTools()).tools
        const role = readFileSync(launch.rolePromptPath!, 'utf8')
        const mission = core.mission(pane.missionId)!
        const contract = pane.role === 'lead' ? leadRole(mission, pane, undefined, core.routing()) : crewRole(mission, pane, { boss: lead, hasBoard: false })
        if (!role.includes(contract)) throw new Error('Contrato da fixture não corresponde ao role gerado')
        const toolkit = (core as unknown as { toolkitContext(id: string): { text: string } }).toolkitContext(mission.id).text
        const settings = JSON.parse(readFileSync(launch.settingsPath!, 'utf8'))
        components.push({ role: pane.role, cli: pane.cli, toolCount: tools.length,
          roleContract: size(contract), toolkit: size(toolkit),
          toolkitSource: size(toolkitSections().map(s => s.text).join('\n\n')),
          completeRole: size(role),
          otherRoleSections: size(role.replace(contract, '').replace(toolkit, '')),
          mcpTools: size(JSON.stringify(tools)),
          mcpInputSchemas: size(JSON.stringify(tools.map(t => ({ name: t.name, inputSchema: t.inputSchema })))),
          hookSettings: size(JSON.stringify(settings.hooks)),
        })
      } finally { await client.close() }
    }
    const replies: ServerMessage[] = []
    for (const requestId of ['baseline-message-1', 'baseline-message-2']) {
      await core.handle({ type: 'pane.submit', paneId: lead.id, dispatch: 'continue', requestId, text: 'Mensagem ao líder', allowOriginal: true }, reply => replies.push(reply))
    }
    const paneCountAfterMessages = core.store.snapshot().panes.length
    const beforeResume = measurements.snapshot().find(m => m.paneId === lead.id)!
    core.hookReport(lead.id, { hook_event_name: 'SessionStart', session_id: '11111111-2222-4333-8444-555555555555' })
    await core.handle({ type: 'pane.restart', paneId: lead.id, resume: true })
    const afterResume = measurements.snapshot().find(m => m.paneId === lead.id && m.epoch !== beforeResume.epoch)!
    return { components, paneCountBeforeMessages: panes.length, paneCountAfterMessages,
      replies: replies.map(r => ({ type: r.type, ...('paneId' in r ? { paneId: r.paneId } : {}) })),
      beforeResume, afterResume }
  } finally { await server.close(); rmSync(root, { recursive: true, force: true }) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await tokenBaseline(), null, 2))
}
