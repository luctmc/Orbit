import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'
import type { ClientMessage, ServerMessage } from '@orbit/protocol'
import { startServer } from '../src/server.ts'

const ORIGIN = 'http://localhost:5273'
const TOKEN = 'test-token-0123456789'

async function boot() {
  const dataDir = mkdtempSync(join(tmpdir(), 'orbit-data-'))
  const server = await startServer({ port: 0, token: TOKEN, allowedOrigins: [ORIGIN], dataDir, shell: '/bin/sh' })
  return { server, dataDir }
}

function connect(port: number, token = TOKEN, origin = ORIGIN) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`, { origin })
  const inbox: ServerMessage[] = []
  const waiters: Array<() => void> = []
  ws.on('message', (raw) => {
    inbox.push(JSON.parse(String(raw)) as ServerMessage)
    for (const wake of waiters.splice(0)) wake()
  })
  const next = async <T extends ServerMessage['type']>(type: T, match: (m: Extract<ServerMessage, { type: T }>) => boolean = () => true, timeoutMs = 5000) => {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const found = inbox.find((m): m is Extract<ServerMessage, { type: T }> => m.type === type && match(m as Extract<ServerMessage, { type: T }>))
      if (found) return found
      if (Date.now() > deadline) throw new Error(`timeout waiting for ${type}`)
      await new Promise<void>((resolve) => {
        waiters.push(resolve)
        setTimeout(resolve, 50)
      })
    }
  }
  const send = (message: ClientMessage) => ws.send(JSON.stringify(message))
  return { ws, inbox, next, send, opened: new Promise<void>((resolve, reject) => { ws.once('open', () => resolve()); ws.once('error', reject) }) }
}

test('rejects a connection without the token or from another origin', async () => {
  const { server } = await boot()
  try {
    await assert.rejects(connect(server.port, 'wrong').opened, /401/)
    await assert.rejects(connect(server.port, TOKEN, 'https://evil.example').opened, /401/)
  } finally {
    await server.close()
  }
})

test('creates a mission whose lead pane runs a real shell', async () => {
  const { server, dataDir } = await boot()
  const client = connect(server.port)
  try {
    await client.opened
    const { snapshot } = await client.next('snapshot')
    assert.deepEqual(snapshot.missions, [])

    const folder = realpathSync(mkdtempSync(join(tmpdir(), 'orbit-ws-')))
    client.send({ type: 'workspace.open', path: folder })
    const { workspace } = await client.next('workspace.updated')
    assert.equal(workspace.path, folder)

    client.send({ type: 'mission.create', workspaceId: workspace.id, title: 'Teste', objective: 'eco', mode: 'livre', lead: { cli: 'shell', model: null, title: '' } })
    const { mission } = await client.next('mission.updated')
    const { pane } = await client.next('pane.updated', (m) => m.pane.missionId === mission.id)
    assert.equal(pane.role, 'lead')
    assert.equal(pane.cwd, folder)

    client.send({ type: 'pane.input', paneId: pane.id, data: 'echo ORBIT_$((40+2)) $ORBIT_PANE_ID; pwd\r' })
    await client.next('pane.data', (m) => m.paneId === pane.id && m.data.includes(`ORBIT_42 ${pane.id}`))
    await client.next('event.added', (m) => m.event.kind === 'pane.spawned' && m.event.paneId === pane.id)

    client.send({ type: 'pane.close', paneId: pane.id })
    await client.next('pane.removed', (m) => m.paneId === pane.id)

    client.send({ type: 'pane.spawn', request: { missionId: mission.id, role: 'crew', cli: 'claude', model: 'bad model', title: '' } })
    const error = await client.next('error')
    assert.match(error.message, /Modelo inválido/)
  } finally {
    client.ws.close()
    await server.close()
  }
  const persisted = JSON.parse(readFileSync(join(dataDir, 'state.json'), 'utf8'))
  assert.equal(persisted.missions.length, 1)
  assert.equal(persisted.panes.length, 0)
})
