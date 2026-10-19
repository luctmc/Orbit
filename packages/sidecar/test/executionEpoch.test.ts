import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './r2Fixture.ts'
import { request } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startServer } from '../src/server.ts'
import { ORIGIN, TOKEN, offline } from './helpers.ts'

test('a replaced execution cannot submit its old result into the current attempt', async () => {
  const f = await fixture()
  try {
    assert.ok(f.pane.executionEpoch)
    await f.core.handle({ type: 'pane.restart', paneId: f.pane.id, resume: false })
    assert.notEqual(f.core.store.pane(f.pane.id)?.executionEpoch, f.pane.executionEpoch)
    assert.throws(() => f.core.handoff(f.pane, { summary: 'Old result', evidence: 'exit 0' }), /execução|execution/i)
    assert.equal(f.core.store.activityHistory(f.pane.missionId).results.length, 0)
  } finally { await f.core.shutdown() }
})

test('late hooks and usage from an old execution are refused after restart', async () => {
  const f = await fixture()
  try {
    await f.core.handle({ type: 'pane.restart', paneId: f.pane.id, resume: false })
    assert.throws(() => f.core.hookReport(f.pane.id, { hook_event_name: 'Notification', message: 'Old approval' }, f.pane.executionEpoch), /execução|execution/i)
    assert.throws(() => f.core.statusReport(f.pane.id, { context_window: { total_input_tokens: 999 } }, f.pane.executionEpoch), /execução|execution/i)
    assert.equal(f.core.store.pane(f.pane.id)?.attention, null)
    assert.equal(f.core.store.mission(f.pane.missionId)?.usage.total, 0)
  } finally { await f.core.shutdown() }
})

test('a captured caller from a completed assignment cannot finish new work in the same process', async () => {
  const f = await fixture()
  try {
    const tokens = (f.core as unknown as { paneTokens: Map<string, number> }).paneTokens
    const token = [...tokens].find(([, id]) => id === f.pane.id)![0]
    const captured = f.core.identify(token)!
    f.core.handoff(captured, { summary: 'First result', evidence: 'exit 0' })
    f.core.sendTo(f.lead, f.pane.id, 'A new independent activity', true)
    assert.throws(() => f.core.handoff(captured, { summary: 'Late result', evidence: 'old evidence' }), /execução|tentativa/)
    assert.throws(() => f.core.handoff(f.core.identify(token)!, { summary: 'Reposted old result', evidence: 'old evidence', attemptId: captured.activityAttemptId }), /tentativa/)
    assert.equal(f.core.pendingDeliveries(f.pane.missionId).length, 1)
  } finally { await f.core.shutdown() }
})

test('a result without a live leader commits a pending notification with its result', async () => {
  const f = await fixture()
  try {
    f.core.handle({ type: 'pane.close', paneId: f.lead.id })
    const result = f.core.handoff(f.pane, { summary: 'Durable result', evidence: 'exit 0' })
    const notices = f.core.store.notifications(f.pane.missionId)
    assert.equal(notices[0]?.resultId, result.resultId)
    assert.equal(notices[0]?.state, 'persisted')
  } finally { await f.core.shutdown() }
})

test('a late progress report cannot reopen a delivered attempt', async () => {
  const f = await fixture()
  try {
    f.core.handoff(f.pane, { summary: 'Done', evidence: 'exit 0' })
    assert.throws(() => f.core.handoff(f.pane, { summary: 'Late progress', status: 'progress' }), /entreg|tentativa/)
    assert.equal(f.core.store.pane(f.pane.id)?.handoffStatus, 'done')
    assert.equal(f.core.store.activityHistory(f.pane.missionId).results.length, 1)
    assert.equal(f.core.pendingDeliveries(f.pane.missionId).length, 0)
  } finally { await f.core.shutdown() }
})

test('HTTP revalidates hooks, status and MCP authenticated before a slow body when execution changes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orbit-http-epoch-'))
  const server = await startServer({ port: 0, token: TOKEN, allowedOrigins: [ORIGIN], dataDir: join(root, 'data'), shell: '/bin/sh', run: offline, browser: null, scheduler: false,
    agentCommand: () => ({ file: '/bin/sh', args: ['-c', 'while read line; do :; done'] }) })
  try {
    const core = server.core
    core.handle({ type: 'workspace.open', path: root })
    core.handle({ type: 'mission.create', workspaceId: core.store.snapshot().workspaces[0]!.id, title: 'HTTP fence', objective: '', mode: 'livre', lead: { cli: 'shell', model: null, title: 'Lead' } })
    const lead = core.store.snapshot().panes.find(p => p.role === 'lead')!
    const identify = core.identify.bind(core)
    for (const [path, mode] of ['/hooks', '/status', '/mcp'].flatMap(path => [[path, 'restart'] as const, [path, 'exit'] as const])) {
      const { pane } = await core.spawnHelper(lead, { title: path, task: `Synthetic request ${path} ${mode}`, cli: 'claude', readOnly: true, model: null })
      const tokens = (core as unknown as { paneTokens: Map<string, number> }).paneTokens
      const token = [...tokens].find(([, id]) => id === pane.id)![0]
      let authenticated!: () => void
      const ready = new Promise<void>(resolve => { authenticated = resolve })
      core.identify = value => { const caller = identify(value); authenticated(); return caller }
      const body = JSON.stringify({ hook_event_name: 'Notification', message: 'stale', context_window: { total_input_tokens: 999 }, jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'handoff_submit', arguments: { summary: 'stale', evidence: 'exit 0' } } })
      let req!: ReturnType<typeof request>
      const response = new Promise<number>((resolve, reject) => {
        req = request({ host: '127.0.0.1', port: server.port, path, method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode!)) })
        req.on('error', reject)
      })
      req.write(body.slice(0, 1))
      await Promise.race([ready, new Promise((_, reject) => setTimeout(() => reject(new Error('authentication timeout')), 5000).unref())])
      if (mode === 'restart') await core.handle({ type: 'pane.restart', paneId: pane.id, resume: false })
      else {
        ;(core as unknown as { panes: { kill: (id: number) => void } }).panes.kill(pane.id)
        for (let n = 0; n < 100 && core.store.pane(pane.id)?.status !== 'exited'; n++) await new Promise(r => setTimeout(r, 10))
        assert.equal(core.store.pane(pane.id)?.status, 'exited')
      }
      req.end(body.slice(1))
      assert.equal(await response, 409, path)
      assert.equal(core.store.pane(pane.id)?.attention, null)
      assert.equal(core.store.mission(pane.missionId)?.usage.total, 0)
      assert.equal(core.store.activityHistory(pane.missionId).results.length, 0)
    }
  } finally { await server.close() }
})
