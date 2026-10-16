import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createConnection } from 'node:net'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startServer } from '../src/server.ts'
import { offline, ORIGIN, TOKEN } from './helpers.ts'

test('an incomplete agent request cannot keep the sidecar alive during shutdown', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orbit-shutdown-'))
  const server = await startServer({ port: 0, token: TOKEN, allowedOrigins: [ORIGIN], dataDir: root,
    shell: '/bin/sh', run: offline, browser: null, scheduler: false })
  server.core.handle({ type: 'workspace.open', path: root })
  const workspace = server.core.store.snapshot().workspaces[0]!
  server.core.handle({ type: 'mission.create', workspaceId: workspace.id, title: 'Shutdown', objective: '',
    mode: 'livre', lead: { cli: 'shell', model: null, title: 'Lead' } })
  const secrets = server.core as unknown as { paneTokens: Map<string, number> }
  const token = secrets.paneTokens.keys().next().value!
  const socket = createConnection({ host: '127.0.0.1', port: server.port })
  socket.on('error', () => {})
  let closing: Promise<void> | undefined
  let timeout: NodeJS.Timeout | undefined
  try {
    await once(socket, 'connect')
    socket.write(`POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:${server.port}\r\nAuthorization: Bearer ${token}\r\nContent-Type: application/json\r\nContent-Length: 1000\r\n\r\n{`)
    await new Promise(r => setTimeout(r, 20))
    closing = server.close()
    const done = await Promise.race([closing.then(() => true), new Promise<boolean>(resolve => { timeout = setTimeout(() => resolve(false), 1000) })])
    assert.equal(done, true, 'shutdown must close active HTTP requests, not wait for their body forever')
  } finally {
    if (timeout) clearTimeout(timeout)
    socket.destroy()
    await (closing ?? server.close())
  }
})
