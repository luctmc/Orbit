import { test } from 'node:test'
import assert from 'node:assert/strict'
import { claudeHook, claudeStatus } from '../src/adapters/claude.ts'
import { codexRollout, freshCodexTurn } from '../src/adapters/codex.ts'
import { geminiHook, geminiAnswer } from '../src/adapters/gemini.ts'
import { adapterCapabilities } from '../src/adapters/types.ts'

test('Claude adapter validates known payloads and preserves permission inputs without inventing events', () => {
  const hook = claudeHook({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: '/tmp/x' }, event_id: 'hook-1' })
  assert.equal(hook.kind, 'status.changed')
  assert.equal(hook.sourceId, 'hook-1')
  assert.deepEqual(hook.payload.tool_input, { file_path: '/tmp/x' })
  assert.equal(claudeHook({ hook_event_name: 'FutureEvent' }).kind, 'unknown')
  assert.throws(() => claudeHook({ hook_event_name: 'Notification', message: {} }), /incompatível/)
  assert.throws(() => claudeStatus({ context_window: { total_input_tokens: -1 } }), /incompatível/)
  assert.equal(claudeStatus({ future: true }).report.usage, null)
})

test('Codex adapter recognizes known events and rejects stale, duplicated or undated turn transitions', () => {
  const event = (id: string, at: number) => JSON.stringify({ timestamp: new Date(at).toISOString(), payload: { type: 'task_complete', turn_id: id, last_agent_message: 'done' } })
  const at = Date.now()
  const parsed = codexRollout(event('turn-b', at))
  assert.ok(parsed.recognized)
  assert.ok(freshCodexTurn(parsed.turn, at - 1000))
  assert.equal(freshCodexTurn(parsed.turn, at - 1000, { id: 'turn-b', at }), false)
  assert.ok(freshCodexTurn({ id: 'turn-c', at }, at - 1000, { id: 'turn-b', at }))
  assert.equal(freshCodexTurn({ id: 'turn-b', at }, at - 1000, { id: 'turn-c', at, seenIds: ['turn-b', 'turn-c'] }), false)
  assert.equal(freshCodexTurn({ id: 'turn-a', at: at - 500 }, at - 1000, { id: 'turn-b', at }), false)
  assert.equal(freshCodexTurn({ id: 'unknown-date', at: 0 }, at - 1000), false)
  assert.equal(codexRollout('{"future_format":true}\n{"partial":').recognized, false)
})

test('Gemini adapter keeps its dialect and the capability report distinguishes fixtures from provider guarantees', () => {
  assert.equal(geminiHook({ hook_event_name: 'AfterAgent', prompt_response: 'ready' }).payload.last_assistant_message, 'ready')
  assert.deepEqual(geminiAnswer({ decision: 'block', reason: 'deliver first' }), { decision: 'deny', reason: 'deliver first' })
  const capabilities = adapterCapabilities('codex', '0.162.1')
  assert.equal(capabilities.source, 'adapter-fixture')
  assert.equal(capabilities.detectedVersion, '0.162.1')
  assert.equal(capabilities.supports.providerConsumptionAck, false)
  assert.equal(capabilities.supports.imageRead, null)
})
