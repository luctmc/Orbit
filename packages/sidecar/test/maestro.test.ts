import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Account, AccountLimits } from '@orbit/protocol'
import type { Run } from '../src/clis.ts'
import type { AgentLaunch } from '../src/command.ts'
import { chooseAccount, classifyTask, type AccountRoom } from '../src/maestro.ts'
import { DEFAULT_ROUTING } from '../src/routing.ts'
import { startServer } from '../src/server.ts'
import { connect, ORIGIN, TOKEN } from './helpers.ts'

const textOf = (result: unknown) => ((result as { content: Array<{ text: string }> }).content[0]?.text ?? '')

test('the maestro classifies activities the lead did not label', () => {
  const kind = (text: string) => classifyTask(text, DEFAULT_ROUTING.taskTypes).type.id
  assert.equal(kind('Escrever testes para o carrinho'), 'testes')
  assert.equal(kind('Corrigir o erro ao salvar o pedido'), 'bug')
  assert.equal(kind('Atualizar o README com a instalação'), 'documentacao')
  assert.equal(kind('Revisar o diff do #4 antes do merge'), 'revisao')
  assert.equal(kind('Descobrir por que o build está lento'), 'investigacao')
  assert.equal(kind('Refatorar o módulo de pagamento'), 'refatoracao')
  assert.equal(kind('Tela de configurações'), 'funcionalidade')
  const fallback = classifyTask('Fazer aquilo', DEFAULT_ROUTING.taskTypes)
  assert.deepEqual([fallback.type.id, fallback.via, fallback.sure], ['funcionalidade', 'padrão', false])
  const sure = classifyTask('Cobrir com testes o login', DEFAULT_ROUTING.taskTypes)
  assert.deepEqual([sure.via, sure.sure], ['palavra "testes"', true])
  // The title weighs more than a word in the details.
  assert.equal(classifyTask('Escreva em NOTAS.md como rodar o projeto e os testes', DEFAULT_ROUTING.taskTypes, 'Documentar a instalação').type.id, 'documentacao')
  // Two types close: not sure, so the maestro asks the decider.
  const close = classifyTask('Escreva em NOTAS.md como rodar o projeto e os testes', DEFAULT_ROUTING.taskTypes, 'Notas')
  assert.equal(close.sure, false)
  assert.match(close.via, /também/)
  // A custom type matches by its name.
  const custom = { ...DEFAULT_ROUTING.taskTypes[0]!, id: 'migracao', name: 'Migração de banco' }
  assert.equal(classifyTask('Fazer a migração das tabelas', [...DEFAULT_ROUTING.taskTypes, custom]).type.id, 'migracao')
})

const account = (p: Partial<Account>): Account => ({ id: 'a', cli: 'codex', name: 'A', kind: 'assinatura', builtin: false, baseUrl: null, model: null, keyHint: null, auto: true, createdAt: 1, ...p })
const room = (a: Account, used: number | null, live: number, full = false, resetsAt: number | null = null): AccountRoom => ({ account: a, used, live, full, resetsAt })

test('agents spread across accounts, API keys come last, and a used-up CLI says when it frees up', () => {
  const mine = account({ id: 'codex', builtin: true, name: 'Codex deste Mac' })
  const work = account({ id: 'work', name: 'Trabalho', createdAt: 2 })
  assert.equal(chooseAccount([room(mine, 10, 0), room(work, 20, 0)]).account!.id, 'codex')
  assert.equal(chooseAccount([room(mine, 10, 2), room(work, 20, 0)]).account!.id, 'work', 'two agents on it already weigh more than 10 points')
  assert.equal(chooseAccount([room(mine, null, 1), room(work, null, 0)]).account!.id, 'work', 'unread accounts still share the load')
  const api = account({ id: 'key', kind: 'api', name: 'Chave', keyHint: '…1234' })
  const choice = chooseAccount([room(mine, 99, 0, true, 5000), room(work, 97, 0, true, 3000), room(api, null, 0)])
  assert.equal(choice.account!.id, 'key')
  const none = chooseAccount([room(mine, 99, 0, true, 5000), room(work, 97, 0, true, 3000)])
  assert.deepEqual([none.account, none.exhausted, none.backAt], [null, true, 3000])
})

test('the maestro picks CLI and account by itself, falls back when one is used up, and the lead only orchestrates', async () => {
  const run: Run = async (command) => {
    if (command.endsWith('codex login status')) return { code: 0, stdout: 'Logged in using ChatGPT\n', stderr: '' }
    if (command.endsWith('claude auth status')) return { code: 0, stdout: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' }), stderr: '' }
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
    ui.send({ type: 'account.save', account: { cli: 'codex', name: 'Codex trabalho', kind: 'assinatura' } })
    const work = (await ui.next('accounts', (m) => m.accounts.some((a) => a.name === 'Codex trabalho'))).accounts.find((a) => a.name === 'Codex trabalho')!
    await ui.next('account.status', (m) => m.statuses.some((s) => s.accountId === work.id && s.loggedIn === true))

    ui.send({ type: 'workspace.open', path: realpathSync(mkdtempSync(join(tmpdir(), 'orbit-ws-'))) })
    const { workspace } = await ui.next('workspace.updated')
    ui.send({ type: 'mission.create', workspaceId: workspace.id, title: 'Maestro', objective: 'Cobrir o login com testes', mode: 'agentica', lead: { cli: 'claude', model: 'haiku', title: '' } })
    const { mission } = await ui.next('mission.updated')
    assert.deepEqual(mission.allowedClis, ['claude', 'codex'])
    const { pane: lead } = await ui.next('pane.updated', (m) => m.pane.role === 'lead')
    ui.send({ type: 'pane.input', paneId: lead.id, data: 'echo "TOKEN:$ORBIT_PANE_TOKEN:"\r' })
    const token = /TOKEN:([\w-]{20,}):/.exec((await ui.next('pane.data', (m) => m.paneId === lead.id && /TOKEN:[\w-]{20,}:/.test(m.data))).data)![1]!
    mcp = new Client({ name: 'test', version: '0' })
    await mcp.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }))
    const call = async (name: string, args: Record<string, unknown>) => textOf(await mcp!.callTool({ name, arguments: args }))
    const hook = async (payload: object) => {
      const res = await fetch(`http://127.0.0.1:${server.port}/hooks`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(payload) })
      return res.status === 200 ? res.json() : null
    }

    // The lead is reminded at every message and cannot edit files.
    assert.match((await hook({ hook_event_name: 'UserPromptSubmit', prompt: 'oi' })).hookSpecificOutput.additionalContext, /you are the maestro/)
    assert.equal((await hook({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: '/x' } })).hookSpecificOutput.permissionDecision, 'deny')
    assert.equal(await hook({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: '/x' } }), null)

    // Two test helpers without kind: classified as tests, sent to Codex, one per Codex account.
    const opened = await call('agent_spawn_many', { helpers: [{ title: 'Testes do login', task: 'Escreva testes para o login' }, { title: 'Testes do cadastro', task: 'Escreva testes para o cadastro' }] })
    assert.match(opened, /▸ tipo: Testes \(o maestro classificou; palavra "testes"\)/)
    assert.equal((opened.match(/▸ abriu: Codex/g) ?? []).length, 2)
    const helpers = (await ui.next('pane.updated', (m) => m.pane.title === 'Testes do cadastro')) && server.core.store.snapshot().panes.filter((p) => p.role === 'crew')
    assert.deepEqual(helpers.map((p) => p.accountId).sort(), ['codex', work.id].sort(), 'spread across both Codex accounts')

    // Close is refused while a helper has not delivered.
    assert.match(await call('agent_close', { agent: helpers[0]!.id }), /ainda não entregou/)
    assert.match(await call('agent_close', { agent: helpers[0]!.id, force: true }), /fechado/)

    // Every Codex account used up: the next test helper goes to Claude, and the receipt says why.
    const full = (accountId: string): AccountLimits => ({ accountId, cli: 'codex', fiveHour: { usedPercent: 99, resetsAt: Date.now() + 3_600_000, windowMinutes: 300 }, weekly: null, plan: null, updatedAt: Date.now() })
    server.core.store.setLimits(full('codex'))
    server.core.store.setLimits(full(work.id))
    const moved = await call('agent_spawn', { kind: 'testes', task: 'Mais testes' })
    assert.match(moved, /▸ Codex → Claude: todas as contas do Codex estão no limite/)
    assert.match(moved, /▸ abriu: Claude/)
    assert.match(textOf(await mcp.callTool({ name: 'accounts_status', arguments: {} })), /"full": true/)

    // Claude used up too: nothing opens, and the error says when an account frees up.
    server.core.store.setLimits({ ...full('claude'), cli: 'claude' })
    assert.match(await call('agent_spawn', { kind: 'testes', task: 'Ainda mais testes' }), /Não há conta do Codex com folga.*A primeira volta em (59 min|1 h)/)

    // A mission limited to Claude keeps helpers on Claude even when the table says Codex.
    server.core.store.setLimits({ ...full('claude'), cli: 'claude', fiveHour: { usedPercent: 10, resetsAt: Date.now() + 3_600_000, windowMinutes: 300 } })
    ui.send({ type: 'mission.create', workspaceId: workspace.id, title: 'Só Claude', objective: '', mode: 'agentica', allowedClis: ['claude'], lead: { cli: 'shell', model: null, title: '' } })
    const only = (await ui.next('mission.updated', (m) => m.mission.title === 'Só Claude')).mission
    const onlyLead = (await ui.next('pane.updated', (m) => m.pane.missionId === only.id && m.pane.role === 'lead')).pane
    const helper = await server.core.spawnHelper(onlyLead, { title: 'Testes', task: 'Escreva testes', model: null })
    assert.equal(helper.pane.cli, 'claude')
    assert.match(helper.receipt.join('\n'), /Codex → Claude: a missão não usa essa CLI/)
  } finally {
    delete process.env.CODEX_HOME
    delete process.env.CLAUDE_CONFIG_DIR
    await mcp?.close()
    ui.ws.close()
    await server.close()
  }
})
