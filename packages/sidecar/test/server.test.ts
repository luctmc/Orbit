import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startServer } from '../src/server.ts'
import { connect, ORIGIN, TOKEN } from './helpers.ts'

async function boot() {
  const dataDir = mkdtempSync(join(tmpdir(), 'orbit-data-'))
  const server = await startServer({ port: 0, token: TOKEN, allowedOrigins: [ORIGIN], dataDir, shell: '/bin/sh' })
  return { server, dataDir }
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

    // The command bar submits whole messages: pasted, then Enter.
    client.send({ type: 'pane.submit', paneId: pane.id, text: 'echo via-barra-$((1+1))' })
    await client.next('pane.data', (m) => m.paneId === pane.id && m.data.includes('via-barra-2'))

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
