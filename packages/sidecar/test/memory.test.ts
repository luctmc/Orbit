import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Run } from '../src/clis.ts'
import type { AgentLaunch } from '../src/command.ts'
import { startServer } from '../src/server.ts'
import { connect, ORIGIN, TOKEN, HOMES } from './helpers.ts'

const textOf = (result: unknown) => ((result as { content: Array<{ text: string }> }).content[0]?.text ?? '')

test('a workspace remembers across missions: leads write to it, finished missions add to it, new leads start with it', async () => {
  const run: Run = async (command) => {
    if (command.endsWith('claude auth status')) return { code: 0, stdout: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' }), stderr: '' }
    return { code: 127, stdout: '', stderr: 'offline' }
  }
  const launches: AgentLaunch[] = []
  const fake = (launch: AgentLaunch, shell: string) => {
    launches.push(launch)
    return { file: shell, args: ['-c', `exec ${shell}`] }
  }
  process.env.CLAUDE_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'claude-home-'))
  process.env.CODEX_HOME = mkdtempSync(join(tmpdir(), 'codex-home-'))
  const dataDir = mkdtempSync(join(tmpdir(), 'orbit-data-'))
  const server = await startServer({ port: 0, token: TOKEN, allowedOrigins: [ORIGIN], dataDir, shell: '/bin/sh', run, agentCommand: fake, browser: null, scheduler: false })
  const ui = connect(server.port)
  const clients: Client[] = []
  try {
    await ui.opened
    ui.send({ type: 'workspace.open', path: realpathSync(mkdtempSync(join(tmpdir(), 'orbit-ws-'))) })
    const { workspace } = await ui.next('workspace.updated')
    const screen = server.core as unknown as { panes: { screenText: (id: number, lines: number) => string } }
    const mcpAs = async (paneId: number) => {
      ui.send({ type: 'pane.input', paneId, data: 'clear; echo "TOKEN:$ORBIT_PANE_TOKEN:"\r' })
      let token = ''
      for (let i = 0; i < 100 && !token; i++) {
        token = /TOKEN:([\w-]{20,}):/.exec(screen.panes.screenText(paneId, 50).replaceAll('\n', ''))?.[1] ?? ''
        if (!token) await new Promise((r) => setTimeout(r, 30))
      }
      const client = new Client({ name: 'test', version: '0' })
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }))
      clients.push(client)
      return async (name: string, args: Record<string, unknown> = {}) => textOf(await client.callTool({ name, arguments: args }))
    }

    // First mission: the lead writes to the project memory; the finished mission adds its summary.
    ui.send({ type: 'mission.create', workspaceId: workspace.id, title: 'Primeira', objective: 'Corrigir a média', mode: 'agentica', lead: { cli: 'shell', model: null, title: 'Líder' } })
    const { pane: lead1 } = await ui.next('pane.updated', (m) => m.pane.role === 'lead')
    const asLead1 = await mcpAs(lead1.id)
    assert.match(await asLead1('project_note', { kind: 'licao', text: 'npm test precisa de NODE_ENV=test, senão os testes de banco falham' }), /1 entries/)
    assert.match(await asLead1('project_note', { kind: 'missao', text: 'x' }), /expected one of "decisao"|"fato"|"licao"/)
    await asLead1('mission_ready', { summary: 'Média corrigida e coberta por 4 testes; revisor aprovou.' })
    const { entries } = await ui.next('memory', (m) => m.workspaceId === workspace.id && m.entries.some((e) => e.kind === 'missao'))
    assert.deepEqual(entries.map((e) => [e.kind, e.source?.missionTitle]), [['licao', 'Primeira'], ['missao', 'Primeira']])
    assert.equal(entries[1]!.text, 'Primeira: Média corrigida e coberta por 4 testes; revisor aprovou.')

    // The person adds and pins; editing keeps where an entry came from.
    ui.send({ type: 'memory.save', workspaceId: workspace.id, entry: { kind: 'decisao', text: 'Nada de dependências novas sem perguntar', pinned: true } })
    const added = (await ui.next('memory', (m) => m.entries.length === 3)).entries.find((e) => e.kind === 'decisao')!
    assert.deepEqual([added.source, added.pinned], [null, true])
    ui.send({ type: 'memory.save', workspaceId: workspace.id, entry: { id: entries[0]!.id, kind: 'licao', text: 'npm test precisa de NODE_ENV=test', pinned: false } })
    const edited = (await ui.next('memory', (m) => m.entries.some((e) => e.text === 'npm test precisa de NODE_ENV=test'))).entries.find((e) => e.id === entries[0]!.id)!
    assert.equal(edited.source?.missionTitle, 'Primeira')

    // Second mission: its lead starts with the memory (pinned first) and any agent can read it all.
    ui.send({ type: 'mission.create', workspaceId: workspace.id, title: 'Segunda', objective: 'Nova tela', mode: 'agentica', lead: { cli: 'claude', model: 'haiku', title: 'Líder' } })
    const { pane: lead2 } = await ui.next('pane.updated', (m) => m.pane.role === 'lead' && m.pane.cli === 'claude')
    const role = readFileSync(launches.at(-1)!.rolePromptPath!, 'utf8')
    assert.match(role, /Project memory: what earlier missions of this project learned/)
    const memoryLines = role.split('\n').filter((l) => l.startsWith('- ['))
    assert.match(memoryLines[0]!, /^- \[decision, pinned · the user · \d{4}-\d\d-\d\d\] Nada de dependências novas sem perguntar/)
    assert.match(memoryLines[1]!, /^- \[lesson · Primeira · .*\] npm test precisa de NODE_ENV=test$/)
    assert.match(memoryLines[2]!, /^- \[mission · Primeira · .*\] Primeira: Média corrigida/)
    const asLead2 = await mcpAs(lead2.id)
    assert.match(await asLead2('mission_briefing'), /## Required project memory \(pinned or written by the user\)\n\n- \[decision, pinned/)
    const helper = Number(/#(\d+) /.exec(await asLead2('agent_spawn', { title: 'Tela', task: 'Crie a tela', agent: 'claude' }))![1])
    const asHelper = await mcpAs(helper)
    assert.match(await asHelper('project_memory'), /NODE_ENV=test/)
    assert.match(await asHelper('project_note', { kind: 'fato', text: 'x' }), /not found|Tool project_note/i)

    // Deleting forgets it for the next leads.
    ui.send({ type: 'memory.delete', workspaceId: workspace.id, entryId: added.id })
    for (let i = 0; i < 100 && server.core.store.memory(workspace.id).some((e) => e.id === added.id); i++) await new Promise((r) => setTimeout(r, 20))
    assert.doesNotMatch(server.core.projectMemory(workspace.id), /dependências/)
  } finally {
    process.env.CLAUDE_CONFIG_DIR = HOMES.claude
    process.env.CODEX_HOME = HOMES.codex
    for (const client of clients) await client.close()
    ui.ws.close()
    await server.close()
  }
})
