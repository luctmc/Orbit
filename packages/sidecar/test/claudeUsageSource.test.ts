import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fromClaudeStatus } from '../src/usage.ts'
import { ClaudeUsageReader } from '../src/adapters/claudeUsage.ts'
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fixture } from './r2Fixture.ts'
import { userConfigDir } from '../src/accounts.ts'

test('current context-window counts are not cumulative session consumption', () => {
  const report = fromClaudeStatus({ version: '2.1.296', context_window: { total_input_tokens: 1000, total_output_tokens: 5, used_percentage: 1 } })
  assert.equal(report.usage?.total ?? null, null)
  assert.equal(report.contextPercent, 1)
})

const response = (id: string, input = 10, output = 2) => JSON.stringify({ type: 'assistant', message: { id, model: 'claude-fixture', stop_reason: 'end_turn', usage: { input_tokens: input, output_tokens: output, cache_read_input_tokens: 3, cache_creation_input_tokens: 5 }, content: [{ type: 'text', text: 'ação' }] } }) + '\n'

test('distinct responses count separately even with identical context; repeated frames count once', () => {
  const root = mkdtempSync(join(tmpdir(), 'orbit-claude-usage-')), path = join(root, 'owned.jsonl')
  writeFileSync(path, response('a') + response('a') + response('b'))
  const reader = new ClaudeUsageReader()
  const first = reader.read(path)!
  assert.equal(first.responses, 2)
  assert.deepEqual(first.usage, { input: 36, output: 4, cacheRead: 6, cacheWrite: 10, total: 40, costUsd: null })
  assert.deepEqual(reader.read(path), first)
  const next = response('c', 1, 3)
  appendFileSync(path, next.slice(0, next.length - 2))
  assert.equal(reader.read(path)!.complete, false)
  appendFileSync(path, next.slice(-2))
  assert.equal(reader.read(path)!.usage.total, 52)
  assert.equal(reader.read(path)!.complete, true)
  assert.equal(new ClaudeUsageReader().read(path)!.usage.total, 52, 'restart reconstructs the same provider-id totals')
})

test('missing counters and native subagent requests keep consumption coverage incomplete', () => {
  const root = mkdtempSync(join(tmpdir(), 'orbit-claude-incomplete-')), path = join(root, 'owned.jsonl')
  writeFileSync(path, response('a') + JSON.stringify({ type: 'assistant', message: { id: 'missing', stop_reason: 'end_turn', usage: { input_tokens: 1 }, content: [] } }) + '\n')
  assert.equal(new ClaudeUsageReader().read(path)!.complete, false)
  const entry = JSON.parse(response('b'))
  entry.message.content = [{ type: 'tool_use', name: 'Agent' }]
  appendFileSync(path, JSON.stringify(entry) + '\n')
  assert.equal(new ClaudeUsageReader().read(path)!.complete, false)
})

test('the live adapter resolves only its own session transcript and ignores current-context counters for charging', async () => {
  const { core, pane } = await fixture()
  const session = 'ffbbeeaa-1234-4321-9876-001122334455'
  const folder = join(userConfigDir('claude'), 'projects', 'owned-session')
  mkdirSync(folder, { recursive: true })
  const path = join(folder, `${session}.jsonl`)
  writeFileSync(path, response('a') + response('b'))
  try {
    core.statusReport(pane.id, { session_id: session, version: '2.1.296', transcript_path: '/this/arbitrary/path/is/not/read', context_window: { total_input_tokens: 999999, total_output_tokens: 9999 }, cost: { total_cost_usd: .001 } })
    assert.equal(core.store.mission(pane.missionId)!.usage.total, 40)
    const attempt = core.store.currentPaneAttempt(pane.id)!
    assert.deepEqual(core.store.harnessObservation(attempt.id)!.reportedModels, ['claude-fixture'])
    assert.equal(core.store.harnessObservation(attempt.id)!.identityLevel, 'response')
    assert.equal(core.store.harnessObservation(attempt.id)!.reportedEffort, null)
    core.statusReport(pane.id, { session_id: session, context_window: { total_input_tokens: 999999, total_output_tokens: 9999 }, cost: { total_cost_usd: .001 } })
    assert.equal(core.store.mission(pane.missionId)!.usage.total, 40)
    appendFileSync(path, response('c', 1, 3))
    core.statusReport(pane.id, { session_id: session, context_window: { total_input_tokens: 1, total_output_tokens: 0 } })
    assert.equal(core.store.mission(pane.missionId)!.usage.total, 52)
  } finally { await core.shutdown() }
})

test('Claude effort comes from the live status, never the requested seat or transcript model alone', async () => {
  const { core, pane } = await fixture()
  const session='ee11aa22-1234-4321-9876-001122334455'
  const folder=join(userConfigDir('claude'),'projects','owned-effort-session');mkdirSync(folder,{recursive:true})
  writeFileSync(join(folder,`${session}.jsonl`),response('effort-a'))
  try {
    core.statusReport(pane.id,{session_id:session,model:{id:'claude-fixture'},effort:{level:'high'}})
    const attempt=core.store.currentPaneAttempt(pane.id)!
    assert.equal(core.store.harnessObservation(attempt.id)!.reportedEffort,'high')
    assert.equal(core.store.harnessObservation(attempt.id)!.identityComplete,false,'current effort does not certify the whole earlier trajectory')
    core.statusReport(pane.id,{session_id:session,model:{id:'claude-fixture'},effort:{level:'low'}})
    assert.deepEqual(core.store.harnessObservation(attempt.id)!.reportedEfforts,['high','low'])
    assert.equal(core.store.harnessObservation(attempt.id)!.reportedEffort,null,'mixed efforts cannot be attributed to one candidate')
  } finally { await core.shutdown() }
})
