import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Mission } from '@orbit/protocol'
import type { Run } from '../src/clis.ts'
import type { AgentLaunch } from '../src/command.ts'
import { crewRole } from '../src/prompts.ts'
import { DEFAULT_ROUTING, normalizeRouting } from '../src/routing.ts'
import { startServer } from '../src/server.ts'
import { findCodexRolloutById } from '../src/usage.ts'
import { seedRoutingQuota, connect, ORIGIN, TOKEN, HOMES } from './helpers.ts'

const textOf = (result: unknown) => ((result as { content: Array<{ text: string }> }).content[0]?.text ?? '')

test('each kind of work carries its method to any CLI, and reading kinds are read-only', () => {
  const review = DEFAULT_ROUTING.taskTypes.find((t) => t.id === 'revisao')!
  assert.equal(review.readOnly, true)
  assert.match(review.method, /Try to refute it/)
  assert.equal(DEFAULT_ROUTING.taskTypes.find((t) => t.id === 'bug')!.readOnly, false)
  const saved = normalizeRouting({ ...DEFAULT_ROUTING, taskTypes: [{ ...review, method: '  1. Leia.  ', readOnly: true }] })
  assert.deepEqual([saved.taskTypes[0]!.method, saved.taskTypes[0]!.readOnly], ['1. Leia.', true])
  const mission = { title: 'M' } as Mission
  const role = crewRole(mission, { id: 3 }, { children: 2 }, undefined, review)
  assert.match(role, /How to do this kind of work:\n1\. Do not edit files/)
  assert.match(role, /Assignment scope: inspect and report/)
  assert.match(role, /up to 2 sub-helpers/)
  assert.doesNotMatch(crewRole(mission, { id: 4 }, {}, undefined, review), /sub-helpers/)
})

test('helpers answer acceptance criteria, open sub-helpers within a cap, and the lead asks the person', async () => {
  const run: Run = async (command) => {
    if (command.endsWith('codex login status')) return { code: 0, stdout: 'Logged in using ChatGPT\n', stderr: '' }
    if (command.endsWith('claude auth status')) return { code: 0, stdout: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' }), stderr: '' }
    if (command.includes('read-codex-limits.mjs')) return { code: 0, stdout: JSON.stringify({ rateLimits: { primary: { usedPercent: 97, windowDurationMins: 300, resetsAt: Math.floor(Date.now() / 1000) + 3600 }, secondary: null } }), stderr: '' }
    return { code: 127, stdout: '', stderr: 'offline' }
  }
  const fake = (_launch: AgentLaunch, shell: string) => ({ file: shell, args: ['-c', `exec ${shell}`] })
  const dataDir = mkdtempSync(join(tmpdir(), 'orbit-data-'))
  const codexHome = mkdtempSync(join(tmpdir(), 'codex-home-'))
  process.env.CODEX_HOME = codexHome
  process.env.CLAUDE_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'claude-home-'))
  // Session lookup remains available, but current quota comes from the provider query above.
  const now = new Date()
  const day = join(codexHome, 'sessions', String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0'))
  mkdirSync(day, { recursive: true })
  const session = '0199aaaa-bbbb-7ccc-8ddd-eeeeffff0000'
  writeFileSync(join(day, `rollout-2026-10-14T08-00-00-${session}.jsonl`), `${JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: null, rate_limits: { primary: { used_percent: 97, window_minutes: 300, resets_at: Math.floor(Date.now() / 1000) + 3600 }, secondary: null } } })}\n`)
  assert.match(findCodexRolloutById(codexHome, session)!, new RegExp(`${session}\\.jsonl$`))

  const server = await startServer({ port: 0, token: TOKEN, allowedOrigins: [ORIGIN], dataDir, shell: '/bin/sh', run, agentCommand: fake, browser: null, scheduler: false })
  const ui = connect(server.port)
  const clients: Client[] = []
  try {
    await ui.opened
    for (let i = 0; i < 100 && !server.core.store.limits().some((l) => l.accountId === 'codex'); i++) await new Promise((r) => setTimeout(r, 30))
    assert.equal(server.core.store.limits().find((l) => l.accountId === 'codex')?.fiveHour?.usedPercent, 97)

    const api = realpathSync(mkdtempSync(join(tmpdir(), 'orbit-api-')))
    ui.send({ type: 'workspace.create', name: 'Loja', folders: [realpathSync(mkdtempSync(join(tmpdir(), 'orbit-ws-'))), api] })
    const { workspace } = await ui.next('workspace.updated')
    ui.send({ type: 'mission.create', workspaceId: workspace.id, title: 'Qualidade', objective: '', mode: 'agentica', lead: { cli: 'shell', model: null, title: 'Líder' } })
    const { mission } = await ui.next('mission.updated')
    const { pane: lead } = await ui.next('pane.updated', (m) => m.pane.role === 'lead')
    await seedRoutingQuota(server.core)

    const screen = server.core as unknown as { panes: { screenText: (id: number, lines: number) => string } }
    const sees = async (paneId: number, text: string, polls = 100) => {
      for (let i = 0; i < polls; i++) {
        if (screen.panes.screenText(paneId, 200).replaceAll('\n', '').includes(text)) return
        await new Promise((r) => setTimeout(r, 30))
      }
      throw new Error(`#${paneId} never showed: ${text}`)
    }
    const tokenOf = async (paneId: number) => {
      ui.send({ type: 'pane.input', paneId, data: 'clear; echo "TOKEN:$ORBIT_PANE_TOKEN:"\r' })
      for (let i = 0; i < 100; i++) {
        const found = /TOKEN:([\w-]{20,}):/.exec(screen.panes.screenText(paneId, 200).replaceAll('\n', ''))
        if (found) return found[1]!
        await new Promise((r) => setTimeout(r, 30))
      }
      throw new Error(`no token from #${paneId}`)
    }
    const mcpAs = async (token: string) => {
      const client = new Client({ name: 'test', version: '0' })
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }))
      clients.push(client)
      const call = async (name: string, args: Record<string, unknown>) => textOf(await client.callTool({ name, arguments: args }))
      return { call, tools: async () => (await client.listTools()).tools.map((t) => t.name) }
    }
    const hook = async (token: string, payload: object) => {
      const res = await fetch(`http://127.0.0.1:${server.port}/hooks`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(payload) })
      return res.status === 200 ? res.json() : null
    }
    const pane = (id: number) => server.core.store.pane(id)!
    const leadToken = await tokenOf(lead.id)
    const asLead = await mcpAs(leadToken)

    // A read-only kind: Claude's edit tools are refused; the flow keeps the receipt.
    const auditId = Number(/#(\d+) /.exec(await asLead.call('agent_spawn', { title: 'Auditar', task: 'Descubra por que o build é lento', kind: 'investigacao' }))![1])
    const auditToken = await tokenOf(auditId)
    assert.equal(await hook(auditToken, { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: '/x' } }), null)
    assert.equal(await hook(auditToken, { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: '/x' } }), null)
    const opened = server.core.missionEvents(mission.id).find((e) => e.kind === 'pane.spawned' && e.paneId === auditId)!
    assert.match(opened.body, /▸ tipo: Investigação \(escolhido pelo líder\)[\s\S]*▸ conta: /)

    // Work in another repository of the workspace: the helper starts there.
    const inApi = await asLead.call('agent_spawn', { title: 'API', task: 'Leia o endpoint', kind: 'bug', folder: api, readOnly: true })
    assert.match(inApi, new RegExp(`▸ pasta: ${api}`))
    assert.equal(pane(Number(/#(\d+) API/.exec(inApi)![1])).cwd, api)

    // Acceptance criteria: done has to answer each one, and all must hold.
    const reply = await asLead.call('agent_spawn', { title: 'Corrigir', task: 'Corrija o erro do carrinho', kind: 'bug', accept: ['os testes passam', 'o README cita a correção'] })
    assert.match(reply, /▸ critérios de aceite: 2/)
    const fixId = Number(/#(\d+) Corrigir/.exec(reply)![1])
    const asFix = await mcpAs(await tokenOf(fixId))
    // The fake shell does not emit the native CLI's SessionStart hook on its own.
    server.core.hookReport(fixId, { hook_event_name: 'SessionStart' })
    assert.match(await asFix.call('handoff_submit', { summary: 'Feito', evidence: 'npm test' }), /faltam 1, 2/)
    assert.match(await asFix.call('handoff_submit', { summary: 'Feito', evidence: 'npm test', criteria: [{ item: 1, met: true, how: 'npm test: 9 ok' }, { item: 2, met: false, how: 'ainda não' }] }), /critério 2 não foi cumprido/)

    // The helper splits its work: up to two sub-helpers, whose results come back to it.
    assert.ok((await asFix.tools()).includes('agent_spawn'))
    const child = await asFix.call('agent_spawn', { title: 'README', task: 'Revise a proposta para o README', kind: 'documentacao', readOnly: true })
    const childId = Number(/#(\d+) README/.exec(child)![1])
    assert.match(child, /▸ tipo: Documentação \(escolhido pelo ajudante #\d+\)/)
    assert.equal(pane(childId).assignedBy, fixId)
    await asFix.call('agent_spawn', { title: 'Teste extra', task: 'Revise um teste de borda', readOnly: true })
    assert.match(await asFix.call('agent_spawn', { title: 'Mais um', task: 'x' }), /já tem 2 sub-ajudantes/)
    const asChild = await mcpAs(await tokenOf(childId))
    assert.ok(!(await asChild.tools()).includes('agent_spawn'), 'sub-helpers do not open their own')
    await new Promise(r => setTimeout(r, 1300)) // native input must be idle after its initial paint
    await asChild.call('handoff_submit', { summary: 'README atualizado', evidence: 'git diff README.md' })
    await sees(fixId, `Retorno de #${childId} (README)`)
    assert.match(await asFix.call('agent_close', { agent: auditId }), /só fecha os seus/)
    assert.match(await asFix.call('agent_close', { agent: childId }), /fechado/)

    const done = sees(lead.id, `Retorno de #${fixId} (Corrigir)`, 300)
    assert.match(await asFix.call('handoff_submit', { summary: 'Feito', evidence: 'npm test', criteria: [{ item: 1, met: true, how: 'npm test: 9 ok' }, { item: 2, met: true, how: 'README.md linha 12' }] }), /Resultado persistido/)
    await done
    await sees(lead.id, 'rios: 2/2')
    assert.match(server.core.missionEvents(mission.id, 'handoff').at(-1)!.body, /Critérios de aceite:\n✓ 1\. os testes passam: npm test: 9 ok\n✓ 2\./)

    // The lead asks the person: waiting with choices until the person answers, whatever the hooks say.
    assert.match(await asLead.call('ask_user', { question: 'Posso apagar o cache?', choices: ['Sim', 'Não'] }), /Pergunta feita/)
    const asked = (await ui.next('pane.updated', (m) => m.pane.id === lead.id && m.pane.status === 'waiting')).pane
    assert.deepEqual([asked.attention, asked.choices], ['Posso apagar o cache?', ['Sim', 'Não']])
    await ui.next('event.added', (m) => m.event.kind === 'pane.waiting' && m.event.paneId === lead.id)
    await hook(leadToken, { hook_event_name: 'Stop', stop_hook_active: false })
    assert.equal(pane(lead.id).status, 'waiting')
    ui.send({ type: 'pane.submit', paneId: lead.id, text: 'Sim' })
    const answered = (await ui.next('pane.updated', (m) => m.pane.id === lead.id && m.pane.status !== 'waiting')).pane
    assert.deepEqual([answered.attention, answered.choices], [null, null])
  } finally {
    process.env.CODEX_HOME = HOMES.codex
    process.env.CLAUDE_CONFIG_DIR = HOMES.claude
    for (const client of clients) await client.close()
    ui.ws.close()
    await server.close()
  }
})
