import { nativeClient } from './native-client.mjs'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
const root=fileURLToPath(new URL('../../../',import.meta.url)),out=new URL('.',import.meta.url)
const client=await nativeClient(), checks=[], errors=[], evidence={mode:'installed sidecar; real Codex CLI',checks,errors}
const check=(name,value)=>{checks.push({name,pass:!!value});if(!value)throw Error(name)}
let missionId,workspaceId,lead,helper
try {
 const catalog=(await client.next('catalog')).catalog
 await client.next('account.status',m=>m.statuses.length&&m.statuses.every(s=>!s.busy))
 const statuses=client.messages.filter(m=>m.type==='account.status').at(-1).statuses
 const account=client.snapshot.accounts.find(a=>a.cli==='codex'&&statuses.some(s=>s.accountId===a.id&&s.loggedIn))
 check('authenticated Codex account exists',account)
 const model=catalog.codex.models.find(m=>m.id==='gpt-6-luna')?.id
 check('requested model available in native catalog',model)
 const path=mkdtempSync('/private/tmp/orbit-native-qa-');mkdirSync(path,{recursive:true})
 client.send({type:'workspace.open',path})
 const {workspace}=await client.next('workspace.updated',m=>m.workspace.path===path);workspaceId=workspace.id
 const requestId=crypto.randomUUID();evidence.creationRequestId=requestId
 const existing=client.snapshot.missions.find(m=>m.workspaceId===workspaceId&&m.title==='QA continuidade e recibos · temporária'&&m.status==='active')
 let created
 if(existing){created={mission:existing};missionId=existing.id;lead=client.snapshot.panes.find(p=>p.missionId===missionId&&p.role==='lead');evidence.reconciledExistingMission=true}
 else {client.send({type:'mission.create',requestId,workspaceId,title:'QA continuidade e recibos · temporária',objective:'',mode:'agentica',allowedClis:['codex','claude'],adaptiveLead:false,lead:{cli:'codex',model,effort:'low',accountId:account.id,title:'Líder QA'},allowOriginal:true});created=await client.next('mission.created',m=>m.requestId===requestId,60000);missionId=created.mission.id;lead=(await client.next('pane.updated',m=>m.pane.missionId===missionId&&m.pane.role==='lead')).pane}

 check('leader opens without objective',!!lead.pid&&created.mission.objective==='')
 check('native launch receipt preserves explicit model and low effort',lead.executionConfig?.decision.requested.cli==='codex'&&lead.executionConfig?.applied.model===model&&lead.executionConfig?.applied.effort==='low')
 // Wait for native CLI readiness rather than treating process creation as delivery.
 if(!lead.sessionId) await client.next('pane.updated',m=>m.pane.id===lead.id&&m.pane.sessionId,45000)
 const submitId=crypto.randomUUID(),submit={type:'pane.submit',requestId:submitId,paneId:lead.id,text:'Responda apenas ORBIT_QA_RECIBO_OK. Não use ferramentas nem altere arquivos.',allowOriginal:true}
 client.send(submit)
 const receipt=await client.next('pane.submitted',m=>m.requestId===submitId,15000)
 client.send(submit)
 await new Promise(resolve=>setTimeout(resolve,300))
 const receipts=client.messages.filter(m=>m.type==='pane.submitted'&&m.requestId===submitId)
 check('native receipt names original execution and acceptance time',receipt.executionEpoch===lead.executionEpoch&&receipt.acceptedAt>0)
 check('duplicate request returns identical receipt',receipts.length===2&&JSON.stringify(receipts[0])===JSON.stringify(receipts[1]))
 // A provider response is stronger evidence than the PTY ACK; query only this new QA session.
 let response='',observed
 const deadline=Date.now()+60000
 while(Date.now()<deadline){client.send({type:'pane.conversation',paneId:lead.id});await new Promise(resolve=>setTimeout(resolve,1000));const turns=client.messages.filter(m=>m.type==='pane.conversation'&&m.paneId===lead.id).at(-1)?.turns??[];response=turns.filter(t=>t.role==='agente').map(t=>t.text).join('\n');observed=client.messages.filter(m=>m.type==='pane.updated'&&m.pane.id===lead.id).at(-1)?.pane;if(response.includes('ORBIT_QA_RECIBO_OK'))break}
 check('real provider answers QA marker',response.includes('ORBIT_QA_RECIBO_OK'))
 evidence.lead={id:lead.id,model,effort:'low',executionEpoch:lead.executionEpoch,receipt,reportedModels:observed?.reportedModels,reportedEfforts:observed?.reportedEfforts,identityEvidence:observed?.identityEvidence,responseMarker:'ORBIT_QA_RECIBO_OK'}
 const spawnId=crypto.randomUUID()
 client.send({type:'pane.spawn',requestId:spawnId,request:{missionId,role:'crew',cli:'codex',model,effort:'low',accountId:account.id,title:'Ajudante QA',task:null}})
 helper=(await client.next('pane.spawned',m=>m.requestId===spawnId,20000)).pane
 await client.next('pane.updated',m=>m.pane.id===helper.id&&m.pane.sessionId,45000)
 check('real helper CLI reports session readiness',true)
 check('real helper spawns with independent process and epoch',!!helper.pid&&helper.pid!==lead.pid&&helper.executionEpoch!==lead.executionEpoch)
 evidence.helper={id:helper.id,executionEpoch:helper.executionEpoch,pid:helper.pid,applied:helper.executionConfig?.applied}
} catch(e){errors.push(e.message);evidence.messageTrace=client.messages.filter(m=>m.type!=='pane.data'&&m.type!=='snapshot').map(m=>({type:m.type,requestId:m.requestId,message:m.message,paneId:m.paneId}))} finally {
 if(missionId){client.send({type:'mission.archive',missionId});await client.next('mission.updated',m=>m.mission.id===missionId&&m.mission.status==='archived')}
 if(workspaceId){const before=client.messages.length;client.send({type:'workspace.delete',workspaceId,conversations:false,branches:false});await client.next('snapshot',m=>client.messages.indexOf(m)>=before&&!m.snapshot.workspaces.some(w=>w.id===workspaceId))}
 client.ws.close()
 evidence.cleanup={missionId,workspaceId,action:missionId?'QA mission archived and QA workspace entry removed; user workspaces unchanged; provider conversations retained':'no QA mission created',workspacePath:'isolated /private/tmp/orbit-native-qa-* (avoids macOS protected Documents for programmatic fixture)'}
 writeFileSync(new URL('native-live.json',out),JSON.stringify(evidence,null,2)+'\n')
}
console.log(JSON.stringify(evidence,null,2));if(errors.length)process.exitCode=1
