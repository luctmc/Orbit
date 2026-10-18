import {test} from 'node:test'
import assert from 'node:assert/strict'
import {fromClaudeStatus,fromCodexRollout} from '../src/usage.ts'
import {budgetStatus} from '@orbit/protocol'

test('session totals and estimated last-turn occupied context are separate; invalid capacity stays unavailable',()=>{
 const event=(capacity:unknown)=>JSON.stringify({type:'event_msg',payload:{type:'token_count',info:{model_context_window:capacity,total_token_usage:{input_tokens:100000,output_tokens:2000,total_tokens:102000},last_token_usage:{input_tokens:400,output_tokens:20}}}})
 const report=fromCodexRollout(event(1000),123)
 assert.equal(report.usage?.total,102000)
 assert.deepEqual(report.context,{kind:'estimated',usedTokens:400,capacityTokens:1000,percent:40,categories:[],source:'codex:last_token_usage',observedAt:123})
 assert.equal(fromCodexRollout(event(-1)).context?.kind,'unavailable')
})
test('Claude measured percentage is independent of accumulated transcript; malformed numbers rejected',()=>{
 const report=fromClaudeStatus({context_window:{used_percentage:125,context_window_size:1000,current_usage:{input_tokens:300,cache_read_input_tokens:40,cache_creation_input_tokens:10}}},123)
 assert.equal(report.context?.kind,'measured');assert.equal(report.context?.percent,125)
 assert.equal(report.context?.usedTokens,null,'percentage does not certify exact token count')
 assert.equal(fromClaudeStatus({context_window:{used_percentage:NaN}}).context?.kind,'unavailable')
 assert.equal(fromClaudeStatus({orbit_session_usage:{}}).context,undefined,'consumption-only poll must not erase fresh context')
})
test('unknown and partial cost cannot be displayed as zero or as a complete budget fraction',()=>{
 const status=budgetStatus({total:0,costUsd:null},{tokens:null,costUsd:10})
 assert.equal(status.share,null);assert.equal(status.cost,'unavailable')
 assert.equal(budgetStatus({total:5,costUsd:2,costComplete:false},{tokens:10,costUsd:10}).share,.5)
 assert.equal(budgetStatus({total:0,costUsd:0,costComplete:true},{tokens:null,costUsd:10}).share,0)
})
test('a newer Codex turn invalidates old context capacity until the new turn reports usage',async()=>{
 const {mkdtempSync,writeFileSync,appendFileSync}=await import('node:fs'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{CodexUsageReader}=await import('../src/adapters/codexUsage.ts')
 const row=(type:string,payload:unknown)=>JSON.stringify({type,payload})+'\n'
 const totals=row('event_msg',{type:'token_count',info:{total_token_usage:{input_tokens:10,output_tokens:2,total_tokens:12,cached_input_tokens:0},last_token_usage:{input_tokens:400},model_context_window:1000}})
 const text=row('session_meta',{id:'session'})+row('turn_context',{turn_id:'old',model:'old',effort:'low'})+totals
 const file=join(mkdtempSync(join(tmpdir(),'orbit-context-turn-')),'session.jsonl');writeFileSync(file,text)
 const reader=new CodexUsageReader();assert.equal(reader.read(file,'session')?.report.context?.kind,'estimated')
 const changed=row('turn_context',{turn_id:'new',model:'new',effort:'low'});appendFileSync(file,changed)
 assert.equal(reader.read(file,'session')?.report.context?.kind,'unavailable')
 assert.equal(fromCodexRollout(text+changed).context?.kind,'unavailable')
 appendFileSync(file,totals);assert.equal(reader.read(file,'session')?.report.context?.kind,'estimated')
})
