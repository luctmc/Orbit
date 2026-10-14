import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Card } from '@orbit/protocol'
import { startServer } from '../src/server.ts'
import { connect, offline, ORIGIN, TOKEN } from './helpers.ts'

const textOf = (result: unknown) => ((result as { content: Array<{ text: string }> }).content[0]?.text ?? '')

test('the person and the agents share one board per mission', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'orbit-data-'))
  const server = await startServer({ port: 0, token: TOKEN, allowedOrigins: [ORIGIN], dataDir, shell: '/bin/sh', run: offline, browser: null })
  const ui = connect(server.port)
  let mcp: Client | null = null
  try {
    await ui.opened
    ui.send({ type: 'workspace.open', path: realpathSync(mkdtempSync(join(tmpdir(), 'orbit-ws-'))) })
    const { workspace } = await ui.next('workspace.updated')
    ui.send({ type: 'mission.create', workspaceId: workspace.id, title: 'Quadro', objective: '', mode: 'agentica', lead: { cli: 'shell', model: null, title: 'Líder' } })
    const { mission } = await ui.next('mission.updated')
    const { pane: lead } = await ui.next('pane.updated', (m) => m.pane.role === 'lead')

    // The person adds two cards.
    ui.send({ type: 'card.add', missionId: mission.id, title: 'Mapear o login' })
    ui.send({ type: 'card.add', missionId: mission.id, title: 'Escrever testes', notes: 'cobrir o token expirado' })
    const first = (await ui.next('card.updated', (m) => m.card.title === 'Mapear o login')).card
    const second = (await ui.next('card.updated', (m) => m.card.title === 'Escrever testes')).card
    assert.deepEqual([first.number, first.column, first.order, first.createdBy], [1, 'afazer', 0, 'você'])
    assert.deepEqual([second.number, second.order], [2, 1])

    // The lead reads, adds, takes and finishes cards through MCP.
    ui.send({ type: 'pane.input', paneId: lead.id, data: 'echo "TOKEN:$ORBIT_PANE_TOKEN:"\r' })
    const token = /TOKEN:([\w-]{20,}):/.exec((await ui.next('pane.data', (m) => m.paneId === lead.id && /TOKEN:[\w-]{20,}:/.test(m.data))).data)![1]!
    mcp = new Client({ name: 'test', version: '0' })
    await mcp.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }))
    const call = async (name: string, args: Record<string, unknown> = {}) => textOf(await mcp!.callTool({ name, arguments: args }))

    assert.deepEqual(JSON.parse(await call('board_list')).map((c: { card: string }) => c.card), ['T1', 'T2'])
    const added = JSON.parse(await call('board_add', { title: 'Revisar o PR', column: 'fazendo' }))
    assert.deepEqual([added.card, added.column], ['T3', 'fazendo'])
    await ui.next('card.updated', (m) => m.card.number === 3 && m.card.createdBy === `#${lead.id}`)

    const taken = JSON.parse(await call('board_update', { card: 'T1', column: 'fazendo', assignee: 'eu' }))
    assert.deepEqual([taken.column, taken.assignee], ['fazendo', `#${lead.id}`])
    await ui.next('card.updated', (m) => m.card.number === 1 && m.card.column === 'fazendo' && m.card.assignee === lead.id && m.card.order === 1)
    assert.match(await call('board_update', { card: 9, column: 'feito' }), /Não há o cartão T9/)
    assert.match(await call('board_update', { card: 2, assignee: 999 }), /não é um agente desta missão/)

    // The person drags T2 to the top of "fazendo".
    ui.send({ type: 'card.move', cardId: second.id, column: 'fazendo', index: 0 })
    const moved = await ui.next('card.updated', (m) => m.card.id === second.id && m.card.column === 'fazendo')
    assert.equal(moved.card.order, 0)
    const order = JSON.parse(await call('board_list')).filter((c: { column: string }) => c.column === 'fazendo').map((c: { card: string }) => c.card)
    assert.deepEqual(order, ['T2', 'T3', 'T1'])

    ui.send({ type: 'card.update', cardId: second.id, title: 'Escrever os testes do token', assignee: null })
    await ui.next('card.updated', (m) => m.card.title === 'Escrever os testes do token')
    ui.send({ type: 'card.delete', cardId: first.id })
    await ui.next('card.removed', (m) => m.cardId === first.id)
    ui.send({ type: 'card.move', cardId: second.id, column: 'arquivo' as Card['column'] })
    assert.match((await ui.next('error')).message, /Coluna inválida/)
    ui.send({ type: 'card.add', missionId: mission.id, title: '   ' })
    assert.match((await ui.next('error', (m) => /título/.test(m.message))).message, /título do cartão/)

    // The board survives a restart.
    ui.ws.close()
    await mcp.close()
    mcp = null
    await server.close()
    const again = await startServer({ port: 0, token: TOKEN, allowedOrigins: [ORIGIN], dataDir, shell: '/bin/sh', run: offline, browser: null })
    const ui2 = connect(again.port)
    try {
      const { snapshot } = await ui2.next('snapshot')
      assert.deepEqual(snapshot.cards.map((c) => `T${c.number}`).sort(), ['T2', 'T3'])
    } finally {
      ui2.ws.close()
      await again.close()
    }
  } finally {
    await mcp?.close()
    ui.ws.close()
    await server.close().catch(() => {})
  }
})
