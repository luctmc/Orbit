import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Store } from '../src/store.ts'
import { composeHarness } from '../src/harness.ts'
import { harnessRuntimeRevision } from '../src/harnessRuntime.ts'
import { runHarnessBenchmark } from '../src/benchmarks/harnessRunner.ts'
import type { HarnessMatrix } from '../src/benchmarks/harnessMatrix.ts'
const candidate={cli:'codex' as const,model:'fixture',effort:'low' as const,cliVersion:'fixture-v1',catalogRevision:'fixture-catalog'}
function manifest():Omit<HarnessMatrix,'runs'> {
  const strategy=composeHarness({kind:'bug',difficulty:'normal',readOnly:false,retry:false})
  return {version:1,corpusRevision:'a'.repeat(64),sourceRevision:harnessRuntimeRevision()!,oracleRevision:'b'.repeat(64),strategies:[strategy],candidates:[candidate],repetitions:1,cases:[{id:'calibration',revision:'1'.repeat(64),projectId:'fixture-1',partition:'calibration',strategyKey:strategy.key},{id:'holdout',revision:'2'.repeat(64),projectId:'fixture-2',partition:'holdout',strategyKey:strategy.key}]}
}
test('coordinator reserves before dispatch, retains thrown failures and never imports simulation as live evidence', async()=>{
  const store=new Store(mkdtempSync(join(tmpdir(),'orbit-harness-runner-')))
  let calls=0
  const batch=await runHarnessBenchmark(store,manifest(),{mode:'simulated',execute:async cell=>{
    calls++
    assert(store.harnessBenchmark(cell.batchId)!.cells.some(c=>c.id===cell.id && c.observation===null))
    throw new Error('Synthetic executor failure')
  }})
  assert.equal(calls,2)
  assert(batch.cells.every(c=>c.observation?.error==='infrastructure' && c.observation.usage.total===null))
  assert.throws(()=>store.promoteHarnessBenchmark(batch.id),/simulada/)
  assert.equal(store.harnessEvidence().length,0)
})
test('restart never redispatches an already reserved cell with ambiguous effects', async()=>{
  const root=mkdtempSync(join(tmpdir(),'orbit-harness-recovery-')), store=new Store(root), m=manifest()
  const batch=store.beginHarnessBenchmark(m,'simulated')
  const reserved=store.reserveHarnessBenchmarkCell(batch.id,'calibration',candidate,1)
  const restarted=new Store(root)
  let calls=0
  const done=await runHarnessBenchmark(restarted,m,{mode:'simulated',resumeBatchId:batch.id,execute:async cell=>{
    calls++;assert.notEqual(cell.id,reserved.id)
    throw new Error('Synthetic remaining cell failure')
  }})
  assert.equal(calls,1)
  assert.equal(done.cells.length,2)
  assert.equal(done.cells.find(c=>c.id===reserved.id)!.observation!.error,'infrastructure')
  assert.equal(done.cells.find(c=>c.id===reserved.id)!.observation!.exitCode,null)
})
