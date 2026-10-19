import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OrbitCore } from '../src/core.ts'
import type { AgentLaunch } from '../src/command.ts'
import './helpers.ts'

async function fixture(codexOnly = false) {
  const root = mkdtempSync(join(tmpdir(), 'orbit-continuity-'))
  const launches: Array<{ launch: AgentLaunch; task: string; role: string }> = []
  const core = new OrbitCore({ dataDir: join(root, 'data'), shell: '/bin/sh', browser: null,
    broadcast: () => {}, run: async () => ({ code: 127, stdout: '', stderr: 'offline' }),
    agentCommand: launch => {
      launches.push({ launch, task: launch.taskPath ? readFileSync(launch.taskPath, 'utf8') : '', role: launch.rolePromptPath ? readFileSync(launch.rolePromptPath, 'utf8') : '' })
      return { file: '/bin/sh', args: ['-c', 'while read line; do :; done'] }
    } })
  core.setEndpoint('http://127.0.0.1:1')
  core.handle({ type: 'workspace.open', path: root })
  await core.handle({ type: 'mission.create', workspaceId: core.store.snapshot().workspaces[0]!.id,
    title: 'Continuity', objective: 'Preserve all requested work', allowOriginal: true, mode: codexOnly ? 'agentica' : 'livre', allowedClis: codexOnly ? ['codex'] : undefined, lead: { cli: 'shell', model: null, title: 'Lead' } })
  const lead = core.store.snapshot().panes[0]!
  const input = { title: 'Research', task: 'Read the complete source, then report evidence.', activityId: 'source-research', cli: 'claude' as const, model: null, readOnly: true }
  return { root, core, launches, lead, input }
}

test('informative messages preserve completed delivery and readiness; explicit work reopens once', async () => {
  const f = await fixture()
  try {
    const { pane } = await f.core.spawnHelper(f.lead, f.input)
    f.core.handoff(pane, { summary: 'Complete', evidence: 'offline source inspection' })
    f.core.store.updateMission(pane.missionId, { readyAt: 123, readySummary: 'Verified' })
    const before = f.core.store.activityHistory(pane.missionId)
    let assignments = 0
    const originalAssign = (f.core as any).assign.bind(f.core)
    ;(f.core as any).assign = (...args: unknown[]) => { assignments++; return originalAssign(...args) }
    for (const text of ['ACK', 'Please wait', 'Which file?']) f.core.sendTo(f.lead, pane.id, text)
    assert.equal(assignments, 0, 'three informative messages create zero assignments')
    assert.equal(f.core.store.pane(pane.id)!.handoffStatus, 'done')
    assert.equal(f.core.store.mission(pane.missionId)!.readyAt, 123)
    assert.deepEqual(f.core.store.activityHistory(pane.missionId), before)
    assert.equal(f.core.hookReport(pane.id, { hook_event_name: 'Stop' }), null)
    f.core.sendTo(f.lead, pane.id, 'New work', true)
    assert.equal(assignments, 1, 'explicit newTask creates exactly one assignment')
    assert.equal(f.core.store.pane(pane.id)!.handoffStatus, null)
    assert.equal(f.core.pendingDeliveries(pane.missionId).length, 1)
    assert.equal(f.core.store.deliveries(pane.missionId).length, 2)
    assert.equal(f.core.store.mission(pane.missionId)!.readyAt, null)
  } finally { await f.core.shutdown() }
})

test('pending messages preserve obligation and invalid newTask never submits', async () => {
  const f = await fixture()
  try {
    const { pane } = await f.core.spawnHelper(f.lead, f.input)
    const before = f.core.store.activityHistory(pane.missionId)
    f.core.sendTo(f.lead, pane.id, 'ACK')
    assert.equal(f.core.pendingDeliveries(pane.missionId).length, 1)
    assert.deepEqual(f.core.store.activityHistory(pane.missionId), before)
    let submitted = 0
    ;(f.core as any).submitTo = () => { submitted++; return true }
    assert.throws(() => f.core.sendTo(pane, f.lead.id, 'Unauthorized work', true), /líder|tarefa/i)
    assert.equal(submitted, 0)
    const other = await f.core.spawnHelper(f.lead, { ...f.input, activityId: 'other-helper', task: 'Inspect a separate file' })
    let interrupted = 0
    ;(f.core as any).panes.write = () => { interrupted++ }
    await assert.rejects(f.core.interrupt(pane, other.pane.id, 'Unauthorized task'), /líder|tarefa/)
    assert.equal(interrupted, 0)
  } finally { await f.core.shutdown() }
})

test('implicit resume rejects final done and auto but progress can recover', async () => {
  const f = await fixture()
  try {
    const { pane } = await f.core.spawnHelper(f.lead, f.input)
    f.core.hookReport(pane.id, { hook_event_name: 'SessionStart', session_id: '11111111-2222-4333-8444-555555555555' })
    f.core.handoff(pane, { summary: 'Complete', evidence: 'offline check' })
    const count = f.launches.length
    await assert.rejects(f.core.resumeHelper(f.lead, pane.id, null), /handoff_list.*newTask|newTask.*handoff_list/)
    assert.equal(f.launches.length, count)
    const explicit = await f.core.resumeHelper(f.lead, pane.id, 'New explicit work')
    assert.equal(f.launches.length, count + 1)
    f.core.handoff(explicit, { summary: 'Checkpoint', status: 'progress' })
    f.core.sendTo(f.lead, pane.id, 'ACK checkpoint')
    assert.equal(f.core.store.pane(pane.id)!.handoffStatus, 'progress')
    ;(f.core as any).panes.report(pane.id, 'idle', null)
    const resumed = await f.core.resumeHelper(f.lead, pane.id, null)
    assert.equal(resumed.id, pane.id)
    assert.equal(f.core.pendingDeliveries(pane.missionId).length, 1)
  } finally { await f.core.shutdown() }
})

test('Stop without a reliable active flag nudges once then preserves automatic evidence', async () => {
  const f = await fixture()
  try {
    const { pane } = await f.core.spawnHelper(f.lead, f.input)
    const first = f.core.hookReport(pane.id, { hook_event_name: 'Stop' }) as { decision: string }
    assert.equal(first.decision, 'block')
    assert.equal(f.core.hookReport(pane.id, { hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: 'Evidence survives fallback' }), null)
    assert.equal(f.core.hookReport(pane.id, { hook_event_name: 'Stop' }), null)
    assert.equal(f.core.store.pane(pane.id)!.handoffStatus, 'auto')
    assert.match(f.core.store.activityHistory(pane.missionId).results.at(-1)!.summary, /Evidence survives fallback/)
    await assert.rejects(f.core.resumeHelper(f.lead, pane.id, null), /handoff_list/)
    f.core.sendTo(f.lead, pane.id, 'New assignment', true)
    assert.equal((f.core.hookReport(pane.id, { hook_event_name: 'Stop' }) as { decision: string }).decision, 'block')
    f.core.handoff(f.core.store.pane(pane.id)!, { summary: 'Progress remains pending', status: 'progress' })
    assert.equal(f.core.hookReport(pane.id, { hook_event_name: 'Stop' }), null)
    assert.equal(f.core.pendingDeliveries(pane.missionId).length, 1)
  } finally { await f.core.shutdown() }
})

test('legacy final handoffs without an ActivityResult cannot implicitly restart', async () => {
  const f = await fixture()
  try {
    const { pane } = await f.core.spawnHelper(f.lead, f.input)
    f.core.handoff(pane, { summary: 'Legacy complete', evidence: 'retained evidence' })
    ;(f.core.store as any).state.activityLedger.results = []
    const count = f.launches.length
    for (const status of ['done', 'auto']) {
      ;(f.core as any).panes.setHandoff(pane.id, { status })
      await assert.rejects(f.core.resumeHelper(f.lead, pane.id, null), /handoff_list/)
    }
    assert.equal(f.launches.length, count)
  } finally { await f.core.shutdown() }
})
