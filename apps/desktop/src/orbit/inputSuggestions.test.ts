import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ActivityRecord, MissionProgress } from '@orbit/protocol'
import { acceptsSuggestionKey, inlineSuggestion, inputSuggestions } from './inputSuggestions.ts'

const now = 100000
const context = () => ({ mission: { id: 'm', title: 'Frete', objective: 'Corrigir frete', status: 'active' as const, budget: null, readyAt: null as number | null }, pane: { missionId: 'm', role: 'lead' as const, cli: 'codex' as const, status: 'idle' as const }, cards: [], connected: true, now, progress: { missionId: 'm', observedAt: now, activities: [], integration: { state: 'none' } } as unknown as MissionProgress })
const activity = (state: ActivityRecord['state']) => ({ id: 'a', missionId: 'm', title: 'Corrigir frete', state, updatedAt: 1 }) as ActivityRecord

test('suggestions follow real activity state and do not certify readiness from readyAt', () => {
  const c = context(); c.progress.activities = [activity('awaiting_validation')]
  assert.match(inputSuggestions(c)[0]!.text, /Revise a entrega “Corrigir frete”/)
  c.progress.activities = [activity('blocked')]
  assert.match(inputSuggestions(c)[0]!.text, /Investigue o bloqueio/)
  c.progress.activities = [activity('running')]
  assert.match(inputSuggestions(c)[0]!.text, /Mostre o andamento/)
  c.mission.readyAt = 1; c.progress.activities = []; c.progress.integration.state = 'stale'
  assert.match(inputSuggestions(c)[0]!.text, /refaça a revisão/)
  c.progress.integration.state = 'current'
  assert.match(inputSuggestions(c)[0]!.text, /Resuma as alterações verificadas/)
})

test('unknown, stale and other-mission context cannot produce an old action', () => {
  for (const mutate of [(c: ReturnType<typeof context>) => { c.progress.observedAt = now - 30001 }, (c: ReturnType<typeof context>) => { c.progress.missionId = 'other' }]) {
    const c = context(); c.progress.activities = [activity('awaiting_validation')]; mutate(c)
    assert.equal(inputSuggestions(c)[0]!.id, 'check-state')
    assert.ok(!inputSuggestions(c).some(s => s.id.startsWith('review:')))
  }
})

test('predictions stay out of shell, helpers, permission prompts, exhausted budgets and disconnected missions', () => {
  const c = context()
  for (const patch of [{ connected: false }, { pane: { ...c.pane, cli: 'shell' as const } }, { pane: { ...c.pane, role: 'crew' as const } }, { pane: { ...c.pane, status: 'waiting' as const } }, { pane: { ...c.pane, missionId: 'other' } }]) assert.deepEqual(inputSuggestions({ ...c, ...patch }), [])
})

test('prefix completion preserves spelling/case and never substitutes unrelated or multiline input', () => {
  const candidates = [{ id: 'x', text: 'Revise a integração final.', reason: 'Entrega aguardando revisão.' }]
  assert.equal(inlineSuggestion('revi', candidates)!.value, 'revise a integração final.')
  assert.equal(inlineSuggestion('Revise a integracao', candidates)!.value, 'Revise a integracao final.')
  assert.equal(inlineSuggestion('', candidates)!.suffix, candidates[0]!.text)
  for (const draft of ['outro texto', 'Revise a integração final.', '/review', '!ls', 'Revise\n', ' '.repeat(3), 'a'.repeat(513)]) assert.equal(inlineSuggestion(draft, candidates), null)
  assert.equal(inlineSuggestion('', [{ ...candidates[0]!, text: 'hello\rmalicious' }]), null)
})

test('Tab accepts only without modifiers or composition', () => {
  const plain = { key: 'Tab', shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, isComposing: false }
  assert.equal(acceptsSuggestionKey(plain), true)
  for (const key of ['shiftKey', 'ctrlKey', 'altKey', 'metaKey', 'isComposing'] as const) assert.equal(acceptsSuggestionKey({ ...plain, [key]: true }), false)
  assert.equal(acceptsSuggestionKey({ ...plain, key: 'Enter' }), false)
})

test('an advisory exceeded budget preserves suggestions for ongoing work', () => {
  const c = context()
  assert.deepEqual(inputSuggestions({ ...c, mission: { ...c.mission, budget: { exceeded: true, warned: true, tokens: 1, costUsd: null } } }), inputSuggestions(c))
})
