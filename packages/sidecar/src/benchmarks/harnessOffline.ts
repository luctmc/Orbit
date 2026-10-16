import { createHash } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { Store } from '../store.ts'
import { composeHarness } from '../harness.ts'
import { harnessRuntimeRevision } from '../harnessRuntime.ts'
import { CORPUS, corpusRevision, taskRevision, fixtureFiles, writeFiles, runReference, checkTask } from './corpus.ts'
import { runHarnessBenchmark } from './harnessRunner.ts'
/** Functional two-task producer: actual local oracles, no CLI/model calls, never promotion evidence. */
export async function runOfflineHarnessPilot() {
  const root = mkdtempSync(join(tmpdir(), 'orbit-harness-journal-pilot-'))
  const store = new Store(join(root, 'data'))
  const revision = harnessRuntimeRevision()
  if (!revision) throw new Error('Runtime não pôde ser identificado')
  const tasks = ['op-build', 'bug-mean'].map(id => CORPUS.find(t => t.id === id)!)
  const strategies = tasks.map(t => composeHarness({ kind: t.category === 'bug' ? 'bug' : 'operacao', difficulty: 'normal', readOnly: false, retry: false }))
  const candidate = { cli: 'codex' as const, model: 'offline-fixture', effort: 'low' as const, cliVersion: 'simulation', catalogRevision: createHash('sha256').update('offline-fixture-catalog').digest('hex') }
  const batch = await runHarnessBenchmark(store, {
    version: 1, sourceRevision: revision, corpusRevision: corpusRevision(),
    oracleRevision: createHash('sha256').update(JSON.stringify(tasks.map(t => t.checks))).digest('hex'),
    candidates: [candidate], strategies, repetitions: 1,
    cases: tasks.map((t, i) => ({ id: t.id, revision: taskRevision(t), projectId: `synthetic-project-${i}`, partition: i === 0 ? 'calibration' : 'holdout', strategyKey: strategies[i]!.key })),
  }, { mode: 'simulated', execute: async cell => {
    const started = performance.now(), task = tasks.find(t => t.id === cell.caseId)!, workspace = join(root, cell.id)
    writeFiles(workspace, fixtureFiles(task)); runReference(task, workspace)
    const checks = checkTask(task, workspace)
    return { exitCode: 0, error: null, durationMs: performance.now() - started, observedAt: Date.now(), checks,
      identity: { models: [], efforts: [], level: 'unknown', complete: false },
      usage: { input: null, output: null, cacheRead: null, cacheWrite: null, total: null, costUsd: null } }
  } })
  store.flush()
  const reopened = new Store(join(root, 'data')), persisted = reopened.harnessBenchmark(batch.id)!
  const accepted = persisted.cells.filter(c => c.observation?.exitCode === 0 && !c.observation.error && c.observation.checks.length && c.observation.checks.every(check => check.exitCode === 0)).length
  return { version: 1, mode: 'simulated', root, batchId: batch.id, tasks: tasks.map(t => t.id), attempts: persisted.cells.length, accepted, modelCalls: 0, promotedObservations: reopened.harnessEvidence().length, note: 'Oracle funcional executado; não mede qualidade de modelo, identidade servida ou economia de tokens.' }
}
