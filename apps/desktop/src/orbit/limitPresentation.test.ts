import { test } from 'node:test'
import assert from 'node:assert/strict'
import { limitWindowView } from './limitPresentation.ts'
const now = 1000000, limits = { updatedAt: now, refreshError: null }
const window = { usedPercent: 53, resetsAt: now + 10000, windowMinutes: 300 }
test('quota is explicitly remaining and genuine zero usage means 100% remaining', () => {
  assert.equal(limitWindowView(window, limits, now).remaining, 47)
  assert.equal(limitWindowView({ ...window, usedPercent: 0 }, limits, now).remaining, 100)
  assert.equal(limitWindowView({ ...window, usedPercent: 100 }, limits, now).remaining, 0)
})
test('expired, stale, future or invalid data never claims a renewed/unused quota', () => {
  for (const result of [limitWindowView({ ...window, resetsAt: now }, limits, now), limitWindowView(window, { updatedAt: now - 90001 }, now), limitWindowView(window, { updatedAt: now + 1001 }, now), limitWindowView(null, limits, now), limitWindowView({ ...window, usedPercent: NaN }, limits, now)]) assert.equal(result.remaining, null)
  assert.equal(limitWindowView({ ...window, windowMinutes: 15 }, limits, now).label, '15 min')
})

test('Claude matches the official used meter while Codex keeps the official remaining meter', () => {
  const claude = { ...limits, cli: 'claude' as const }
  const codex = { ...limits, cli: 'codex' as const }
  const session = { ...window, usedPercent: 0 }
  const week = { ...window, usedPercent: 84, windowMinutes: 10080 }
  assert.equal(limitWindowView(session, claude, now).percent, 0)
  assert.equal(limitWindowView(week, claude, now).percent, 84)
  assert.equal(limitWindowView(week, claude, now).metric, 'usado')
  assert.equal(limitWindowView(week, codex, now).percent, 84)
  assert.equal(limitWindowView(week, codex, now).metric, 'usado')
  assert.equal(limitWindowView(week, codex, now).remaining, 16)
  assert.equal(limitWindowView({ ...week, resetsAt: now }, claude, now).percent, null)
})
