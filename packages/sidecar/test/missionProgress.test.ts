import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixture } from './r2Fixture.ts'
import { acceptSyntheticResult } from './reviewFixture.ts'
import { startServer } from '../src/server.ts'
import { connect, ORIGIN, TOKEN, offline } from './helpers.ts'

test('mission progress retains delivery and review identity and observes stale final source without changing historical acceptance', async () => {
  const { core, pane, lead, root, create } = await fixture()
  let probes = 0
  ;(core as any).run = async () => { probes++; throw new Error('A status read cannot call a model or probe') }
  try {
    writeFileSync(join(root, 'source.ts'), 'export const n = 1\n')
    const { resultId } = core.handoff(pane, { summary: 'Synthetic delivery', evidence: 'Synthetic lifecycle test' })
    const pending = core.missionProgress(lead.missionId)
    assert.equal(pending.activities.find(a => a.id === core.store.currentPaneAttempt(pane.id)?.activityId)?.state, 'awaiting_validation')
    assert.equal(pending.integration.state, 'pending')
    assert.equal(pending.deliveries[0]?.resultId, resultId)
    assert.equal(pending.results[0]?.id, resultId)
    acceptSyntheticResult(core, lead, resultId)
    core.missionReady(lead, 'Synthetic verified result', false)
    const accepted = core.missionProgress(lead.missionId)
    assert.equal(accepted.integration.state, 'current')
    assert.ok(accepted.integration.reviewId)
    writeFileSync(join(root, 'source.ts'), 'export const n = 2\n')
    assert.equal(core.missionProgress(lead.missionId).integration.state, 'stale')
    assert.equal(core.store.verifications(lead.missionId).at(-1)?.verdict, 'accepted')
    assert.ok(core.store.mission(lead.missionId)?.readyAt, 'reading does not erase the historical declaration')
    core.closeHelper(lead, pane.id, true)
    assert.equal(core.missionProgress(lead.missionId).results[0]?.id, resultId)
    assert.equal(probes, 0)
    await core.shutdown()
    const restored = create()
    try {
      assert.equal(restored.missionProgress(lead.missionId).integration.state, 'stale')
      assert.equal(restored.missionProgress(lead.missionId).results[0]?.id, resultId)
    } finally { await restored.shutdown() }
  } finally { await core.shutdown() }
})

test('progress replies correlate failures and success to the requesting UI without broadcasting or mutating the ledger', async () => {
  const { core, lead } = await fixture()
  try {
    const replies: any[] = []
    const before = JSON.stringify(core.store.activityHistory(lead.missionId))
    core.handle({ type: 'mission.progress', missionId: lead.missionId, requestId: 'progress-ok' }, m => replies.push(m))
    assert.equal(replies[0].type, 'mission.progress')
    assert.equal(replies[0].requestId, 'progress-ok')
    assert.equal(replies[0].progress.missionId, lead.missionId)
    core.handle({ type: 'mission.progress', missionId: 'missing', requestId: 'progress-error' }, m => replies.push(m))
    assert.equal(replies[1].type, 'mission.progress.error')
    assert.equal(replies[1].requestId, 'progress-error')
    assert.equal(JSON.stringify(core.store.activityHistory(lead.missionId)), before)
  } finally { await core.shutdown() }
})

test('authenticated WebSocket progress replies only to its requester and correlates missing-mission errors', async () => {
  const server = await startServer({ port: 0, token: TOKEN, allowedOrigins: [ORIGIN], dataDir: mkdtempSync(join(tmpdir(), 'orbit-progress-ws-')), shell: '/bin/sh', browser: null, scheduler: false, run: offline })
  const first = connect(server.port), second = connect(server.port)
  try {
    await Promise.all([first.opened, second.opened])
    first.send({ type: 'workspace.open', path: mkdtempSync(join(tmpdir(), 'orbit-progress-source-')) })
    const { workspace } = await first.next('workspace.updated')
    first.send({ type: 'mission.create', workspaceId: workspace.id, title: 'Progress', objective: '', mode: 'livre', lead: { cli: 'shell', model: null, title: 'Lead' } })
    const { mission } = await first.next('mission.updated')
    first.send({ type: 'mission.progress', missionId: mission.id, requestId: 'ws-progress' })
    const reply = await first.next('mission.progress', m => m.requestId === 'ws-progress')
    assert.equal(reply.progress.missionId, mission.id)
    assert.equal(reply.progress.integration.state, 'none')
    first.send({ type: 'mission.progress', missionId: 'missing', requestId: 'ws-missing' })
    const error = await first.next('mission.progress.error', m => m.requestId === 'ws-missing')
    assert.match(error.message, /inexistente/i)
    assert.equal(second.inbox.some(m => m.type === 'mission.progress' || m.type === 'mission.progress.error'), false)
  } finally { first.ws.close(); second.ws.close(); await server.close() }
})
