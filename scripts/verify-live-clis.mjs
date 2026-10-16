import { randomBytes } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { startServer } from '../packages/sidecar/src/server.ts'
import { loginShellRunner } from '../packages/sidecar/src/clis.ts'
// Opt-in: sends a small synthetic task through the user's authenticated CLI accounts.
if (!process.argv.includes('--live')) {
 console.log('Run node scripts/verify-live-clis.mjs --live to test authenticated Claude and Codex with a synthetic temporary repository.');
 process.exit(0);
}
const token = randomBytes(32).toString('hex')
const dataDir = mkdtempSync(join(tmpdir(), 'orbit-real-runtime-'))
const workspacePath = mkdtempSync(join(tmpdir(), 'orbit-real-project-'))
writeFileSync(join(workspacePath, 'canary.txt'), 'ORBIT_SYNTHETIC_CANARY_8421\n')
execFileSync('git', ['init', '-q', workspacePath])
const shellRun = loginShellRunner('/bin/zsh')
const runner = (command, timeout) => /npm view|agy|gemini/.test(command) ? Promise.resolve({code:127,stdout:'',stderr:'not part of smoke'}) : shellRun(command === 'codex debug models' ? 'codex debug models --bundled' : command, timeout)
const server = await startServer({port:0,token,allowedOrigins:['http://localhost:5374'],dataDir,shell:'/bin/zsh',browser:null,scheduler:false,run:runner})
console.log(JSON.stringify({phase:'ready',port:server.port,dataDir,workspacePath}))
server.core.handle({type:'workspace.open',path:workspacePath})
const workspace = server.core.store.snapshot().workspaces[0]
server.core.handle({type:'mission.create',workspaceId:workspace.id,title:'Orbit real CLI validation',objective:'Read a synthetic canary and submit a handoff; no project changes',mode:'livre',lead:{cli:'shell',model:null,title:'Smoke sink'},budget:{tokens:150000,costUsd:0.5}})
try {
  const lead = server.core.store.snapshot().panes[0]
  await new Promise(resolve=>setTimeout(resolve,1500))
  const raw = execFileSync('codex',['debug','models','--bundled'],{encoding:'utf8',maxBuffer:10*1024*1024})
  const models = JSON.parse(raw).models ?? JSON.parse(raw)
  const codexModel = models.find(m=>/luna|mini/i.test(m.slug??''))?.slug ?? models.find(m=>m.visibility!=='hide')?.slug ?? null
  const helpers=[]
  for (const cli of ['claude','codex']) {
   const helper = await server.core.spawnHelper(lead,{title:`Real ${cli} smoke`,task:`This is a bounded Orbit integration test in a temporary repository. Read canary.txt. Do not edit files or call external services/tools. Then call the Orbit MCP tool handoff_submit with status done, summary ORBIT_LIVE_SMOKE_${cli.toUpperCase()}, and evidence containing the exact canary text. Do not ask for follow-up. If Orbit MCP is unavailable, state ORBIT_MCP_UNAVAILABLE.`,cli,model:cli==='claude'?'haiku':codexModel,effort:'low',taskTypeId:'investigacao',activityId:`live-${cli}`})
   helpers.push(helper.pane.id)
   console.log(JSON.stringify({phase:'spawned',cli,paneId:helper.pane.id,model:helper.pane.model,cwd:helper.pane.cwd}))
  }
  const screen = server.core
  const trusted = new Set()
  process.on('SIGTERM',async()=>{await server.close();process.exit()})
  const deadline=Date.now()+110000
  let last=''
  while(Date.now()<deadline) {
   const state=server.core.store.snapshot()
   const status=state.panes.filter(p=>helpers.includes(p.id)).map(p=>({id:p.id,cli:p.cli,status:p.status,sessionId:p.sessionId,handoff:p.handoffStatus,attention:p.attention}))
   const summary=JSON.stringify(status)
   if(summary!==last) {console.log(JSON.stringify({phase:'status',agents:status}));last=summary}
   const screens=Object.fromEntries(helpers.map(id=>[id,screen.panes.screenText(id,100)]))
   for (const id of helpers) {
    if (!trusted.has(id) && (screens[id].includes('Quick safety check') || screens[id].includes('Trust this folder?')) && screens[id].includes(basename(workspacePath))) {
     trusted.add(id)
     server.core.handle({type:'pane.input',paneId:id,data:screens[id].includes('Trust this folder?') ? '\r' : '\x1b[B\r'})
     console.log(JSON.stringify({phase:'trusted-owned-temporary-workspace',paneId:id}))
    }
   }
   writeFileSync(join(dataDir,'screens.json'),JSON.stringify(screens,null,2),{mode:0o600})
   writeFileSync(join(dataDir,'summary.json'),JSON.stringify({agents:status,events:state.events.filter(e=>e.kind==='handoff').map(e=>({title:e.title,body:e.body})),dataDir,workspacePath},null,2),{mode:0o600})
   if(status.every(p=>p.handoff==='done')) break
   await new Promise(resolve=>setTimeout(resolve,2000))
  }
  const final = server.core.store.snapshot();
  const passed = final.panes.filter(p=>helpers.includes(p.id)).every(p=>p.handoffStatus==='done' && p.sessionId) && helpers.every(id=>final.events.some(e=>e.kind==='handoff' && e.paneId===id && e.body?.includes('ORBIT_SYNTHETIC_CANARY_8421')));
  console.log(JSON.stringify({phase:'finished',passed,dataDir})); process.exitCode = passed ? 0 : 1
} finally { await server.close() }
