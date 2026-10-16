import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import type { HarnessCandidate } from '@orbit/protocol'
import type { Store } from '../store.ts'
import type { HarnessMatrix } from './harnessMatrix.ts'
import type { TrialObservation } from './harnessPolicy.ts'
export interface HarnessTrial { batchId: string; id: string; caseId: string; candidate: HarnessCandidate; repetition: number; signal?: AbortSignal }
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
/** Internal coordinator. Executors are trusted code, never prompts, handoff fields or imported JSON.
 * Native executors must terminate their process on abort and return actual adapter/oracle evidence.
 */
export async function runHarnessBenchmark(store: Store, manifest: Omit<HarnessMatrix, 'runs'>, options: {
  mode: 'live' | 'simulated'
  execute: (trial: HarnessTrial) => Promise<TrialObservation>
  resumeBatchId?: string
  signal?: AbortSignal
}) {
  if (typeof options.execute !== 'function') throw new Error('Executor de benchmark ausente')
  const batch = options.resumeBatchId ? store.harnessBenchmark(options.resumeBatchId) : store.beginHarnessBenchmark(manifest, options.mode)
  if (!batch || batch.mode !== options.mode || digest(batch.manifest) !== digest(manifest)) throw new Error('Retomada exige o mesmo manifesto e modo')
  const inherited = new Map(batch.cells.map(c => [c.id, c]))
  const failure = (durationMs: number): TrialObservation => ({
    exitCode: null, error: 'infrastructure', durationMs, observedAt: Date.now(),
    identity: { models: [], efforts: [], level: 'unknown', complete: false },
    usage: { input: null, output: null, cacheRead: null, cacheWrite: null, total: null, costUsd: null }, checks: [],
  })
  for (const task of batch.manifest.cases) for (const candidate of batch.manifest.candidates) for (let repetition = 1; repetition <= batch.manifest.repetitions; repetition++) {
    if (options.signal?.aborted) return store.harnessBenchmark(batch.id)!
    const cell = store.reserveHarnessBenchmarkCell(batch.id, task.id, candidate, repetition)
    if (cell.observation) continue
    // A crash may happen after a model request but before recording its result. Do not replay it.
    if (inherited.has(cell.id)) {
      store.finishHarnessBenchmarkCell(batch.id, cell.id, failure(Math.max(0, Date.now() - cell.reservedAt)))
      continue
    }
    const started = performance.now()
    let observation: TrialObservation
    try { observation = await options.execute({ batchId: batch.id, id: cell.id, caseId: task.id, candidate: structuredClone(candidate), repetition, signal: options.signal }) }
    catch { observation = failure(Math.max(0, performance.now() - started)) }
    store.finishHarnessBenchmarkCell(batch.id, cell.id, observation)
  }
  return store.harnessBenchmark(batch.id)!
}
