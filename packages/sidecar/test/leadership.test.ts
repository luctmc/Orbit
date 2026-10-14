import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Run } from '../src/clis.ts'
import { buildCommand, type AgentLaunch } from '../src/command.ts'
import { claudeTurns, codexTurns, turnsMarkdown } from '../src/transcripts.ts'
import { startServer } from '../src/server.ts'
import { connect, ORIGIN, TOKEN } from './helpers.ts'

const SESSION = '3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f'
const textOf = (result: unknown) => ((result as { content: Array<{ text: string }> }).content[0]?.text ?? '')

test('a Codex lead runs in the read-only sandbox', () => {
  assert.match(buildCommand({ cli: 'codex', model: null, sandbox: 'read-only' }, '/bin/zsh').args[2]!, /^codex -s read-only/)
  assert.match(buildCommand({ cli: 'codex', model: null, sandbox: 'read-only', resume: SESSION }, '/bin/zsh').args[2]!, /^codex resume -s read-only .*-- 3f2a9c1e/)
})

test("an agent's last words are read from its CLI's own files", () => {
  const claude = [
    { type: 'user', message: { role: 'user', content: 'Corrija a média' } },
    { type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'x' }, { type: 'text', text: 'Abri #2 para a correção.' }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } },
    { type: 'user', isMeta: true, message: { content: '<command-name>/clear</command-name>' } },
  ].map((l) => JSON.stringify(l)).join('\n')
  assert.deepEqual(claudeTurns(claude), [{ role: 'pessoa', text: 'Corrija a média' }, { role: 'agente', text: 'Abri #2 para a correção.' }])
  const codex = [
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>…</environment_context>' }] } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Revise o PR' }] } },
    { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Delegado ao #3.' }] } },
  ].map((l) => JSON.stringify(l)).join('\n')
  assert.deepEqual(codexTurns(codex), [{ role: 'pessoa', text: 'Revise o PR' }, { role: 'agente', text: 'Delegado ao #3.' }])
  assert.equal(turnsMarkdown([{ role: 'pessoa', text: 'a'.repeat(50) }, { role: 'agente', text: 'fim' }], 30), '**Lead:** fim')
})

test('the lead changes hands without losing anything: briefing, notes, helpers and the old lead\'s last words', async () => {
  const run: Run = async (command) => {
    if (command.endsWith('codex login status')) return { code: 0, stdout: 'Logged in using ChatGPT\n', stderr: '' }
    if (command.endsWith('claude auth status')) return { code: 0, stdout: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' }), stderr: '' }
    return { code: 127, stdout: '', stderr: 'offline' }
  }
  const launches: AgentLaunch[] = []
  const fake = (launch: AgentLaunch, shell: string) => {
    launches.push(launch)
    return { file: shell, args: ['-c', `exec ${shell}`] }
  }
  const claudeHome = mkdtempSync(join(tmpdir(), 'claude-home-'))
  process.env.CLAUDE_CONFIG_DIR = claudeHome
  process.env.CODEX_HOME = mkdtempSync(join(tmpdir(), 'codex-home-'))
  const server = await startServer({ port: 0, token: TOKEN, allowedOrigins: [ORIGIN], dataDir: mkdtempSync(join(tmpdir(), 'orbit-data-')), shell: '/bin/sh', run, agentCommand: fake, browser: null, scheduler: false })
  const ui = connect(server.port)
  const clients: Client[] = []
  try {
    await ui.opened
    ui.send({ type: 'workspace.open', path: realpathSync(mkdtempSync(join(tmpdir(), 'orbit-ws-'))) })
    const { workspace } = await ui.next('workspace.updated')

    // A Codex lead: read-only sandbox, and the maestro's reminder with what Orbit types to it.
    ui.send({ type: 'mission.create', workspaceId: workspace.id, title: 'Troca', objective: 'Corrigir a média e cobrir com testes', mode: 'agentica', lead: { cli: 'codex', model: null, title: 'Líder' } })
    const { mission } = await ui.next('mission.updated')
    const { pane: codexLead } = await ui.next('pane.updated', (m) => m.pane.role === 'lead')
    assert.equal(launches.at(-1)!.sandbox, 'read-only')
    const screen = server.core as unknown as { panes: { screenText: (id: number, lines: number) => string } }
    const sees = async (id: number, text: string) => {
      for (let i = 0; i < 100; i++) {
        if (screen.panes.screenText(id, 300).replaceAll('\n', '').includes(text)) return
        await new Promise((r) => setTimeout(r, 30))
      }
      throw new Error(`#${id} never showed: ${text}`)
    }
    const tokenOf = async (paneId: number) => {
      ui.send({ type: 'pane.input', paneId, data: 'clear; echo "TOKEN:$ORBIT_PANE_TOKEN:"\r' })
      for (let i = 0; i < 100; i++) {
        const found = /TOKEN:([\w-]{20,}):/.exec(screen.panes.screenText(paneId, 50).replaceAll('\n', ''))
        if (found) return found[1]!
        await new Promise((r) => setTimeout(r, 30))
      }
      throw new Error('no token')
    }
    const mcpAs = async (paneId: number) => {
      const client = new Client({ name: 'test', version: '0' })
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${await tokenOf(paneId)}` } } }))
      clients.push(client)
      return {
        call: async (name: string, args: Record<string, unknown> = {}) => textOf(await client.callTool({ name, arguments: args })),
        tools: async () => (await client.listTools()).tools.map((t) => t.name),
      }
    }
    const asCodexLead = await mcpAs(codexLead.id)
    assert.match(await asCodexLead.call('mission_note', { text: 'Média divide por length; não mexer em soma' }), /1 notas/)
    const helperId = Number(/#(\d+) /.exec(await asCodexLead.call('agent_spawn', { title: 'Correção', task: 'Corrija a média', kind: 'bug', agent: 'claude' }))![1])
    const asHelper = await mcpAs(helperId)
    await asHelper.call('agent_send', { agent: codexLead.id, message: 'Comecei pela média' })
    await sees(codexLead.id, 'Orbit reminder: you are the maestro')

    // Claude takes over: a new agent with the briefing as its first prompt; the helper now owes it.
    ui.send({ type: 'mission.lead.change', missionId: mission.id, to: { kind: 'new', cli: 'claude', model: 'sonnet', effort: 'high', accountId: null } })
    const { pane: claudeLead } = await ui.next('pane.updated', (m) => m.pane.role === 'lead' && m.pane.cli === 'claude')
    await ui.next('pane.removed', (m) => m.paneId === codexLead.id)
    const briefing = readFileSync(launches.at(-1)!.taskPath!, 'utf8')
    assert.match(briefing, /^# Mission briefing: "Troca"\n\nYou take over as lead from #\d+ \(Codex\)/)
    assert.match(briefing, /## Objective \(written by the user\)\n\nCorrigir a média e cobrir com testes/)
    assert.match(briefing, /## Decisions the leads wrote down\n\n- \(#\d+\) Média divide por length; não mexer em soma/)
    assert.match(briefing, new RegExp(`- #${helperId} Correção — Claude · claude-sonnet-5-5, Correção de bug; \\w+; owes a result to #${codexLead.id}`))
    assert.equal(launches.at(-1)!.sandbox, undefined, 'a Claude lead is kept from editing by its hook')
    assert.equal(server.core.store.pane(helperId)!.assignedBy, claudeLead.id)
    const changed = (await ui.next('event.added', (m) => m.event.kind === 'lead.changed')).event
    assert.match(changed.title, new RegExp(`Liderança: #${codexLead.id} \\(Codex\\) → #${claudeLead.id}`))

    // Its own last words come along next time: Claude's transcript, found by its conversation id.
    mkdirSync(join(claudeHome, 'projects', 'ws'), { recursive: true })
    writeFileSync(join(claudeHome, 'projects', 'ws', `${SESSION}.jsonl`), [
      { type: 'user', message: { content: 'Pode seguir' } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Esperando o retorno do #2; depois abro o revisor.' }] } },
    ].map((l) => JSON.stringify(l)).join('\n'))
    const asClaudeLead = await mcpAs(claudeLead.id)
    await fetch(`http://127.0.0.1:${server.port}/hooks`, { method: 'POST', headers: { authorization: `Bearer ${await tokenOf(claudeLead.id)}`, 'content-type': 'application/json' }, body: JSON.stringify({ hook_event_name: 'SessionStart', session_id: SESSION }) })
    await ui.next('pane.updated', (m) => m.pane.id === claudeLead.id && m.pane.sessionId === SESSION)
    assert.match(await asClaudeLead.call('mission_briefing'), /## Decisions the leads wrote down/)

    // Promote the helper: it keeps its conversation, gets the lead's tools and the reading order.
    assert.ok(!(await asHelper.tools()).includes('mission_briefing'))
    ui.send({ type: 'mission.lead.change', missionId: mission.id, to: { kind: 'promote', paneId: helperId } })
    await ui.next('pane.removed', (m) => m.paneId === claudeLead.id)
    assert.deepEqual([server.core.store.pane(helperId)!.role, server.core.store.pane(helperId)!.assignedBy], ['lead', null])
    assert.ok((await asHelper.tools()).includes('mission_briefing'))
    await sees(helperId, 'call mission_briefing')
    const briefing2 = await asHelper.call('mission_briefing')
    assert.match(briefing2, /## Recent flow[\s\S]*Liderança: #\d+ \(Codex\) → #\d+/)
    // The previous lead's words were in the briefing handed over (shown in the event).
    const second = (await ui.next('event.added', (m) => m.event.kind === 'lead.changed' && m.event.paneId === helperId)).event
    assert.match(second.body, new RegExp(`fim da conversa de #${claudeLead.id}`))
  } finally {
    delete process.env.CLAUDE_CONFIG_DIR
    delete process.env.CODEX_HOME
    for (const client of clients) await client.close()
    ui.ws.close()
    await server.close()
  }
})
