import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OrbitCore } from '../src/core.ts'
import type { AgentLaunch } from '../src/command.ts'
import { Store } from '../src/store.ts'
import { contractHash, helperRequestHash } from '../src/activityLedger.ts'
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

test('a stable activity rejects changed instructions, model and effort instead of silently reusing work', async () => {
  const f = await fixture()
  try {
    const first = await f.core.spawnHelper(f.lead, f.input)
    const launched = f.launches.length
    assert.equal((await f.core.spawnHelper(f.lead, { ...f.input, title: 'Cosmetic title' })).pane.id, first.pane.id)
    for (const change of [{ task: 'Now edit the source.' }, { model: 'claude-opus-5-5' }, { effort: 'high' as const }, { difficulty: 'dificil' as const }]) {
      await assert.rejects(f.core.spawnHelper(f.lead, { ...f.input, ...change }), /pedido|instruções|modelo|contrato/i)
    }
    assert.equal(f.launches.length, launched)
    assert.equal(f.core.store.activityHistory(f.lead.missionId).attempts.length, 1)
  } finally { await f.core.shutdown() }
})

test('concurrent replays share one launch, but conflicting payloads and retry intentions do not', async () => {
  const f = await fixture()
  let release!: () => void
  const original = (f.core as any).prepareDesignContext
  ;(f.core as any).prepareDesignContext = () => new Promise<void>(r => { release = r })
  let first: ReturnType<OrbitCore['spawnHelper']> | undefined, same: ReturnType<OrbitCore['spawnHelper']> | undefined
  try {
    first = f.core.spawnHelper(f.lead, f.input)
    same = f.core.spawnHelper(f.lead, { ...f.input })
    for (const change of [{ task: 'Different request' }, { retryReason: 'Changed environment' }]) {
      const disposition = await Promise.race([f.core.spawnHelper(f.lead, { ...f.input, ...change }).then(() => 'resolved', () => 'rejected'), new Promise(r => setTimeout(() => r('pending'), 50))])
      assert.equal(disposition, 'rejected', 'a conflicting request must fail without waiting for the original launch')
    }
    release()
    assert.equal((await first).pane.id, (await same).pane.id)
    assert.equal(f.core.store.activityHistory(f.lead.missionId).attempts.length, 1)
  } finally { release?.(); await Promise.allSettled([first, same]); (f.core as any).prepareDesignContext = original; await f.core.shutdown() }
})

test('native resume does not repeat the original task; fresh reopen retains the assignment', async () => {
  const f = await fixture()
  try {
    const { pane } = await f.core.spawnHelper(f.lead, f.input)
    f.core.hookReport(pane.id, { hook_event_name: 'SessionStart', session_id: '11111111-2222-4333-8444-555555555555' })
    await f.core.handle({ type: 'pane.restart', paneId: pane.id, resume: true })
    assert.ok(f.launches.at(-1)!.launch.resume)
    assert.equal(f.launches.at(-1)!.task, '', 'native history already contains the assignment; reopening alone must not trigger a new turn')
    await f.core.handle({ type: 'pane.restart', paneId: pane.id, resume: false })
    assert.equal(f.launches.at(-1)!.launch.resume, undefined)
    assert.ok(f.launches.at(-1)!.task.includes(f.input.task), 'resuming must not overwrite the saved assignment')
  } finally { await f.core.shutdown() }
})

test('new leader gets project instructions once at launch; standalone recovery briefing remains self-contained', async () => {
  const f = await fixture()
  try {
    const marker = 'PROJECT_REQUIREMENT_KEEP_ALL_ACCEPTANCE_CRITERIA'
    f.core.store.updateWorkspace(f.core.store.mission(f.lead.missionId)!.workspaceId, { instructions: marker })
    const newLead = await f.core.changeLead(f.lead.missionId, { kind: 'new', cli: 'claude', model: null, effort: null, accountId: null })
    const launch = f.launches.at(-1)!
    assert.equal((`${launch.role}\n${launch.task}`.match(new RegExp(marker, 'g')) ?? []).length, 1)
    assert.ok(launch.task.includes('Preserve all requested work'))
    assert.ok(f.core.missionBriefing(newLead.missionId).includes(marker), 'after compaction, the recovery tool must still include the instructions')
  } finally { await f.core.shutdown() }
})

test('the first skill page includes selected task guidance even with a large eligible catalog', async () => {
  const f = await fixture()
  try {
    const { pane } = await f.core.spawnHelper(f.lead, f.input)
    const original = f.core.skillCatalog(pane, undefined, 50).items.find(i => i.name === 'orbit-build')!
    const resource = (await import('../src/skills.ts')).bundledCatalog().find(i => i.id === original.id)!.resource
    ;(f.core as any).catalogItems = Array.from({ length: 40 }, (_, i) => ({ id: `claude:skill:aaa-${i.toString().padStart(2, '0')}`, name: `aaa-${i}`, cli: 'claude', kind: 'skill', source: 'fixture', description: '', offInCli: false, resource: { ...resource, origin: 'personal' } }))
    const page = f.core.skillCatalog(pane)
    assert.ok(page.items.some(i => i.name === 'orbit-build' && i.selected))
    assert.ok(page.nextCursor)
    const second = f.core.skillCatalog(pane, page.nextCursor!)
    assert.equal(second.items.some(i => page.items.some(p => p.id === i.id)), false)
  } finally { await f.core.shutdown() }
})

test('request identity survives a sidecar restart and changed requests require a new explicit revision', async () => {
  const f = await fixture()
  const { pane } = await f.core.spawnHelper(f.lead, f.input)
  const key = f.core.delegationKey(f.input)
  await f.core.shutdown()
  const restored = new Store(join(f.root, 'data'))
  const request = { missionId: pane.missionId, key, title: f.input.title, contractHash: contractHash(f.input), requestHash: helperRequestHash(f.input), acceptance: [], retryReason: null, assignedBy: f.lead.id, requiresDelivery: true }
  assert.equal(restored.reserveActivity(request).attempt.paneId, pane.id)
  assert.throws(() => restored.reserveActivity({ ...request, requestHash: helperRequestHash({ ...f.input, task: 'New scope' }) }), /pedido.*mudou/i)
  const revised = restored.reserveActivity({ ...request, requestHash: helperRequestHash({ ...f.input, task: 'New scope' }), retryReason: 'User changed scope' })
  assert.equal(revised.activity.revision, 2)
  assert.notEqual(revised.attempt.paneId, pane.id)
  assert.equal(restored.reserveActivity({ ...request, requestHash: revised.attempt.requestHash, retryReason: 'User changed scope' }).attempt.id, revised.attempt.id)
  restored.flush()
})

test('old attempts without a verifiable request never trigger a blind new execution or silent reuse', async () => {
  const f = await fixture()
  try {
    const request = { missionId: f.lead.missionId, key: f.core.delegationKey(f.input), title: f.input.title, contractHash: contractHash(f.input), acceptance: [], retryReason: null, assignedBy: f.lead.id, requiresDelivery: true }
    f.core.store.reserveActivity(request)
    assert.throws(() => f.core.store.reserveActivity({ ...request, requestHash: helperRequestHash(f.input) }), /antigo.*fingerprint/i)
    assert.equal(f.core.store.activityHistory(f.lead.missionId).attempts.length, 1)
  } finally { await f.core.shutdown() }
})

test('Codex-only missions do not call a Claude classifier even for ambiguous work', async () => {
  const f = await fixture(true)
  try {
    let paidClassifierCommands = 0
    ;(f.core as any).run = async (cmd: string) => { if (cmd.includes('claude -p')) paidClassifierCommands++; return { code: 127, stdout: '', stderr: 'offline' } }
    // Admission may refuse absent synthetic CLI/account capacity; it must not spend on a
    // prohibited provider on its way there. No real provider is invoked by this test.
    await f.core.spawnHelper(f.lead, { title: 'Request', task: 'Handle the pending item carefully', model: null, readOnly: true }).catch(() => null)
    assert.equal(paidClassifierCommands, 0)
    assert.equal(f.core.store.auxiliaryCalls(f.lead.missionId).length, 0)
  } finally { await f.core.shutdown() }
})

test('explicit missing skills fail before creating a process, while exact eligible IDs are served once', async () => {
  const f = await fixture()
  try {
    const routing = f.core.store.routing()
    const row = routing.taskTypes.find(t => t.id === 'testes')!
    Object.assign(row, { automatic: false, cli: 'claude', model: null, effort: null, skills: ['absent-package'], onlySkills: true })
    f.core.store.saveRouting(routing)
    const launches = f.launches.length
    await assert.rejects(f.core.spawnHelper(f.lead, { ...f.input, taskTypeId: row.id }), /skill.*indisponível/i)
    assert.equal(f.launches.length, launches)
    row.skills = ['claude:skill:orbit-verify', 'claude:skill:orbit-verify']
    routing.revision = f.core.store.routing().revision
    f.core.store.saveRouting(routing)
    const { pane } = await f.core.spawnHelper(f.lead, { ...f.input, activityId: 'available-skill', taskTypeId: row.id })
    const skill = f.core.skillCatalog(pane).items.find(i => i.id === row.skills[0])!
    assert.ok(skill.selected && skill.loaded)
    assert.equal(f.launches.at(-1)!.role.split('Skill orbit-verify (sha256').length - 1, 1)
  } finally { await f.core.shutdown() }
})

test('fresh conversations never replay a completed or subsequently reassigned task', async () => {
  const f = await fixture()
  try {
    const { pane } = await f.core.spawnHelper(f.lead, f.input)
    f.core.handoff(pane, { summary: 'Complete', evidence: 'offline check' })
    await f.core.handle({ type: 'pane.restart', paneId: pane.id, resume: false })
    assert.equal(f.launches.at(-1)!.task.includes(f.input.task), false, 'completion must not be turned into another execution')
    const reopened = f.core.store.pane(pane.id)!
    f.core.handoff(reopened, { summary: 'Still complete', evidence: 'offline check' })
    f.core.sendTo(f.lead, pane.id, 'A distinct follow-up assignment')
    assert.equal(f.core.store.currentPaneAttempt(pane.id)?.requestHash, undefined)
    await f.core.handle({ type: 'pane.restart', paneId: pane.id, resume: false })
    assert.equal(f.launches.at(-1)!.task.includes(f.input.task), false, 'a new assignment cannot recover the old one as current')
  } finally { await f.core.shutdown() }
})

test('fresh leaders receive current mission state rather than a saved obsolete objective', async () => {
  const f = await fixture()
  try {
    const lead = await f.core.changeLead(f.lead.missionId, { kind: 'new', cli: 'claude', model: null, effort: null, accountId: null })
    f.core.store.updateMission(lead.missionId, { objective: 'CURRENT_OBJECTIVE_WITH_UPDATED_SCOPE' })
    await f.core.handle({ type: 'pane.restart', paneId: lead.id, resume: false })
    assert.ok(f.launches.at(-1)!.task.includes('CURRENT_OBJECTIVE_WITH_UPDATED_SCOPE'))
    assert.equal(f.launches.at(-1)!.task.includes('Preserve all requested work'), false)
  } finally { await f.core.shutdown() }
})
