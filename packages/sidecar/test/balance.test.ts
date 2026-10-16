import { test } from 'node:test'
import { initRepository } from './gitFixture.ts'
import assert from 'node:assert/strict'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { EFFORTS, type Account, type AccountLimits, type Effort } from '@orbit/protocol'
import type { Run } from '../src/clis.ts'
import type { AgentLaunch } from '../src/command.ts'
import { cliLoad, seatForDifficulty, type AccountRoom } from '../src/maestro.ts'
import { DEFAULT_ROUTING } from '../src/routing.ts'
import { startServer } from '../src/server.ts'
import { connect, ORIGIN, TOKEN, HOMES } from './helpers.ts'

const textOf = (result: unknown) => ((result as { content: Array<{ text: string }> }).content[0]?.text ?? '')
const claudeLevels = () => ['low', 'medium', 'high', 'xhigh', 'max'] as Effort[]

test('the load of a CLI is its freest subscription, counting the agents on it; used-up ones do not count', () => {
  const acc = (id: string, kind: Account['kind'] = 'assinatura'): Account => ({ id, cli: 'codex', name: id, kind, builtin: false, baseUrl: null, model: null, keyHint: '…', auto: true, createdAt: 1 })
  const room = (a: Account, used: number | null, live: number, full = false): AccountRoom => ({ account: a, used, live, full, resetsAt: null })
  assert.equal(cliLoad([room(acc('a'), 40, 1), room(acc('b'), 70, 0)]), 55)
  assert.equal(cliLoad([room(acc('a'), 99, 0, true), room(acc('k', 'api'), null, 0)]), null)
  assert.equal(cliLoad([room(acc('a'), null, 0)]), null, 'unknown quota cannot participate as zero load')
})

test('difficulty moves the seat inside the CLI: cheaper model for simple work, stronger model or more effort for hard work', () => {
  assert.deepEqual(seatForDifficulty('claude', 'claude-sonnet-5-5', 'medium', 'simples', claudeLevels), { model: 'claude-haiku-5-5', effort: 'low', changed: true })
  assert.deepEqual(seatForDifficulty('claude', 'claude-sonnet-5-5', 'medium', 'dificil', claudeLevels), { model: 'claude-opus-5-5', effort: 'high', changed: true })
  assert.deepEqual(seatForDifficulty('claude', 'claude-opus-5-5', 'high', 'dificil', claudeLevels), { model: 'claude-opus-5-5', effort: 'xhigh', changed: true })
  assert.deepEqual(seatForDifficulty('claude', 'claude-sonnet-5-5', 'medium', 'normal', claudeLevels), { model: 'claude-sonnet-5-5', effort: 'medium', changed: false })
  // Codex: no ladder Orbit knows; effort moves, within what the model takes.
  const luna = () => ['low', 'medium', 'high', 'xhigh', 'max'] as Effort[]
  assert.deepEqual(seatForDifficulty('codex', null, 'medium', 'dificil', luna), { model: null, effort: 'high', changed: true })
  assert.deepEqual(seatForDifficulty('codex', null, null, 'simples', luna), { model: null, effort: 'low', changed: true })
  assert.deepEqual(seatForDifficulty('codex', null, 'max', 'dificil', luna), { model: null, effort: 'max', changed: false })
  // Gemini has no effort: only the model moves.
  assert.deepEqual(seatForDifficulty('gemini', 'flash', null, 'dificil', () => []), { model: 'pro', effort: null, changed: true })
  assert.ok(EFFORTS.includes('ultra'))
})

test('the maestro shares work across CLIs by load, uses the table\'s equivalent, and tiers by difficulty', async () => {
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
  process.env.CLAUDE_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'claude-home-'))
  process.env.CODEX_HOME = mkdtempSync(join(tmpdir(), 'codex-home-'))
  const server = await startServer({ port: 0, token: TOKEN, allowedOrigins: [ORIGIN], dataDir: mkdtempSync(join(tmpdir(), 'orbit-data-')), shell: '/bin/sh', run, agentCommand: fake, browser: null, scheduler: false })
  const ui = connect(server.port)
  let mcp: Client | null = null
  try {
    await ui.opened
    assert.deepEqual(server.core.store.routing().taskTypes.find((t) => t.id === 'bug')!.alt, DEFAULT_ROUTING.taskTypes.find((t) => t.id === 'bug')!.alt)
    ui.send({ type: 'workspace.open', path: initRepository(realpathSync(mkdtempSync(join(tmpdir(), 'orbit-ws-')))) })
    const { workspace } = await ui.next('workspace.updated')
    ui.send({ type: 'mission.create', workspaceId: workspace.id, title: 'Carga', objective: '', mode: 'agentica', isolation: 'worktrees', lead: { cli: 'shell', model: null, title: 'Líder' } })
    const { pane: lead } = await ui.next('pane.updated', (m) => m.pane.role === 'lead')
    const screen = server.core as unknown as { panes: { screenText: (id: number, lines: number) => string } }
    ui.send({ type: 'pane.input', paneId: lead.id, data: 'clear; echo "TOKEN:$ORBIT_PANE_TOKEN:"\r' })
    let token = ''
    for (let i = 0; i < 100 && !token; i++) {
      token = /TOKEN:([\w-]{20,}):/.exec(screen.panes.screenText(lead.id, 50).replaceAll('\n', ''))?.[1] ?? ''
      if (!token) await new Promise((r) => setTimeout(r, 30))
    }
    mcp = new Client({ name: 'test', version: '0' })
    await mcp.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }))
    const spawn = async (args: Record<string, unknown>) => textOf(await mcp!.callTool({ name: 'agent_spawn', arguments: args }))
    const limits = (accountId: string, cli: AccountLimits['cli'], used: number): AccountLimits => ({ accountId, cli, fiveHour: { usedPercent: used, resetsAt: Date.now() + 3_600_000, windowMinutes: 300 }, weekly: null, plan: null, updatedAt: Date.now() })

    // Both free: the table decides (bug → Claude).
    assert.match(await spawn({ title: 'Bug 1', task: 'Corrija o erro do login', kind: 'bug' }), /▸ abriu: Claude · claude-sonnet-5-5/)

    // Claude much busier than Codex: the bug goes to the table's Codex equivalent, and the receipt says why.
    server.core.store.setLimits(limits('claude', 'claude', 80))
    server.core.store.setLimits(limits('codex', 'codex', 10))
    const moved = await spawn({ title: 'Bug 2', task: 'Corrija o erro do cadastro', kind: 'bug' })
    assert.match(moved, /▸ Claude → Codex: Claude com carga 95, Codex com 10 \(uso da conta \+ 15 por agente rodando\): foi para o equivalente da tabela/)
    assert.match(moved, /▸ abriu: Codex · modelo padrão · esforço médio/)

    // Close enough: it stays where the table says.
    server.core.store.setLimits(limits('claude', 'claude', 30))
    assert.match(await spawn({ title: 'Bug 3', task: 'Corrija o erro do carrinho', kind: 'bug' }), /▸ abriu: Claude/)

    // Difficulty: hard goes up the ladder, simple down; a model the lead named stays.
    server.core.store.setLimits(limits('claude', 'claude', 0))
    server.core.store.setLimits(limits('codex', 'codex', 60))
    const hard = await spawn({ title: 'Bug difícil', task: 'Corrija a condição de corrida no pagamento', kind: 'bug', difficulty: 'dificil' })
    assert.match(hard, /▸ dificuldade: difícil \(líder\) → claude-opus-5-5, esforço alto/)
    assert.match(hard, /▸ abriu: Claude · claude-opus-5-5 · esforço alto/)
    // Reopened, it keeps the seat it really had, not the table's.
    const hardId = Number(/#(\d+) Bug difícil/.exec(hard)![1])
    ui.send({ type: 'pane.restart', paneId: hardId, resume: false })
    await ui.next('event.added', (m) => m.event.title === `#${hardId} reaberto numa conversa nova`)
    assert.deepEqual([launches.at(-1)!.cli, launches.at(-1)!.model, launches.at(-1)!.effort], ['claude', 'claude-opus-5-5', 'high'])
    assert.match(await spawn({ title: 'Docs', task: 'Corrija um erro de digitação no README', kind: 'documentacao', difficulty: 'simples' }), /▸ abriu: Claude · claude-haiku-5-5 · esforço baixo/)
    const named = await spawn({ title: 'Nomeado', task: 'Corrija o erro do login', agent: 'claude', model: 'claude-sonnet-5-5', difficulty: 'dificil' })
    assert.doesNotMatch(named, /dificuldade/)
    assert.equal(launches.at(-1)!.model, 'claude-sonnet-5-5')
  } finally {
    process.env.CLAUDE_CONFIG_DIR = HOMES.claude
    process.env.CODEX_HOME = HOMES.codex
    await mcp?.close()
    ui.ws.close()
    await server.close()
  }
})
