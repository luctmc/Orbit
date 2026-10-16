import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sourceRevision, validateReview } from '../src/verification.ts'
import { gitSync } from '../src/git.ts'
import { initRepository } from './gitFixture.ts'

test('a worktree nested inside Orbit data still fingerprints its actual source files', () => {
  const data = mkdtempSync(join(tmpdir(), 'orbit-source-'))
  const root = join(data, 'worktrees/project')
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, 'source.ts'), 'one')
  const first = sourceRevision([root], [data])
  writeFileSync(join(root, 'source.ts'), 'two')
  assert.notEqual(sourceRevision([root], [data]).digest, first.digest)
})

test('source fingerprint changes with HEAD, index, working files, untracked files and deletion', () => {
  const root = initRepository(mkdtempSync(join(tmpdir(), 'orbit-git-source-')))
  writeFileSync(join(root, 'tracked.txt'), 'one')
  gitSync(root, ['add', 'tracked.txt'])
  gitSync(root, ['-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'Source'])
  let before = sourceRevision([root]).digest
  writeFileSync(join(root, 'tracked.txt'), 'two')
  assert.notEqual(sourceRevision([root]).digest, before)
  before = sourceRevision([root]).digest
  gitSync(root, ['add', 'tracked.txt'])
  assert.notEqual(sourceRevision([root]).digest, before)
  before = sourceRevision([root]).digest
  writeFileSync(join(root, 'untracked.txt'), 'new')
  assert.notEqual(sourceRevision([root]).digest, before)
  before = sourceRevision([root]).digest
  gitSync(root, ['-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'Updated'])
  assert.notEqual(sourceRevision([root]).digest, before)
  before = sourceRevision([root]).digest
  gitSync(root, ['rm', 'tracked.txt'])
  assert.notEqual(sourceRevision([root]).digest, before)
})

test('acceptance refuses missing criteria, duplicated answers and reported failed checks', () => {
  const base = { inspectionId: 'x', verdict: 'accepted' as const, summary: 'Review', checks: [{ command: 'synthetic', exitCode: 0, summary: 'pass' }], criteria: [{ item: 1, met: true, how: 'synthetic observation' }] }
  validateReview(base, ['holds'])
  assert.throws(() => validateReview({ ...base, criteria: [] }, ['holds']), /Aceite/)
  assert.throws(() => validateReview({ ...base, criteria: [...base.criteria, ...base.criteria] }, ['holds']), /Critérios/)
  assert.throws(() => validateReview({ ...base, checks: [{ command: 'test', exitCode: 1, summary: 'failed' }] }, ['holds']), /Aceite/)
})
