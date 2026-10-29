import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '../src/store.ts'
import { fixture as coreFixture } from './r2Fixture.ts'

function fixture() {
  const dataDir = mkdtempSync(join(tmpdir(), 'orbit-rescue-'))
  const store = new Store(dataDir)
  const input = { missionId: 'mission', key: 'work', title: 'Work', contractHash: 'v1', requestHash: 'req1', acceptance: [], retryReason: null as string | null, assignedBy: 1, requiresDelivery: true, cli: 'claude' as const, model: 'haiku', newEvidence: undefined as string | undefined }
  const reserve = (change: Partial<typeof input> = {}) => store.reserveActivity({ ...input, ...change })
  const fail = (change: Partial<typeof input> = {}) => {
    const ticket = reserve(change)
    store.startingAttempt(ticket.attempt.id, { cli: 'claude', model: change.model ?? 'haiku', accountId: null })
    store.failAttempt(ticket.attempt.id, 'Command failed with exit 1')
    return ticket
  }
  return { store, reserve, fail, dataDir }
}

test('F8 attempt 2 requires a concrete reason of at least 20 characters', () => {
  const f = fixture(); f.fail()
  for (const retryReason of [null, '', ' ', 'x'.repeat(19)]) assert.throws(() => f.reserve({ retryReason, contractHash: 'v2' }), /retryReason|justificativa/)
  assert.equal(f.reserve({ retryReason: 'A falha veio do caminho incorreto', contractHash: 'v2' }).reused, false)
})

test('F8 rejects the same failed contract on the same CLI/model before reserving attempt 2', () => {
  const f = fixture(); f.fail()
  assert.throws(() => f.reserve({ retryReason: 'Repetir depois de verificar o erro' }), /rescue_duplicate/)
  assert.equal(f.store.activityHistory('mission').attempts.length, 1)
  assert.equal(f.reserve({ retryReason: 'Subir modelo após falha documentada', model: 'sonnet' }).reused, false)
})

test('F8 attempt 3 requires new evidence and a smaller scope in the reason', () => {
  const f = fixture(); f.fail()
  f.fail({ retryReason: 'Corrigir o caminho inválido encontrado', contractHash: 'v2' })
  assert.throws(() => f.reserve({ retryReason: 'Escopo menor: apenas validar o parser', contractHash: 'v3' }), /newEvidence/)
  assert.throws(() => f.reserve({ retryReason: 'Corrigir novamente o erro encontrado', newEvidence: 'Trace mostrou falha apenas no parser', contractHash: 'v3' }), /escopo menor/)
  const ticket = f.reserve({ retryReason: 'Escopo menor: apenas validar o parser', newEvidence: 'Trace mostrou falha apenas no parser', contractHash: 'v3' })
  assert.equal(ticket.attempt.newEvidence, 'Trace mostrou falha apenas no parser')
})

test('F8 attempt 4 is refused and records a visible rescue event without losing history', () => {
  const f = fixture(); f.fail()
  f.fail({ retryReason: 'Corrigir o caminho inválido encontrado', contractHash: 'v2' })
  f.fail({ retryReason: 'Escopo menor: apenas validar o parser', newEvidence: 'Trace mostrou falha apenas no parser', contractHash: 'v3' })
  assert.throws(() => f.reserve({ retryReason: 'Escopo menor: apenas ler uma função', newEvidence: 'Outra evidência nova do trace', contractHash: 'v4' }), /rescue_exhausted.*usuário/)
  assert.equal(f.store.activityHistory('mission').attempts.length, 3)
  assert.ok(f.store.snapshot().events.some(e => e.kind === 'rescue' && /usuário/.test(e.body)))
})

test('F8 user continuations without failures do not spend the rescue budget', () => {
  const f = fixture()
  for (let n = 0; n < 5; n++) f.reserve({ retryReason: `Continuação solicitada pelo usuário ${n}`, contractHash: `v${n}` })
  assert.equal(f.store.activityHistory('mission').attempts.length, 5)
})

test('F8 third rescue receipt is idempotent and survives Store reload', () => {
  const f = fixture(); f.fail()
  f.fail({ retryReason: 'Corrigir o caminho inválido encontrado', contractHash: 'v2' })
  const input = { retryReason: 'Escopo menor: apenas validar o parser', newEvidence: 'Trace mostrou falha apenas no parser', contractHash: 'v3' }
  const ticket = f.reserve(input)
  assert.equal(f.reserve(input).attempt.id, ticket.attempt.id)
  const restored = new Store(f.dataDir)
  assert.equal(restored.activityHistory('mission').attempts.at(-1)!.newEvidence, input.newEvidence)
})

test('F8 nonzero process exit counts once, while clean user stops do not count', () => {
  const f = fixture()
  const ticket = f.reserve()
  // Durable process snapshots are the same evidence retained by syncAttempt on exit.
  const pane = { id: ticket.attempt.paneId, missionId: 'mission', role: 'crew', cli: 'claude', model: 'haiku', status: 'exited', exitCode: 1, title: 'Work', handoffStatus: null, assignedBy: 1 } as any
  f.store.upsertPane(pane)
  assert.throws(() => f.reserve({ retryReason: 'Curto', contractHash: 'v2' }), /retryReason/)
  const next = f.reserve({ retryReason: 'Corrigir o caminho inválido encontrado', contractHash: 'v2' })
  f.store.upsertPane({ ...pane, id: next.attempt.paneId, exitCode: 0 })
  assert.equal(f.reserve({ retryReason: 'Continuação solicitada pelo usuário', contractHash: 'v3' }).reused, false)
})


test('F8 changes_required counts as failure and preserves the rejected done submission', async () => {
  const f = await coreFixture()
  try {
    const input = { title: 'Review work', task: 'Read synthetic review input', cli: 'claude' as const, model: null, activityId: 'review-work' }
    const { pane } = await f.core.spawnHelper(f.lead, input)
    const result = f.core.handoff(pane, { summary: 'Submitted', evidence: 'Synthetic check exit 0' })
    const inspection = f.core.inspectResult(f.lead, result.resultId)
    f.core.verifyResult(f.lead, { inspectionId: inspection.id, verdict: 'changes_required', summary: 'Missing error case', checks: [{ command: 'Synthetic error case', exitCode: 1, summary: 'Not handled' }], criteria: [] })
    await assert.rejects(f.core.spawnHelper(f.lead, { ...input, retryReason: 'Fix error' }), /retryReason|justificativa/)
    await assert.rejects(f.core.spawnHelper(f.lead, { ...input, retryReason: 'Corrigir o tratamento da falha encontrada' }), /rescue_duplicate/)
    const next = await f.core.spawnHelper(f.lead, { ...input, accept: ['Handle only the error case'], retryReason: 'Corrigir o tratamento da falha encontrada' })
    assert.notEqual(next.pane.id, pane.id)
    assert.equal(f.core.store.activityHistory(f.lead.missionId).results.find(r => r.id === result.resultId)?.status, 'done')
  } finally { await f.core.shutdown() }
})
