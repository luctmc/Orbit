import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CORPUS, corpusRevision, taskRevision, fixtureFiles, writeFiles, runReference, checkTask } from '../src/benchmarks/corpus.ts'

test('the versioned corpus has four tasks per category and rejects every seeded bug/feature', () => {
  assert.equal(CORPUS.length, 12)
  assert.equal(new Set(CORPUS.map(t => t.id)).size, 12)
  for (const category of ['operation', 'bug', 'multi-file']) assert.equal(CORPUS.filter(t => t.category === category).length, 4)
  assert.match(corpusRevision(), /^[a-f0-9]{64}$/)
  for (const task of CORPUS) {
    const root = mkdtempSync(join(tmpdir(), `orbit-corpus-${task.id}-`))
    writeFiles(root, fixtureFiles(task))
    if (task.category !== 'operation') assert.ok(checkTask(task, root).some(c => c.exitCode !== 0), `${task.id}: seeded defect must fail`)
    runReference(task, root)
    const checks = checkTask(task, root)
    assert.ok(checks.every(c => c.exitCode === 0), `${task.id}: ${JSON.stringify(checks)}`)
    assert.notEqual(taskRevision({ ...task, goal: task.goal + ' changed' }), taskRevision(task))
  }
})

test('changing an oracle or an undeclared file cannot obtain benchmark acceptance', () => {
  const task = CORPUS.find(t => t.id === 'bug-mean')!
  const root = mkdtempSync(join(tmpdir(), 'orbit-corpus-tamper-'))
  writeFiles(root, fixtureFiles(task))
  runReference(task, root)
  writeFileSync(join(root, '.benchmark/check-0.mjs'), 'process.exit(0)\n')
  assert.equal(checkTask(task, root)[0]!.exitCode, 1)
  writeFiles(root, fixtureFiles(task))
  runReference(task, root)
  writeFileSync(join(root, 'unexpected.mjs'), 'export const unexpected = true\n')
  assert.equal(checkTask(task, root)[0]!.exitCode, 1)
})
