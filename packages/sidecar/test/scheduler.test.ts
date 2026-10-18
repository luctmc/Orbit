import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { copyRoots, writerConflict, assertNoDependencyCycle } from '../src/scheduler.ts'
import { initRepository } from './gitFixture.ts'
import { gitSync } from '../src/git.ts'

test('aliases and subfolders share a lease; distinct worktrees have distinct physical roots', () => {
  const root = initRepository(mkdtempSync(join(tmpdir(), 'orbit-roots-')))
  mkdirSync(join(root, 'nested'))
  const alias = `${root}-alias`
  symlinkSync(root, alias)
  assert.equal(copyRoots([root, alias, join(root, 'nested')]).length, 1)
  const tree = `${root}-tree`
  gitSync(root, ['worktree', 'add', '-b', 'worker', tree])
  assert.equal(copyRoots([root, tree]).length, 2)
  const lease = (roots: string[], readOnly = false) => ({ roots, readOnly, epoch: 'x', missionId: 'm' })
  assert.equal(writerConflict(lease([root]), lease([tree])), false)
  assert.equal(writerConflict(lease([root]), lease([join(root, 'nested')])) , true)
  assert.equal(writerConflict(lease([root]), lease([`${root}-different`])), false)
  assert.equal(writerConflict(lease([root, '/shared']), lease([tree, '/shared/assets'])), true)
  assert.equal(writerConflict(lease([root], true), lease([root])), false)
})

test('dependency admission rejects direct and transitive cycles', () => {
  const graph = [{ id: 'a' }, { id: 'b', dependencies: [{ activityId: 'a' }] }, { id: 'c', dependencies: [{ activityId: 'b' }] }]
  assertNoDependencyCycle('d', ['c'], graph)
  assert.throws(() => assertNoDependencyCycle('a', ['a'], graph), /circular/)
  assert.throws(() => assertNoDependencyCycle('a', ['c'], graph), /circular/)
})

test('maximum permissions admit parallel writers even while a legacy pane remains alive', () => {
  const legacy = { epoch: 'old', missionId: 'mission', readOnly: false, roots: ['/shared'] }
  const current = { ...legacy, epoch: 'new', permissionPolicy: 'writable-bypass-v2' }
  assert.equal(writerConflict(current, legacy), false)
  assert.equal(writerConflict(legacy, current), false)
  assert.equal(writerConflict(current, { ...current, epoch: 'another' }), false)
})
