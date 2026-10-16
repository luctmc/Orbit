import { test } from 'node:test'
import assert from 'node:assert/strict'
import { composeHarness } from '../src/harness.ts'
import { emptyHarnessPolicy, beginHarnessBatch, reserveHarnessCell, finishHarnessCell, promoteHarnessBatch, rollbackHarnessPolicy, activeHarnessEvidence, type TrialObservation } from '../src/benchmarks/harnessPolicy.ts'
import type { HarnessMatrix } from '../src/benchmarks/harnessMatrix.ts'
const revision = 'c'.repeat(64)
const strategy = composeHarness({ kind: 'bug', difficulty: 'normal', readOnly: false, retry: false })
const candidate = { cli: 'codex' as const, model: 'fixture', effort: 'high' as const, cliVersion: 'fixture-v1', catalogRevision: 'fixture-catalog' }
const manifest = (): Omit<HarnessMatrix, 'runs'> => ({ version: 1, sourceRevision: revision, corpusRevision: 'a'.repeat(64), oracleRevision: 'b'.repeat(64), strategies: [strategy], candidates: [candidate], repetitions: 4, cases: Array.from({length:11},(_,i)=>({id:`case-${i}`,revision:i.toString(16).padStart(64,'0'),projectId:`project-${i%2}`,partition:i===0?'calibration':'holdout',strategyKey:strategy.key})) })
const observation = (): TrialObservation => ({ exitCode: 0, error: null, durationMs: 100, observedAt: Date.now() - 100, identity: {models:['fixture'],efforts:['high'],level:'response',complete:true}, usage: {input:80,output:20,cacheRead:0,cacheWrite:0,total:100,costUsd:null}, checks:[{command:'synthetic protected oracle',exitCode:0,summary:'fixture matches'}] })
function completed(mode: 'live'|'simulated'='live') {
  const state = emptyHarnessPolicy()
  const batch = beginHarnessBatch(state, manifest(), mode, revision)
  for(const c of batch.manifest.cases) for(let i=1;i<=4;i++) {
    const cell = reserveHarnessCell(state,batch.id,c.id,candidate,i,revision)
    finishHarnessCell(state,batch.id,cell.id,observation(),revision)
  }
  return {state,batch}
}
test('reservations survive as missing work; replay is idempotent and contradictory results are refused', () => {
  const state = emptyHarnessPolicy(), batch=beginHarnessBatch(state,manifest(),'live',revision)
  const cell = reserveHarnessCell(state,batch.id,'case-0',candidate,1,revision)
  assert.equal(reserveHarnessCell(state,batch.id,'case-0',candidate,1,revision).id,cell.id)
  assert.throws(()=>promoteHarnessBatch(state,batch.id,revision),/incompleta/)
  const result=observation()
  finishHarnessCell(state,batch.id,cell.id,result,revision)
  finishHarnessCell(state,batch.id,cell.id,result,revision)
  assert.throws(()=>finishHarnessCell(state,batch.id,cell.id,{...result,exitCode:1},revision),/outro resultado/)
  assert.equal(state.batches[0]!.cells.length,1)
})
test('only a complete live qualified matrix can promote; source mismatch and simulation remain fallback', () => {
  const {state,batch}=completed()
  const promoted=promoteHarnessBatch(state,batch.id,revision)
  assert.equal(activeHarnessEvidence(state,revision).length,40)
  assert.equal(activeHarnessEvidence(state,'d'.repeat(64)).length,0)
  assert.deepEqual(promoteHarnessBatch(state,batch.id,revision),promoted)
  assert.throws(()=>promoteHarnessBatch(state,batch.id,'d'.repeat(64)),/runtime/)
  const offline=completed('simulated')
  assert.throws(()=>promoteHarnessBatch(offline.state,offline.batch.id,revision),/simulada/)
  assert.equal(activeHarnessEvidence(offline.state,revision).length,0)
})
test('configured identity alone and self-declared success without an oracle cannot qualify', () => {
  const {state,batch}=completed()
  const cell=batch.cells[0]!
  cell.observation!.identity.level='execution-context'
  assert.throws(()=>promoteHarnessBatch(state,batch.id,revision),/identidade|qualifica/)
  const other=completed(); other.batch.cells[1]!.observation!.checks=[]
  assert.throws(()=>promoteHarnessBatch(other.state,other.batch.id,revision),/qualifica|oracle/)
})
test('rollback is audited, survives serialization and never resurrects a retired matrix', () => {
  const {state,batch}=completed()
  const promoted=promoteHarnessBatch(state,batch.id,revision)
  rollbackHarnessPolicy(state,promoted.id,'Synthetic regression')
  assert.equal(activeHarnessEvidence(state,revision).length,0)
  assert.equal(activeHarnessEvidence(JSON.parse(JSON.stringify(state)),revision).length,0)
  assert.equal(state.transitions.at(-1)!.kind,'rollback')
  assert.throws(()=>promoteHarnessBatch(state,batch.id,revision),/retirada/)
})

test('Store persists journal and rolls back a failed promotion without exposing policy through snapshot', async () => {
  const { Store }=await import('../src/store.ts')
  const { harnessRuntimeRevision }=await import('../src/harnessRuntime.ts')
  const { mkdtempSync, mkdirSync, rmSync }=await import('node:fs')
  const { join }=await import('node:path')
  const { tmpdir }=await import('node:os')
  const root=mkdtempSync(join(tmpdir(),'orbit-policy-store-')), store=new Store(root)
  const m={...manifest(),sourceRevision:harnessRuntimeRevision()!}
  const batch=store.beginHarnessBenchmark(m,'live')
  for(const c of m.cases) for(let i=1;i<=4;i++) {
    const cell=store.reserveHarnessBenchmarkCell(batch.id,c.id,candidate,i)
    store.finishHarnessBenchmarkCell(batch.id,cell.id,observation())
  }
  const blocked=join(root,'state.json.tmp')
  mkdirSync(blocked)
  assert.throws(()=>store.promoteHarnessBenchmark(batch.id))
  assert.equal(store.harnessEvidence().length,0)
  rmSync(blocked,{recursive:true})
  const promotion=store.promoteHarnessBenchmark(batch.id)
  assert.equal(store.harnessEvidence().length,40)
  store.flush()
  const reopened=new Store(root)
  assert.equal(reopened.harnessEvidence().length,40)
  assert.deepEqual(reopened.promoteHarnessBenchmark(batch.id),promotion)
  assert(!('harnessPolicy' in reopened.snapshot()))
  reopened.rollbackHarnessBenchmark(promotion.id,'Synthetic rollback after restart')
  reopened.flush()
  assert.equal(new Store(root).harnessEvidence().length,0)
  assert.throws(()=>reopened.promoteHarnessBenchmark(batch.id),/retirada/)
})

test('manifest cannot lower invariant quality/review constraints or request an oversized matrix', () => {
  const weak=manifest(); weak.strategies=[{...strategy,qualityFloor:0,independentReviewRequired:false as any}]
  assert.throws(()=>beginHarnessBatch(emptyHarnessPolicy(),weak,'live',revision),/inválid|restri|estratég/)
  const oversized={...manifest(),cases:Array(1001).fill(manifest().cases[0])}
  assert.throws(()=>beginHarnessBatch(emptyHarnessPolicy(),oversized,'live',revision))
})

test('rollback restores the previous qualified policy; mutated promoted evidence becomes inactive', () => {
  const {state,batch}=completed()
  const first=promoteHarnessBatch(state,batch.id,revision)
  const secondBatch=beginHarnessBatch(state,manifest(),'live',revision)
  for(const c of secondBatch.manifest.cases) for(let i=1;i<=4;i++) {
    const cell=reserveHarnessCell(state,secondBatch.id,c.id,candidate,i,revision)
    finishHarnessCell(state,secondBatch.id,cell.id,observation(),revision)
  }
  const second=promoteHarnessBatch(state,secondBatch.id,revision)
  assert.equal(state.activeId,second.id)
  promoteHarnessBatch(state,batch.id,revision)
  assert.equal(state.activeId,second.id,'replaying an older promotion cannot reactivate it')
  rollbackHarnessPolicy(state,second.id,'Synthetic regression in second policy')
  assert.equal(state.activeId,first.id)
  assert.equal(activeHarnessEvidence(state,revision).length,40)
  batch.cells[0]!.observation!.usage.total=0
  assert.equal(activeHarnessEvidence(state,revision).length,0)
})
