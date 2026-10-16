import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { CodexUsageReader } from '../src/adapters/codexUsage.ts'
const line = (type: string, payload: unknown) => JSON.stringify({ type, payload }) + '\n'
const meta = line('session_meta', { id: 'fixture-session' })
const context = (model = 'fixture-model', effort = 'high', turn = 'turn-1') => line('turn_context', { turn_id: turn, model, effort })
const counts = (input = 10, output = 2) => line('event_msg', { type: 'token_count', info: { total_token_usage: { input_tokens: input, output_tokens: output, total_tokens: input + output, cached_input_tokens: 3, reasoning_output_tokens: 1 } } })
const fixture = (text: string) => { const path = join(mkdtempSync(join(tmpdir(), 'orbit-codex-reader-')), 'rollout.jsonl'); writeFileSync(path, text); return path }
test('the owned full rollout confirms CLI turn configuration, never provider serving identity', () => {
  const path = fixture(meta + context() + counts() + counts())
  const reader = new CodexUsageReader()
  const first = reader.read(path, 'fixture-session')!
  assert.equal(first.report.usage!.total, 12)
  assert.equal(first.complete, true)
  assert.deepEqual(first.identity.models, ['fixture-model'])
  assert.deepEqual(first.identity.efforts, ['high'])
  assert.equal(first.identity.level, 'execution-context')
  assert.equal(first.identity.complete, true)
  assert.deepEqual(reader.read(path, 'fixture-session'), first)
  assert.deepEqual(new CodexUsageReader().read(path, 'fixture-session'), first)
  assert.equal(reader.read(path, 'different-session'), null)
})
test('partial writes recover; replaced/truncated files and missing contexts cannot certify identity', () => {
  const path = fixture(meta + context() + counts())
  const reader = new CodexUsageReader(); reader.read(path, 'fixture-session')
  const next = counts(20, 4)
  appendFileSync(path, next.slice(0, -2))
  assert.equal(reader.read(path, 'fixture-session')!.complete, false)
  appendFileSync(path, next.slice(-2))
  assert.equal(reader.read(path, 'fixture-session')!.report.usage!.total, 24)
  assert.equal(reader.read(path, 'fixture-session')!.complete, true)
  writeFileSync(path, meta)
  assert.equal(reader.read(path, 'fixture-session'), null)
  assert.equal(new CodexUsageReader().read(fixture(meta + counts()), 'fixture-session')!.identity.complete, false)
})
test('model/effort changes and native subagents remain visible and prevent a single-seat certificate', () => {
  const path = fixture(meta + context() + counts() + context('other-model', 'low', 'turn-2') + counts(20, 4))
  const snapshot = new CodexUsageReader().read(path, 'fixture-session')!
  assert.equal(snapshot.complete, true)
  assert.deepEqual(snapshot.identity.models, ['fixture-model', 'other-model'])
  assert.equal(snapshot.identity.complete, false)
  appendFileSync(path, line('event_msg', { type: 'collab_agent_spawn_end' }))
  assert.equal(new CodexUsageReader().read(path, 'fixture-session')!.complete, false)
})
test('malformed or decreasing counters never regain consumption certification silently', () => {
  for (const text of [meta + context() + counts() + counts(1, 0), meta + context() + counts() + '{invalid}\n', meta + context() + counts() + line('event_msg', { type: 'token_count', info: { total_token_usage: { input_tokens: -1, output_tokens: 2, total_tokens: 1 } } })]) {
    assert.equal(new CodexUsageReader().read(fixture(text), 'fixture-session')!.complete, false)
  }
})

test('the core resolves its owned rollout and persists configured identity without promoting it to served identity', async () => {
  const { fixture: coreFixture } = await import('./r2Fixture.ts')
  const { HOMES } = await import('./helpers.ts')
  const { mkdirSync } = await import('node:fs')
  const f = await coreFixture()
  try {
    const { pane } = await f.core.spawnHelper(f.lead, { title: 'Codex reader fixture', task: 'Read synthetic rollout metadata only', cli: 'codex', model: null, readOnly: true })
    const at = new Date(pane.createdAt), session = 'abcd1234-1234-4321-9876-001122334455'
    const dir = join(HOMES.codex, 'sessions', String(at.getFullYear()), String(at.getMonth()+1).padStart(2,'0'), String(at.getDate()).padStart(2,'0'))
    mkdirSync(dir,{recursive:true})
    const path=join(dir,`rollout-${session}.jsonl`)
    writeFileSync(path,line('session_meta',{id:session,cwd:pane.cwd,timestamp:at.toISOString()})+context()+counts())
    ;(f.core as any).pollCodex()
    const attempt=f.core.store.currentPaneAttempt(pane.id)!
    const observation=f.core.store.harnessObservation(attempt.id)!
    assert(observation)
    assert.deepEqual(observation.reportedModels,['fixture-model'])
    assert.equal(observation.reportedEffort,'high')
    assert.equal(observation.identityLevel,'execution-context')
    assert.equal(observation.tokens,12)
    appendFileSync(path,context('other-model','low','turn-2')+counts(20,4))
    ;(f.core as any).pollCodex()
    assert.equal(f.core.store.harnessObservation(attempt.id)!.identityComplete,false)
    assert.equal(f.core.store.harnessObservation(attempt.id)!.tokens,24)
    assert.equal(f.core.store.harnessEvidence().filter(e=>e.partition==='holdout').length,0)
  } finally { await f.core.shutdown() }
})
