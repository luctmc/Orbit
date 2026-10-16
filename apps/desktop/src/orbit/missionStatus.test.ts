import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Mission, MissionProgress, Pane } from '@orbit/protocol'
import { missionSignal } from './missionStatus.ts'

const mission = { id: 'm', status: 'active', readyAt: 123, readySummary: 'Checked', budget: null } as Mission
const progress = { missionId: 'm', activities: [], attempts: [], results: [], verifications: [], deliveries: [], validation: [], observedAt: 123, integration: { state: 'current', reviewId: 'r', checkedAt: 123, reason: null } } satisfies MissionProgress
test('a historical ready declaration never overrides disconnected, unknown, stale or waived verification', () => {
  assert.equal(missionSignal(mission, [], progress, 'closed', null).state, 'offline')
  assert.equal(missionSignal(mission, [], null, 'open', null).state, 'idle')
  assert.equal(missionSignal(mission, [], progress, 'open', 'read error').state, 'idle')
  assert.equal(missionSignal(mission, [], { ...progress, missionId: 'other' }, 'open', null).state, 'idle')
  assert.equal(missionSignal(mission, [], { ...progress, integration: { ...progress.integration, state: 'stale' } }, 'open', null).state, 'review')
  assert.equal(missionSignal(mission, [], { ...progress, activities: [{ state: 'waived' } as any] }, 'open', null).state, 'idle')
  assert.equal(missionSignal(mission, [], progress, 'open', null).state, 'done')
})
test('permission, budget and unresolved work take precedence over a ready declaration', () => {
  assert.equal(missionSignal(mission, [{ id: 2, status: 'waiting', attention: 'Permission' } as Pane], progress, 'open', null).state, 'waiting')
  assert.equal(missionSignal({ ...mission, budget: { exceeded: true } as any }, [], progress, 'open', null).state, 'blocked')
  for (const state of ['stopped', 'blocked', 'awaiting_validation', 'running'] as const) {
    const p = { ...progress, activities: [{ title: 'Work', state } as any] }
    assert.equal(missionSignal(mission, [], p, 'open', null).state, state === 'awaiting_validation' ? 'review' : state === 'running' ? 'working' : 'blocked')
  }
  assert.equal(missionSignal({ ...mission, readyAt: null }, [], progress, 'open', null).state, 'review')
})
