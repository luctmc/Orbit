import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Run } from '../src/clis.ts'
import type { AgentLaunch } from '../src/command.ts'
import { decisionPrompt, decisionSchema, parseDecision } from '../src/decider.ts'
import { DEFAULT_ROUTING } from '../src/routing.ts'
import { startServer } from '../src/server.ts'
import { connect, ORIGIN, TOKEN, HOMES } from './helpers.ts'

const textOf = (result: unknown) => ((result as { content: Array<{ text: string }> }).content[0]?.text ?? '')
const types = DEFAULT_ROUTING.taskTypes

test('the decider asks for one of the table ids and reads only a valid answer', () => {
  assert.match(decisionPrompt('Deixar a lista mais rápida', types), /- revisao: Revisão\. Conferir/)
  assert.deepEqual(JSON.parse(decisionSchema(types)).properties.kind.enum, types.map((t) => t.id))
  assert.equal(parseDecision(JSON.stringify({ structured_output: { kind: 'bug', why: 'lento é defeito' } }), types)!.type.id, 'bug')
  assert.equal(parseDecision(JSON.stringify({ result: '{"kind":"testes","why":"x"}' }), types)!.type.id, 'testes')
  assert.equal(parseDecision(JSON.stringify({ structured_output: { kind: 'inventado', why: 'x' } }), types), null)
  assert.equal(parseDecision(JSON.stringify({ is_error: true, result: 'limite' }), types), null)
  assert.equal(parseDecision('não é json', types), null)
})

test('an unclear activity goes to the decider, and the lead proposes table changes the person decides', async () => {
  const asked: string[] = []
  const run: Run = async (command) => {
    if (command.endsWith('codex login status')) return { code: 0, stdout: 'Logged in using ChatGPT\n', stderr: '' }
    if (command.endsWith('claude auth status')) return { code: 0, stdout: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' }), stderr: '' }
    if (command.startsWith('claude -p') && command.includes('--json-schema')) {
      asked.push(command)
      return { code: 0, stdout: JSON.stringify({ structured_output: { kind: 'investigacao', why: 'lentidão pede medir antes' } }), stderr: '' }
    }
    return { code: 127, stdout: '', stderr: 'offline' }
  }
  const fake = (_launch: AgentLaunch, shell: string) => ({ file: shell, args: ['-c', `exec ${shell}`] })
  const dataDir = mkdtempSync(join(tmpdir(), 'orbit-data-'))
  process.env.CODEX_HOME = mkdtempSync(join(tmpdir(), 'codex-home-'))
  process.env.CLAUDE_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'claude-home-'))
  const server = await startServer({ port: 0, token: TOKEN, allowedOrigins: [ORIGIN], dataDir, shell: '/bin/sh', run, agentCommand: fake, browser: null, scheduler: false })
  const ui = connect(server.port)
  let mcp: Client | null = null
  try {
    await ui.opened
    ui.send({ type: 'workspace.open', path: realpathSync(mkdtempSync(join(tmpdir(), 'orbit-ws-'))) })
    const { workspace } = await ui.next('workspace.updated')
    ui.send({ type: 'mission.create', workspaceId: workspace.id, title: 'Tabela', objective: '', mode: 'agentica', lead: { cli: 'shell', model: null, title: 'Líder' } })
    const { mission } = await ui.next('mission.updated')
    const { pane: lead } = await ui.next('pane.updated', (m) => m.pane.role === 'lead')
    const screen = server.core as unknown as { panes: { screenText: (id: number, lines: number) => string } }
    const sees = async (text: string) => {
      for (let i = 0; i < 100; i++) {
        if (screen.panes.screenText(lead.id, 200).replaceAll('\n', '').includes(text)) return
        await new Promise((r) => setTimeout(r, 30))
      }
      throw new Error(`the lead never showed: ${text}\n${screen.panes.screenText(lead.id, 12)}`)
    }
    ui.send({ type: 'pane.input', paneId: lead.id, data: 'clear; echo "TOKEN:$ORBIT_PANE_TOKEN:"\r' })
    let token = ''
    for (let i = 0; i < 100 && !token; i++) {
      token = /TOKEN:([\w-]{20,}):/.exec(screen.panes.screenText(lead.id, 50).replaceAll('\n', ''))?.[1] ?? ''
      if (!token) await new Promise((r) => setTimeout(r, 30))
    }
    mcp = new Client({ name: 'test', version: '0' })
    await mcp.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }))
    const call = async (name: string, args: Record<string, unknown>) => textOf(await mcp!.callTool({ name, arguments: args }))

    // No keyword: Haiku decides, with nothing of the person's setup, and the receipt says so.
    const opened = await call('agent_spawn', { title: 'Lista lenta', task: 'A lista de pedidos leva 8 segundos para aparecer' })
    assert.match(opened, /▸ tipo: Investigação \(o maestro classificou; decidido pelo Haiku: lentidão pede medir antes\)/)
    assert.equal(asked.length, 1)
    assert.match(asked[0]!, /^claude -p --model claude-haiku-5-5 --settings '\{"disableAllHooks":true\}' --strict-mcp-config --tools "" --no-session-persistence/)
    assert.doesNotMatch(asked[0]!, /oito|8 segundos/, 'the activity goes through a file, never the command line')
    // A keyword is enough: no model call.
    await call('agent_spawn', { title: 'Testes', task: 'Escreva testes para o carrinho' })
    assert.equal(asked.length, 1)
    // Switched off: the default stands.
    ui.send({ type: 'settings.save', settings: { resumeOnStart: true, smartClassify: false, agentsInEnglish: true } })
    await ui.next('settings.updated')
    assert.match(await call('agent_spawn', { title: 'Lista', task: 'A lista de pedidos leva 8 segundos' }), /▸ tipo: Funcionalidade \(o maestro classificou; padrão\)/)

    // The lead proposes; nothing changes until the person decides.
    assert.match(await call('routing_propose', { kind: 'testes', effort: 'turbo', reason: 'x' }), /Invalid|inválid/i)
    assert.match(await call('routing_propose', { kind: 'testes', model: 'claude-sonnet-5-5', reason: 'x' }), /Proposta enviada/)
    const proposal = (await ui.next('proposals', (m) => m.proposals.some((p) => p.status === 'pendente'))).proposals.at(-1)!
    assert.deepEqual([proposal.kind, proposal.change], ['testes', { model: 'claude-sonnet-5-5' }])
    assert.equal(server.core.store.routing().taskTypes.find((t) => t.id === 'testes')!.model, null)
    await ui.next('event.added', (m) => m.event.kind === 'proposal' && m.event.title === 'Proposta para a tabela: Testes')

    const better = await call('routing_propose', { kind: 'testes', agent: 'claude', effort: 'high', reason: 'O Codex errou o runner duas vezes nesta missão' })
    assert.match(better, /Proposta enviada/)
    const pending = server.core.store.proposals().filter((p) => p.status === 'pendente')
    ui.send({ type: 'proposal.decide', proposalId: pending[0]!.id, accept: false })
    await sees('recusou sua proposta para a tabela (Testes')
    ui.send({ type: 'proposal.decide', proposalId: pending[1]!.id, accept: true })
    const { routing } = await ui.next('routing.updated')
    const row = routing.taskTypes.find((t) => t.id === 'testes')!
    assert.deepEqual([row.cli, row.model, row.effort], ['claude', null, 'high'])
    await sees('Vale para os pr')
    ui.send({ type: 'proposal.decide', proposalId: pending[1]!.id, accept: true })
    assert.match((await ui.next('error')).message, /já foi decidida/)
    assert.equal(server.core.missionEvents(mission.id, 'proposal').at(-1)!.title, 'Proposta aceita: Testes')
  } finally {
    process.env.CODEX_HOME = HOMES.codex
    process.env.CLAUDE_CONFIG_DIR = HOMES.claude
    await mcp?.close()
    ui.ws.close()
    await server.close()
  }
})
