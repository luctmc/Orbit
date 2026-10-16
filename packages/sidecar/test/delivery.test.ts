import { test } from 'node:test'
import { acceptSyntheticResult } from './reviewFixture.ts'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Run } from '../src/clis.ts'
import type { AgentLaunch } from '../src/command.ts'
import { startServer } from '../src/server.ts'
import { codexLastTurn } from '../src/usage.ts'
import { connect, ORIGIN, TOKEN, HOMES } from './helpers.ts'

const SESSION = '3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f'
const textOf = (result: unknown) => ((result as { content: Array<{ text: string }> }).content[0]?.text ?? '')
const line = (type: string, payload: object, at: string) => JSON.stringify({ timestamp: at, type: 'event_msg', payload: { type, ...payload } })

test('a Codex turn ends at task_complete, with its last message', () => {
  const started = line('task_started', { turn_id: 't1' }, '2026-10-14T10:00:00Z')
  const done = line('task_complete', { turn_id: 't1', last_agent_message: 'Pronto: 3 testes' }, '2026-10-14T10:01:00Z')
  assert.deepEqual(codexLastTurn(`${started}\n${done}\n{"type":"event_msg","payload":{"type":"token_count"}}\n`), { id: 't1', done: true, at: Date.parse('2026-10-14T10:01:00Z'), lastMessage: 'Pronto: 3 testes' })
  assert.equal(codexLastTurn(`${done}\n${line('task_started', { turn_id: 't2' }, '2026-10-14T10:02:00Z')}`)!.done, false)
  assert.equal(codexLastTurn('{"type":"session_meta"}'), null)
})

test('helpers always report back: forced handoff, structured status, interrupt, resume and a ready mission', async () => {
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
  const dataDir = mkdtempSync(join(tmpdir(), 'orbit-data-'))
  process.env.CODEX_HOME = mkdtempSync(join(tmpdir(), 'codex-home-'))
  process.env.CLAUDE_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'claude-home-'))
  const server = await startServer({ port: 0, token: TOKEN, allowedOrigins: [ORIGIN], dataDir, shell: '/bin/sh', run, agentCommand: fake, browser: null, scheduler: false })
  const ui = connect(server.port)
  const clients: Client[] = []
  try {
    await ui.opened
    await ui.next('account.status', (m) => m.statuses.some((s) => s.accountId === 'codex' && s.loggedIn === true))
    ui.send({ type: 'workspace.open', path: realpathSync(mkdtempSync(join(tmpdir(), 'orbit-ws-'))) })
    const { workspace } = await ui.next('workspace.updated')
    ui.send({ type: 'mission.create', allowOriginal: true, workspaceId: workspace.id, title: 'Entrega', objective: 'Cadastro', mode: 'agentica', lead: { cli: 'shell', model: null, title: 'Líder' } })
    const { mission } = await ui.next('mission.updated')
    assert.equal(mission.readyAt, null)
    const { pane: lead } = await ui.next('pane.updated', (m) => m.pane.role === 'lead')

    const tokenOf = async (paneId: number) => {
      // Let any message still being typed land, then start from an empty line (Ctrl-U).
      await new Promise((r) => setTimeout(r, 300))
      ui.send({ type: 'pane.input', paneId, data: '\x15clear; echo "TOKEN:$ORBIT_PANE_TOKEN:"\r' })
      const screen = server.core as unknown as { panes: { screenText: (id: number, lines: number) => string } }
      for (let i = 0; i < 100; i++) {
        const found = /TOKEN:([\w-]{20,}):/.exec(screen.panes.screenText(paneId, 200).replaceAll('\n', ''))
        if (found) return found[1]!
        await new Promise((r) => setTimeout(r, 30))
      }
      throw new Error(`no token from #${paneId}\n${screen.panes.screenText(paneId, 15)}`)
    }
    const mcpAs = async (token: string) => {
      const client = new Client({ name: 'test', version: '0' })
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }))
      clients.push(client)
      return async (name: string, args: Record<string, unknown>) => {
        const result = await client.callTool({ name, arguments: args })
        return { text: textOf(result), error: result.isError === true }
      }
    }
    const hook = async (token: string, payload: object) => {
      const res = await fetch(`http://127.0.0.1:${server.port}/hooks`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(payload) })
      return res.status === 200 ? res.json() : null
    }
    const pane = (id: number) => server.core.store.pane(id)!
    // What a terminal shows, lines joined (long messages wrap), polled until it has the text.
    const screens = server.core as unknown as { panes: { screenText: (id: number, lines: number) => string } }
    const sees = async (paneId: number, text: string) => {
      for (let i = 0; i < 100; i++) {
        if (screens.panes.screenText(paneId, 200).replaceAll('\n', '').includes(text)) return
        await new Promise((r) => setTimeout(r, 30))
      }
      throw new Error(`#${paneId} never showed: ${text}\n${screens.panes.screenText(paneId, 30)}`)
    }
    const leadSees = (text: string) => sees(lead.id, text)
    const asLead = await mcpAs(await tokenOf(lead.id))

    // A Claude helper ends its turn without delivering: asked once, then Orbit delivers for it.
    const opened = await asLead('agent_spawn', { title: 'Banco', task: 'Crie a tabela de clientes', agent: 'claude' })
    const helperId = Number(/#(\d+) Banco/.exec(opened.text)![1])
    assert.equal(pane(helperId).assignedBy, lead.id)
    const helperToken = await tokenOf(helperId)
    const asHelper = await mcpAs(helperToken)
    const blocked = await hook(helperToken, { hook_event_name: 'Stop', stop_hook_active: false })
    assert.equal(blocked.decision, 'block')
    assert.match(blocked.reason, /handoff_submit/)
    const seen = leadSees('encerrou o turno sem entregar')
    assert.equal(await hook(helperToken, { hook_event_name: 'Stop', stop_hook_active: true, last_assistant_message: 'Qual banco:\nPostgres ou SQLite?' }), null)
    await seen
    const lastHandoff = () => server.core.missionEvents(mission.id, 'handoff').at(-1)!
    assert.match(lastHandoff().body, /Última mensagem:\n\nQual banco: \/ Postgres ou SQLite\?/)
    assert.equal(pane(helperId).handoffStatus, 'auto')

    // The lead answers: that is new work, owed back.
    assert.match((await asLead('agent_send', { agent: helperId, message: 'Use SQLite' })).text, /enviada/)
    assert.equal(pane(helperId).handoffStatus, null)

    // Done needs evidence; progress is only recorded and lets the helper stop without being chased.
    assert.match((await asHelper('handoff_submit', { summary: 'Tabela criada' })).text, /evidence/)
    assert.match((await asHelper('handoff_submit', { summary: 'Migração escrita, falta rodar', status: 'progress' })).text, /Progresso registrado/)
    assert.equal(await hook(helperToken, { hook_event_name: 'Stop', stop_hook_active: false }), null)
    assert.match((await asLead('agent_close', { agent: helperId })).text, /ainda não entregou/)
    assert.match((await asLead('mission_ready', { summary: 'Cadastro feito' })).text, new RegExp(`falta retorno de #${helperId}`))
    assert.match((await asLead('mission_ready', { summary: 'Cadastro feito', force: true })).text, /dispensar/)
    const pendingStatus = JSON.parse((await asLead('mission_status', {})).text)
    assert.ok(pendingStatus.pendingDeliveries.some((d: { paneId: number; status: string }) => d.paneId === helperId && d.status === 'progress'))

    // A real delivery reaches the lead with its status and evidence; then the mission can be ready.
    const delivered = leadSees(`Retorno de #${helperId} (Banco), conclu`)
    assert.match((await asHelper('handoff_submit', { summary: 'Tabela clientes criada', evidence: 'sqlite3 .schema mostra clientes' })).text, new RegExp(`enfileirado para #${lead.id}`))
    await delivered
    assert.match(lastHandoff().body, /^Tabela clientes criada\n\nEvidência: sqlite3/)
    const deliveredResult = server.core.store.activityHistory(mission.id).results.findLast(r => r.status === 'done')!
    acceptSyntheticResult(server.core, lead, deliveredResult.id)
    assert.match((await asLead('mission_ready', { summary: 'Cadastro feito por #' + helperId })).text, /pronta/)
    const ready = (await ui.next('mission.updated', (m) => m.mission.id === mission.id && m.mission.readyAt !== null)).mission
    assert.equal(ready.readySummary, `Cadastro feito por #${helperId}`)
    await ui.next('event.added', (m) => m.event.kind === 'mission.ready')

    // New work after "ready" reopens the mission. A handoff can go to another agent, who then owes one.
    const reviewerId = Number(/#(\d+) Revisor/.exec((await asLead('agent_spawn', { title: 'Revisor', task: 'Revise o que #N mandar', agent: 'codex', readOnly: true })).text)![1])
    assert.equal(server.core.store.mission(mission.id)!.readyAt, null)
    await asLead('agent_send', { agent: helperId, message: 'Mande a tabela para o revisor' })
    await asHelper('handoff_submit', { summary: 'Para revisar: tabela clientes', evidence: 'schema anexo', to: reviewerId })
    await sees(reviewerId, `Retorno de #${helperId} (Banco) para`)
    assert.deepEqual([pane(reviewerId).handoffStatus, pane(reviewerId).assignedBy], [null, lead.id])

    // Codex has no hooks: its turn ends in the session file. First a nudge, then Orbit delivers.
    const core = server.core as unknown as { codexTurn: (pane: unknown, tail: string) => void }
    const at = new Date(Date.now() + 1000).toISOString()
    const nudge = sees(reviewerId, 'You ended your turn without delivering. Call handoff_submit')
    core.codexTurn(pane(reviewerId), line('task_complete', { turn_id: 'a', last_agent_message: 'Li a tabela' }, at))
    await nudge
    core.codexTurn(pane(reviewerId), line('task_complete', { turn_id: 'a', last_agent_message: 'Li a tabela' }, at))
    assert.equal(pane(reviewerId).handoffStatus, null, 'the same turn is handled once')
    const auto = leadSees(`#${reviewerId} (Revisor) encerrou o turno sem entregar`)
    core.codexTurn(pane(reviewerId), line('task_complete', { turn_id: 'b', last_agent_message: 'Aprovado' }, at))
    await auto
    assert.match(lastHandoff().body, /Aprovado$/)
    assert.equal(pane(reviewerId).handoffStatus, 'auto')

    // Naming the lead in `to` is a plain delivery.
    const asReviewer = await mcpAs(await tokenOf(reviewerId))
    await asReviewer('handoff_submit', { summary: 'Aprovado de vez', evidence: 'li o diff', to: lead.id })
    assert.equal(lastHandoff().title, `Retorno de #${reviewerId} (concluído)`)

    // Interrupt and redirect: Esc, then the new orders as a message.
    const redirected = sees(helperId, `Mensagem de #${lead.id}: Pare e rode os testes`)
    assert.match((await asLead('agent_interrupt', { agent: helperId, message: 'Pare e rode os testes' })).text, /reorientado/)
    await redirected

    // Resume: same conversation, same number, the message as its next turn; what it owes carries over.
    assert.match((await asLead('agent_resume', { agent: helperId })).text, /ainda não informou a conversa/)
    await hook(helperToken, { hook_event_name: 'SessionStart', session_id: SESSION })
    await ui.next('pane.updated', (m) => m.pane.id === helperId && m.pane.sessionId === SESSION && m.pane.status === 'idle')
    const resumed = await asLead('agent_resume', { agent: helperId, message: 'Continue com os testes' })
    assert.match(resumed.text, /retomado na mesma conversa/)
    const launch = launches.at(-1)!
    assert.equal(launch.resume, SESSION)
    assert.equal(readFileSync(launch.taskPath!, 'utf8'), 'Continue com os testes')
    assert.deepEqual([pane(helperId).assignedBy, pane(helperId).handoffStatus], [lead.id, null])
    await ui.next('event.added', (m) => m.event.title === `#${helperId} retomou a conversa`)
  } finally {
    process.env.CODEX_HOME = HOMES.codex
    process.env.CLAUDE_CONFIG_DIR = HOMES.claude
    for (const client of clients) await client.close()
    ui.ws.close()
    await server.close()
  }
})
