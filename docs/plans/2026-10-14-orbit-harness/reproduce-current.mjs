// Regression diagnostic after R0: exit 0 confirms pending work and usage are preserved.
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const scratch = mkdtempSync(join(tmpdir(), 'orbit-harness-probe-'))
process.env.CLAUDE_CONFIG_DIR = join(scratch, 'claude-home')
process.env.CODEX_HOME = join(scratch, 'codex-home')
process.env.GEMINI_CLI_HOME = join(scratch, 'gemini-home')
const { OrbitCore } = await import(new URL('../../../packages/sidecar/src/core.ts', import.meta.url).href)
const events = []
const core = new OrbitCore({dataDir: join(scratch, 'data'), shell: '/bin/sh', browser: null, broadcast: e => events.push(e), run: async()=>({code:127,stdout:'',stderr:'offline'}), agentCommand:()=>({file:'/bin/sh',args:['-c','read line; exit 0']})})
core.setEndpoint('http://127.0.0.1:1')
try {
 core.handle({type:'workspace.open',path:scratch})
 const workspace = core.store.snapshot().workspaces[0]
 core.handle({type:'mission.create',workspaceId:workspace.id,title:'Synthetic harness probes',objective:'',mode:'agentica',lead:{cli:'shell',model:null,title:'Lead'}})
 const lead = core.store.snapshot().panes.find(p=>p.role==='lead')
 const opened = await core.spawnHelper(lead,{title:'Synthetic worker',task:'Read synthetic input',cli:'claude',model:null})
 const id = opened.pane.id
 const pendingStop = core.hookReport(id,{hook_event_name:'Stop',stop_hook_active:false})
 assert.equal(pendingStop.decision, 'block')
 core.handoff(core.store.pane(id),{status:'progress',summary:'Synthetic midway'})
 const progressStop = core.hookReport(id,{hook_event_name:'Stop',stop_hook_active:false})
 assert.equal(progressStop,null)
 assert.throws(()=>core.missionReady(lead,'Synthetic ready',false), /falta retorno/)
 core.panes.write(id, '\r')
 await new Promise(r=>setTimeout(r,1000))
 const exitedProgress = core.store.pane(id)
 assert.throws(()=>core.missionReady(lead,'Unfinished worker exited',false), /falta retorno/)
 const usageWorker = await core.spawnHelper(lead,{title:'Synthetic usage worker',task:'Read synthetic usage input',cli:'claude',model:null})
 const usageId = usageWorker.pane.id
 const status = {context_window:{total_input_tokens:1000,total_output_tokens:100,used_percentage:5},cost:{total_cost_usd:0.01}}
 core.statusReport(usageId,status)
 assert.equal(core.store.mission(lead.missionId).usage.total,1100)
 core.hookReport(usageId,{hook_event_name:'SessionStart',session_id:'3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f'})
 core.handle({type:'pane.restart',paneId:usageId,resume:true})
 const baselineAfterResume = core.store.pane(usageId).usage
 core.statusReport(usageId,status)
 const afterIdenticalResumeReport = core.store.mission(lead.missionId).usage.total
 assert.equal(baselineAfterResume?.total,1100)
 assert.equal(afterIdenticalResumeReport,1100)
 console.log(JSON.stringify({probe:'progress-obligation',pendingStopBlocks:pendingStop.decision,progressStop,readyWhileAlive:false,statusAfterExit:exitedProgress.status,assignedByAfterExit:exitedProgress.assignedBy,handoffAfterExit:exitedProgress.handoffStatus,readyAfterProgressExit:false}))
 console.log(JSON.stringify({probe:'resume-usage-baseline',before:1100,baselineAfterResume,identicalCumulativeReport:1100,missionTotalAfter:afterIdenticalResumeReport,expectedWithoutDoubleCount:1100}))
} finally {core.shutdown()}
