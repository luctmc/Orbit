import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,writeFileSync,statSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {ensureRuntimeDaemon,startRuntimeBridge} from '../src/runtimeDaemon.ts'
import {connect,ORIGIN,TOKEN} from './helpers.ts'
const entry=new URL('./fixtures/runtime-daemon.mjs',import.meta.url).pathname

test('UI/sidecar bridges restart while daemon PTY, epoch, token and durable history stay intact',async()=>{
 const dataDir=mkdtempSync(join(tmpdir(),'orbit-daemon-'))
 let bridge:Awaited<ReturnType<typeof startRuntimeBridge>>|undefined,daemon:Awaited<ReturnType<typeof ensureRuntimeDaemon>>|undefined,ui:ReturnType<typeof connect>|undefined
 try{
  daemon=await ensureRuntimeDaemon({dataDir,entry,shell:'/bin/sh',allowedOrigins:[ORIGIN]})
  bridge=await startRuntimeBridge({daemon,token:TOKEN,port:0,allowedOrigins:[ORIGIN]})
  ui=connect(bridge.port);await ui.opened
  ui.send({type:'workspace.open',path:dataDir});const {workspace}=await ui.next('workspace.updated')
  ui.send({type:'mission.create',workspaceId:workspace.id,title:'Daemon',objective:'',mode:'livre',lead:{cli:'shell',model:null,title:'Lead'}})
  const {pane}=await ui.next('pane.updated')
  ui.send({type:'pane.input',paneId:pane.id,data:'echo DURABLE_MARKER\r'})
  await ui.next('pane.data',m=>m.data.includes('DURABLE_MARKER'))
  ui.ws.close();await bridge.close()
  const reconnected=await ensureRuntimeDaemon({dataDir,entry,shell:'/bin/sh',allowedOrigins:[ORIGIN]})
  assert.equal(reconnected.instanceId,daemon.instanceId)
  bridge=await startRuntimeBridge({daemon:reconnected,token:TOKEN+'new',port:0,allowedOrigins:[ORIGIN]})
  ui=connect(bridge.port,TOKEN+'new');await ui.opened;const {snapshot}=await ui.next('snapshot')
  const back=snapshot.panes.find(p=>p.id===pane.id)!
  assert.equal(back.pid,pane.pid);assert.equal(back.executionEpoch,pane.executionEpoch)
  ui.send({type:'pane.attach',paneId:pane.id});assert.match((await ui.next('pane.snapshot')).data,/DURABLE_MARKER/)
  const state=JSON.parse(readFileSync(join(dataDir,'runtime-daemon','connection.json'),'utf8'))
  assert.equal(statSync(join(dataDir,'runtime-daemon','connection.json')).mode&0o777,0o600)
  assert.equal((await fetch(`http://127.0.0.1:${state.port}/runtime/status`)).status,401)
  const auth={authorization:`Bearer ${state.token}`}
  assert.equal((await fetch(`http://127.0.0.1:${state.port}/runtime/stop`,{method:'POST',headers:auth})).status,409,'live processes must not be killed to upgrade')
  ui.send({type:'pane.close',paneId:pane.id});await ui.next('pane.removed')
  await new Promise(r=>setTimeout(r,30))
 }finally{
  ui?.ws.close();await bridge?.close()
  if(daemon)await fetch(`http://127.0.0.1:${daemon.port}/runtime/stop`,{method:'POST',headers:{authorization:`Bearer ${daemon.token}`}}).catch(()=>{})
 }
})
test('a dead bridge with unconfirmed detached spawn never creates a second engine',async()=>{
 const {spawn}=await import('node:child_process'),{once}=await import('node:events'),{existsSync,mkdirSync}=await import('node:fs')
 const exited=spawn('/bin/sh',['-c','exit 0']);const pid=exited.pid!;await once(exited,'exit')
 const dataDir=mkdtempSync(join(tmpdir(),'orbit-daemon-lock-')),root=join(dataDir,'runtime-daemon');mkdirSync(root,{mode:0o700})
 writeFileSync(join(root,'boot.lock'),JSON.stringify({pid,phase:'starting',instanceId:'0'.repeat(32)}),{mode:0o600})
 await assert.rejects(ensureRuntimeDaemon({dataDir,entry,shell:'/bin/sh',allowedOrigins:[ORIGIN],bootTimeoutMs:50}),/inicializador/)
 assert.equal(existsSync(join(root,'connection.json')),false)
})
