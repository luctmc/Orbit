import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startServer } from '../src/server.ts'
import { connect, offline, ORIGIN, TOKEN } from './helpers.ts'

test('UI spawn reports correlated failure without a pane and acknowledges successful creation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orbit-spawn-receipt-'))
  const server = await startServer({ port: 0, token: TOKEN, allowedOrigins: [ORIGIN], dataDir: root, shell: '/bin/sh', run: offline, browser: null })
  const ui = connect(server.port)
  try {
    await ui.opened
    ui.send({ type: 'workspace.open', path: root })
    const { workspace } = await ui.next('workspace.updated')
    ui.send({ type: 'mission.create', workspaceId: workspace.id, title: 'UI receipt', objective: '', mode: 'livre', lead: { cli: 'shell', model: null, title: 'Lead' } })
    const { pane: lead } = await ui.next('pane.updated')
    const request = { missionId: lead.missionId, role: 'crew' as const, cli: 'shell' as const, model: null, title: 'Preserved draft' }
    const before = server.core.store.snapshot().panes.length
    ui.send({ type: 'pane.spawn', requestId: 'failure', request: { ...request, missionId: 'missing' } })
    const failure = await ui.next('pane.spawn.error', m => m.requestId === 'failure')
    assert.match(failure.message, /Missão inexistente/)
    assert.equal(server.core.store.snapshot().panes.length, before)
    ui.send({ type: 'pane.spawn', requestId: 'success', request })
    const receipt = await ui.next('pane.spawned', m => m.requestId === 'success')
    assert.equal(receipt.pane.title, request.title)
    assert.equal(server.core.store.snapshot().panes.length, before + 1)
    assert.equal(server.core.store.pane(receipt.pane.id)?.executionEpoch, receipt.pane.executionEpoch)
    // Lost ACK / retry must not launch the same effect twice.
    await server.core.handle({ type: 'pane.spawn', requestId: 'success', request }, m => {
      assert.equal(m.type, 'pane.spawned')
      if (m.type === 'pane.spawned') assert.equal(m.pane.id, receipt.pane.id)
    })
    assert.equal(server.core.store.snapshot().panes.length, before + 1)
    const expired: any[] = []
    await server.core.handle({ type: 'pane.spawn', requestId: 'expired', expiresAt: Date.now() - 1, request }, m => expired.push(m))
    assert.equal(expired[0].type, 'pane.spawn.error')
    assert.match(expired[0].message, /expirou/)
    assert.equal(server.core.store.snapshot().panes.length, before + 1)
    const { Store } = await import('../src/store.ts')
    const recovered = new Store(root)
    assert.equal(recovered.uiSpawn('success')?.paneId, receipt.pane.id)
    // Older clients still get the generic error instead of losing it silently.
    ui.send({ type: 'pane.spawn', request: { ...request, missionId: 'missing' } })
    assert.match((await ui.next('error')).message, /Missão inexistente/)
  } finally { ui.ws.close(); await server.close() }
})
