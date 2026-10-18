import {test} from 'node:test'
import assert from 'node:assert/strict'
import {PaneManager,SUBMIT_LIMITS} from '../src/panes.ts'
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms))
function fixture(){const panes=new PaneManager('/bin/sh');const writes:string[]=[];const live:any={pty:{write:(s:string)=>writes.push(s),kill:()=>{}},idleTimer:null,hookDriven:false,submitTimer:null,queue:[],closing:false,terminationTimers:[]};(panes as any).live.set(1,live);return {panes,writes,live}}
test('bounded queue rejects overflow, cancels queued ID without typing and expires waiting requests',async()=>{
 const f=fixture(),errors:Error[]=[]
 try{
  f.panes.submit(1,'first')
  for(let i=0;i<SUBMIT_LIMITS.maxQueued;i++)assert.equal(f.panes.submitWithReceipt(1,'queued',undefined,{requestId:`id-${i}`,rejected:e=>errors.push(e)}),true)
  assert.equal(f.panes.submit(1,'overflow'),false)
  assert.equal(f.panes.cancelSubmit(1,'id-0'),'cancelled')
  assert.equal(f.panes.submitWithReceipt(1,'expired',undefined,{queueTimeoutMs:5,rejected:e=>errors.push(e)}),true)
  await sleep(20)
  assert.equal(errors.length,2);assert.deepEqual(f.writes,['first'])
  assert.equal(f.panes.cancelSubmit(1,'missing'),'missing')
 }finally{f.panes.killAll()}
})
test('in-flight cancellation is explicit and cannot promise to undo an already pasted request',()=>{
 const f=fixture();try{f.panes.submitWithReceipt(1,'active',undefined,{requestId:'active'});assert.equal(f.panes.cancelSubmit(1,'active'),'dispatched');assert.deepEqual(f.writes,['active'])}finally{f.panes.killAll()}
})
test('AbortSignal detaches after acceptance and dispatch deadline never acknowledges an expired Enter',async()=>{
 const f=fixture(),abort=new AbortController();let accepted=0;const errors:any[]=[]
 try{f.panes.submitWithReceipt(1,'expiring',()=>accepted++,{signal:abort.signal,dispatchTimeoutMs:1,rejected:e=>errors.push(e)});await sleep(180);assert.equal(accepted,0);assert.equal(f.live.closing,true);assert.equal(errors[0]?.uncertain,true);assert.deepEqual(f.writes,['expiring'])}finally{f.panes.killAll()}
})
test('real WebSocket cancellation records terminal failure without typing or replay on the PTY',async()=>{
 const {mkdtempSync}=await import('node:fs'),{tmpdir}=await import('node:os'),{join}=await import('node:path')
 const {startServer}=await import('../src/server.ts'),{connect,offline,ORIGIN,TOKEN}=await import('./helpers.ts')
 const root=mkdtempSync(join(tmpdir(),'orbit-cancel-'))
 const server=await startServer({port:0,token:TOKEN,allowedOrigins:[ORIGIN],dataDir:root,shell:'/bin/sh',run:offline,browser:null,scheduler:false,agentCommand:()=>({file:'/bin/sh',args:[]})})
 const ui=connect(server.port)
 try{
  await ui.opened;ui.send({type:'workspace.open',path:root});const {workspace}=await ui.next('workspace.updated')
  ui.send({type:'mission.create',workspaceId:workspace.id,title:'Cancellation',objective:'',mode:'livre',lead:{cli:'shell',model:null,title:'Shell'}})
  const {pane}=await ui.next('pane.updated')
  const manager=(server.core as any).panes as PaneManager
  const live=(manager as any).live.get(pane.id)
  // Deterministic dispatch barrier, with a real spawned PTY behind the queue.
  live.submitTimer=setTimeout(()=>{},10000)
  const request={type:'pane.submit' as const,paneId:pane.id,text:'echo MUST_NOT_EXECUTE',requestId:'cancelled-input',allowOriginal:true}
  ui.send(request)
  await sleep(15)
  assert.equal(live.queue.length,1)
  ui.send({type:'pane.queue.cancel',paneId:pane.id,targetRequestId:'cancelled-input',requestId:'cancel-query'})
  assert.equal((await ui.next('pane.queue.cancelled')).outcome,'cancelled')
  assert.equal((await ui.next('pane.submit.error')).pending,false)
  assert.equal(live.queue.length,0)
  ui.send(request);await sleep(20);assert.equal(live.queue.length,0,'same request only reads durable failure')
  assert.doesNotMatch(manager.screenText(pane.id,100),/MUST_NOT_EXECUTE/)
 }finally{ui.ws.close();await server.close()}
})
test('a rejected callback failure is contained and does not crash deadline/cancel processing',()=>{
 const f=fixture(),errors:unknown[]=[];f.panes.on('receiptError',error=>errors.push(error))
 try{f.panes.submit(1,'first');f.panes.submitWithReceipt(1,'second',undefined,{requestId:'bad-callback',rejected:()=>{throw new Error('disk receipt failure')}});assert.equal(f.panes.cancelSubmit(1,'bad-callback'),'cancelled');assert.equal(errors.length,1)}finally{f.panes.killAll()}
})
