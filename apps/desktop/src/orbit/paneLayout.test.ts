import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fitTracks, gridColumns, hasNewPanes, resizeTracks, selectedAfterRemoval, trackSizes } from './paneLayout.ts'

test('single, batch and same-count replacements reveal panes; status updates/removals do not', () => {
  assert.equal(hasNewPanes([1], [1, 2]), true)
  assert.equal(hasNewPanes([1], [1, 2, 3]), true)
  assert.equal(hasNewPanes([1, 2], [1, 3]), true)
  assert.equal(hasNewPanes([1, 2], [1]), false)
  assert.equal(hasNewPanes([1, 2], [2, 1]), false)
})

test('selection stays on the writer during spawn and moves to the nearest surviving neighbour on removal', () => {
  assert.equal(selectedAfterRemoval([1, 2], [1, 2, 3, 4], 2), 2)
  assert.equal(selectedAfterRemoval([1, 2, 3], [1, 3], 2), 3)
  assert.equal(selectedAfterRemoval([1, 2, 3], [1, 2], 3), 2)
  assert.equal(selectedAfterRemoval([1], [], 1), null)
  assert.equal(selectedAfterRemoval([], [1, 2], null), 1)
})

test('container width limits even manual column counts without horizontal scroll', () => {
  assert.equal(gridColumns(1000, 3, 'auto'), 3)
  assert.equal(gridColumns(650, 3, '3'), 1)
  assert.equal(gridColumns(900, 3, '3'), 2)
  assert.equal(gridColumns(1400, 2, '3'), 2)
  assert.equal(gridColumns(1400, 3, '1'), 1)
})

test('stored ratios are validated and topology changes safely rebalance', () => {
  for (const bad of [null, {}, [0, 2], [NaN, 1], ['1', 2], [1]]) assert.deepEqual(trackSizes(bad, 2), [1, 1])
  assert.deepEqual(trackSizes([3, 1], 2), [1.5, .5])
  assert.deepEqual(trackSizes([3, 1], 1), [1])
})

test('resize preserves neighbours total, unrelated tracks and physical minimum at both extremes', () => {
  const initial = [1, 1, 1]
  assert.deepEqual(resizeTracks(initial, 0, 100, 1200, 240), [1.25, .75, 1])
  const left = resizeTracks(initial, 0, -9999, 1200, 240)
  const right = resizeTracks(initial, 0, 9999, 1200, 240)
  assert.ok(Math.abs(left[0]! - .6) < 1e-12)
  assert.ok(Math.abs(right[1]! - .6) < 1e-12)
  assert.equal(left[0]! + left[1]!, 2)
  assert.deepEqual(initial, [1, 1, 1])
})

 test('remembered wide-window ratios fit a smaller container without shrinking a neighbour below minimum', () => {
  const result = fitTracks([1.7, .3], 650, 240)
  assert.ok(Math.abs(result[0]! / 2 * 650 - 410) < .001)
  assert.ok(Math.abs(result[1]! / 2 * 650 - 240) < .001)
  assert.deepEqual(fitTracks([1, 1], 650, 240), [1, 1])
 })
