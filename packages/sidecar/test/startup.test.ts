import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OrbitCore } from '../src/core.ts'
import { startServer } from '../src/server.ts'
import { connect, offline, ORIGIN, TOKEN } from './helpers.ts'

test('transport and snapshot are ready while crew recovery is still pending', async () => {
  const original = OrbitCore.prototype.resumeCrews
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  OrbitCore.prototype.resumeCrews = () => pending
  const opening = startServer({ port: 0, token: TOKEN, allowedOrigins: [ORIGIN],
    dataDir: mkdtempSync(join(tmpdir(), 'orbit-startup-')), shell: '/bin/sh', run: offline, browser: null, scheduler: false })
  let timer: NodeJS.Timeout | undefined
  try {
    const server = await Promise.race([opening, new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 500) })])
    assert.ok(server, 'transport readiness must not await crew recovery')
    const ui = connect(server.port)
    try { await ui.opened; await ui.next('snapshot', () => true, 500) }
    finally { ui.ws.close() }
  } finally {
    if (timer) clearTimeout(timer)
    release()
    OrbitCore.prototype.resumeCrews = original
    await (await opening).close()
  }
})
