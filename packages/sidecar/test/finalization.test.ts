import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { VerificationInput } from '@orbit/protocol'
import type { OrbitCore } from '../src/core.ts'
import { fixture } from './r2Fixture.ts'

const review = (inspection: ReturnType<OrbitCore['inspectResult']>): VerificationInput => ({ inspectionId: inspection.id, verdict: 'accepted', summary: 'Synthetic lifecycle review', checks: [{ command: 'synthetic fixture observation', exitCode: 0, summary: 'Fixture contract observed' }], criteria: inspection.acceptance.map((_, i) => ({ item: i + 1, met: true, how: 'Synthetic fixture observation' })) })
async function finalFixture() {
  const f = await fixture()
  const result = f.core.handoff(f.pane, { summary: 'Synthetic delivery', evidence: 'Synthetic fixture observation' })
  f.core.verifyResult(f.lead, review(f.core.inspectResult(f.lead, result.resultId)))
  return { ...f, resultId: result.resultId, inspection: f.core.inspectResult(f.lead, result.resultId, 'integration') }
}

test('final review and mission completion commit together and replay keeps the same receipt and event', async () => {
  const f = await finalFixture()
  try {
    const input = review(f.inspection)
    const record = (f.core.verifyResult as any)(f.lead, input, 'Synthetic mission completed')
    assert.ok(record.completion)
    const mission = f.core.store.mission(f.lead.missionId)!
    assert.equal(mission.readyAt, record.completion.readyAt)
    assert.equal(mission.readySummary, record.completion.summary)
    const disk = JSON.parse(readFileSync(join(f.root, 'data/state.json'), 'utf8'))
    assert.equal(disk.missions.find((m: any) => m.id === mission.id).readyAt, record.completion.readyAt)
    assert.equal(disk.verifications.find((v: any) => v.id === record.id).completion.eventId, record.completion.eventId)
    assert.ok(disk.events.some((e: any) => e.id === record.completion.eventId && e.kind === 'mission.ready'))
    const again = (f.core.verifyResult as any)(f.lead, input, 'Synthetic mission completed')
    assert.deepEqual(again, record)
    assert.equal(f.core.missionEvents(mission.id, 'mission.ready').length, 1)
    assert.equal(f.core.store.memory(mission.workspaceId).filter(m => m.id === record.completion.eventId).length, 1)
    assert.throws(() => (f.core.verifyResult as any)(f.lead, input, 'Different completion intent'), /resumo|conclusão/)
    assert.equal(f.core.store.mission(mission.id)!.readyAt, record.completion.readyAt)
  } finally { await f.core.shutdown() }
})

test('combined completion refuses helper, result scope, non-accepted verdict and incomplete evidence without mutations', async () => {
  const f = await finalFixture()
  try {
    const before = JSON.stringify(f.core.store.verifications(f.lead.missionId))
    const input = review(f.inspection)
    assert.throws(() => (f.core.verifyResult as any)(f.pane, input, 'No helper completion'), /líder/)
    const resultInspection = f.core.inspectResult(f.lead, f.resultId)
    assert.throws(() => (f.core.verifyResult as any)(f.lead, review(resultInspection), 'Wrong scope'), /integração/)
    assert.throws(() => (f.core.verifyResult as any)(f.lead, { ...input, verdict: 'unverified' }, 'Not accepted'), /aceit/)
    assert.throws(() => (f.core.verifyResult as any)(f.lead, input, '  '), /resumo/)
    assert.throws(() => (f.core.verifyResult as any)(f.lead, { ...input, checks: [] }, 'Missing checks'), /Aceite/)
    assert.throws(() => (f.core.verifyResult as any)(f.lead, { ...input, criteria: [] }, 'Missing criteria'), /Aceite/)
    assert.equal(JSON.stringify(f.core.store.verifications(f.lead.missionId)), before)
    assert.equal(f.core.store.mission(f.lead.missionId)!.readyAt, null)
  } finally { await f.core.shutdown() }
})

test('source changes, new work and stale caller cannot finalize an old inspection', async () => {
  const f = await finalFixture()
  try {
    writeFileSync(join(f.root, 'source.ts'), 'changed after inspection')
    assert.throws(() => (f.core.verifyResult as any)(f.lead, review(f.inspection), 'Stale source'), /mud/)
    const current = f.core.inspectResult(f.lead, f.resultId, 'integration')
    await f.core.spawnHelper(f.lead, { title: 'Pending activity', task: 'Independent read', cli: 'claude', model: null, readOnly: true })
    assert.throws(() => (f.core.verifyResult as any)(f.lead, review(current), 'Pending work'), /contratos|atividades|retorno/)
    await f.core.handle({ type: 'pane.restart', paneId: f.lead.id, resume: false })
    assert.throws(() => (f.core.verifyResult as any)(f.lead, review(current), 'Old caller'), /execução/)
    assert.equal(f.core.store.verifications(f.lead.missionId).length, 1)
    assert.equal(f.core.store.mission(f.lead.missionId)!.readyAt, null)
  } finally { await f.core.shutdown() }
})

test('disk failure rolls back final verdict, ready state and ready event in one transaction', async () => {
  const f = await finalFixture()
  const blocked = join(f.root, 'data/state.json.tmp')
  try {
    const before = readFileSync(join(f.root, 'data/state.json'), 'utf8')
    mkdirSync(blocked)
    assert.throws(() => (f.core.verifyResult as any)(f.lead, review(f.inspection), 'Durable completion'))
    assert.equal(f.core.store.verifications(f.lead.missionId).length, 1)
    assert.equal(f.core.store.mission(f.lead.missionId)!.readyAt, null)
    assert.equal(f.core.missionEvents(f.lead.missionId, 'mission.ready').length, 0)
    assert.equal(readFileSync(join(f.root, 'data/state.json'), 'utf8'), before)
    rmSync(blocked, { recursive: true })
    const saved = (f.core.verifyResult as any)(f.lead, review(f.inspection), 'Durable completion')
    assert.ok(saved.completion)
  } finally { rmSync(blocked, { recursive: true, force: true }); await f.core.shutdown() }
})

test('retry repairs a failed memory projection without repeating the committed completion', async () => {
  const f = await finalFixture()
  const saveMemory = f.core.store.saveMemory.bind(f.core.store)
  try {
    f.core.store.saveMemory = () => { throw new Error('Synthetic memory projection failure') }
    assert.throws(() => (f.core.verifyResult as any)(f.lead, review(f.inspection), 'Committed primary state'), /memory projection/)
    const record = f.core.store.verifications(f.lead.missionId).at(-1)!
    assert.ok(record.completion)
    assert.equal(f.core.store.mission(f.lead.missionId)!.readyAt, record.completion.readyAt)
    f.core.store.saveMemory = saveMemory
    const replay = (f.core.verifyResult as any)(f.lead, review(f.inspection), 'Committed primary state')
    assert.deepEqual(replay, record)
    assert.equal(f.core.missionEvents(f.lead.missionId, 'mission.ready').length, 1)
    const workspaceId = f.core.store.mission(f.lead.missionId)!.workspaceId
    assert.equal(f.core.store.memory(workspaceId).filter(m => m.id === record.completion!.eventId).length, 1)
  } finally { f.core.store.saveMemory = saveMemory; await f.core.shutdown() }
})
