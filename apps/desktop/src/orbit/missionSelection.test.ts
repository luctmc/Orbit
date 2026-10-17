import { test } from 'node:test'
import assert from 'node:assert/strict'
import { restoreMissionSelection } from './missionSelection.ts'
const panes = [{ id: 1, missionId: 'a', role: 'lead' }, { id: 2, missionId: 'a', role: 'crew' }, { id: 3, missionId: 'b', role: 'lead' }] as const

test('per-mission focus survives switching; foreign, removed and corrupt identities fall back to their own leader', () => {
  assert.deepEqual(restoreMissionSelection({ a: 2, b: 3 }, ['a', 'b'], panes), { a: 2, b: 3 })
  assert.deepEqual(restoreMissionSelection({ a: 3, b: 2, deleted: 7 }, ['a', 'b', 'empty'], panes), { a: 1, b: 3, empty: null })
  assert.deepEqual(restoreMissionSelection(['bad'], ['a'], panes), { a: 1 })
  assert.deepEqual(restoreMissionSelection({ a: 2 }, ['a'], panes.filter(p => p.id !== 2)), { a: 1 })
})
