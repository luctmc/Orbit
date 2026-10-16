import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, realpathSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startServer } from '../src/server.ts'
import { Store } from '../src/store.ts'
import { connect, ORIGIN, TOKEN } from './helpers.ts'

test('delegations are idempotent across concurrent calls, completion, close and restart', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'orbit-adaptive-'))
  const server = await startServer({ port: 0, token: TOKEN, allowedOrigins: [ORIGIN], dataDir, shell: '/bin/sh',
    run: async () => ({ code: 127, stdout: '', stderr: 'offline' }), browser: null, scheduler: false })
  const ui = connect(server.port)
  try {
    await ui.opened
    ui.send({ type: 'workspace.open', path: realpathSync(mkdtempSync(join(tmpdir(), 'orbit-ws-'))) })
    const { workspace } = await ui.next('workspace.updated')
    ui.send({ type: 'mission.create', workspaceId: workspace.id, title: 'Adaptive', objective: '', mode: 'agentica', lead: { cli: 'shell', model: null, title: '' } })
    const { pane: lead } = await ui.next('pane.updated', (m) => m.pane.role === 'lead')
    const input = { title: 'Build', task: 'Execute npm run build', cli: 'shell' as const, model: null }
    const [first, duplicate] = await Promise.all([server.core.spawnHelper(lead, input), server.core.spawnHelper(lead, { ...input, title: 'Build again' })])
    assert.equal(duplicate.pane.id, first.pane.id, 'same work must not open another process')
    assert.match(duplicate.receipt.join('\n'), /reutiliz/)
    server.core.handoff(first.pane, { summary: 'Build checked', status: 'done', evidence: 'npm run build: exit 0' })
    const returns = server.core.missionEvents(lead.missionId, 'handoff').length
    server.core.handoff(first.pane, { summary: 'Build checked', status: 'done', evidence: 'npm run build: exit 0' })
    assert.equal(server.core.missionEvents(lead.missionId, 'handoff').length, returns, 'retries must not wake the leader twice')
    server.core.handle({ type: 'pane.close', paneId: first.pane.id })
    assert.equal((await server.core.spawnHelper(lead, input)).pane.id, first.pane.id, 'completed work survives closing its terminal')
    server.core.store.flush()
    const restored = new Store(dataDir)
    assert.equal(restored.delegation(lead.missionId, server.core.delegationKey(input))?.pane.id, first.pane.id)
    assert.equal(restored.delegation(lead.missionId, server.core.delegationKey(input))?.result?.evidence, 'npm run build: exit 0')
    restored.upsertPane({ ...first.pane, handoffStatus: null, deliveredAt: null })
    assert.equal(restored.delegation(lead.missionId, server.core.delegationKey(input))?.pane.handoffStatus, 'done', 'new work in the same terminal cannot reopen a completed activity')
    const retry = await server.core.spawnHelper(lead, { ...input, retryReason: 'Source changed after the verified build' })
    assert.notEqual(retry.pane.id, first.pane.id)
    // A new folder/acceptance contract is different work; a title is only presentation.
    const different = await server.core.spawnHelper(lead, { ...input, accept: ['Check bundle size'] })
    assert.notEqual(different.pane.id, retry.pane.id)
    const identity = { ...input, activityId: 'T42' }
    const identified = await server.core.spawnHelper(lead, identity)
    assert.equal((await server.core.spawnHelper(lead, { ...identity, task: 'Same activity, phrased differently' })).pane.id, identified.pane.id)
    const sameRetry = await server.core.spawnHelper(lead, { ...input, retryReason: 'Source changed after the verified build' })
    assert.equal(sameRetry.pane.id, retry.pane.id, 'repeating a justified retry also stays idempotent')
  } finally {
    ui.ws.close()
    await server.close()
  }
})

test('automatic leader, inferred helper seats, explicit overrides and attachment acknowledgements cross the real WebSocket', async () => {
  const launched: Array<{ cli: string; model: string | null; effort?: string | null }> = []
  const server = await startServer({ port: 0, token: TOKEN, allowedOrigins: [ORIGIN], dataDir: mkdtempSync(join(tmpdir(), 'orbit-wire-')), shell: '/bin/sh', browser: null, scheduler: false,
    run: async (command) => ({ code: 0, stdout: command.includes('auth status') ? '{"loggedIn":true,"authMethod":"claude.ai"}' : command.includes('login status') ? 'Logged in using ChatGPT' : '', stderr: '' }),
    agentCommand: (launch, shell) => { launched.push(launch); return { file: shell, args: ['-c', `exec ${shell}`] } } })
  const ui = connect(server.port)
  try {
    await ui.opened
    ui.send({ type: 'workspace.open', path: realpathSync(mkdtempSync(join(tmpdir(), 'orbit-ws-'))) })
    const { workspace } = await ui.next('workspace.updated')
    ui.send({ type: 'mission.create', workspaceId: workspace.id, title: 'Run build', objective: 'Execute npm run build', mode: 'agentica', adaptiveLead: true, lead: { cli: 'claude', model: 'claude-opus-5-5', effort: 'high', title: '' } })
    const { pane: lead } = await ui.next('pane.updated', (m) => m.pane.role === 'lead')
    assert.equal(lead.model, 'claude-haiku-5-5')
    assert.equal(lead.effort, 'low', 'the leader of a simple command also avoids high effort')
    const helper = await server.core.spawnHelper(lead, { title: 'Run build', task: 'Execute npm run build', taskTypeId: 'operacao', model: null })
    assert.equal(helper.pane.effort, 'low', 'known kind still gets inferred difficulty')
    const pinned = await server.core.spawnHelper(lead, { title: 'User model', task: 'Inspect checkout', taskTypeId: 'bug', cli: 'codex', model: 'user-custom-model', effort: 'high', readOnly: true })
    assert.deepEqual([pinned.pane.cli, pinned.pane.model, pinned.pane.effort], ['codex', 'user-custom-model', 'high'])
    assert.ok(launched.length >= 3)
    const bytes = Buffer.from([0, 255, 1, 42])
    ui.send({ type: 'attachment.add', paneId: lead.id, requestId: 'upload-1', name: 'image.png', mime: 'image/png', data: bytes.toString('base64') })
    const { attachment } = await ui.next('attachment.added', (m) => m.requestId === 'upload-1')
    assert.deepEqual(readFileSync(attachment.path), bytes)
    ui.send({ type: 'pane.submit', paneId: lead.id, requestId: 'submit-1', text: 'echo QA_OK', attachments: [attachment.id] })
    assert.equal((await ui.next('pane.submitted', (m) => m.requestId === 'submit-1')).paneId, lead.id)
    ui.send({ type: 'pane.submit', paneId: lead.id, requestId: 'submit-bad', text: 'x', attachments: ['../bad'] })
    assert.match((await ui.next('pane.submit.error', (m) => m.requestId === 'submit-bad')).message, /Anexo/)
    ui.send({ type: 'pane.submit', paneId: lead.id, requestId: 'submit-long', text: 'x'.repeat(20_001) })
    assert.match((await ui.next('pane.submit.error', (m) => m.requestId === 'submit-long')).message, /20.000/)
    ui.send({ type: 'pane.conversation', paneId: lead.id })
    assert.deepEqual((await ui.next('pane.conversation')).turns, [])
  } finally { ui.ws.close(); await server.close() }
})
