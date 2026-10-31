import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Mission } from '@orbit/protocol'
import { leadRole, crewRole } from '../src/prompts.ts'
import { DEFAULT_ROUTING } from '../src/routing.ts'
const mission = { title: 'M', mode: 'agentica', allowedClis: ['claude', 'codex'] } as Mission
test('default role budgets preserve independent review, recovery and user language', () => {
  const lead = leadRole(mission, { id: 1 }, undefined, DEFAULT_ROUTING)
  const worker = crewRole(mission, { id: 2 }, {}, undefined, DEFAULT_ROUTING.taskTypes.find(t => t.id === 'revisao'))
  assert.ok(Buffer.byteLength(lead) <= 6000, `leader bytes: ${Buffer.byteLength(lead)}`)
  assert.ok(Buffer.byteLength(worker) <= 2800, `worker bytes: ${Buffer.byteLength(worker)}`)
  assert.match(lead, /unverified = NOT_PROVEN/)
  assert.match(lead, /nunca accepted/)
  assert.match(lead, /não é changes_required/)
  for (const text of [lead, worker]) {
    for (const required of ['Brazilian Portuguese', 'result_inspect', 'verification_submit', 'changes_required', 'delivery_ack']) assert.ok(text.includes(required), required)
  }
  for (const required of ['activityId', 'retryReason', 'readOnly', 'requireReadOnlySandbox', 'dependsOn', 'mission_briefing', 'readySummary', 'briefId', 'pane.quiet']) assert.ok(lead.includes(required), required)
})

test('coordination and factory methods preserve gates with proportional checks', () => {
  for (const mode of ['livre', 'agentica'] as const) {
    const lead = leadRole({ ...mission, mode }, { id: 1 }, undefined, DEFAULT_ROUTING)
    assert.match(lead, /newTask:true/)
    assert.match(lead, /ACK/)
    assert.match(lead, /same source revision/)
  }
  const worker = crewRole(mission, { id: 2 }, {})
  assert.match(worker, /newTask:true/)
  for (const kind of ['bug', 'funcionalidade', 'revisao']) {
    const method = DEFAULT_ROUTING.taskTypes.find(t => t.id === kind)!.method
    assert.match(method, /affected|delta/)
    assert.doesNotMatch(method, /run the whole suite|run the suite and the build/)
  }
})
