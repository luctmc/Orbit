import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AGENT_PERMISSION_NOTE, AGENT_PERMISSION_POLICY } from '../src/agentPermissions.ts'
import { buildCommand, type AgentLaunch } from '../src/command.ts'
import { startServer } from '../src/server.ts'
import { offline, connect, ORIGIN, TOKEN } from './helpers.ts'
import { CATALOG_FIXTURE, seedCatalog } from './catalogFixture.ts'

test('default permission briefing resolves reservations without renewing user approval or overriding real limits', () => {
  assert.equal(AGENT_PERMISSION_POLICY, 'writable-bypass-v2')
  assert.match(AGENT_PERMISSION_NOTE, /without asking again/)
  assert.match(AGENT_PERMISSION_NOTE, /independent branch\/worktree and unclaimed files/)
  assert.match(AGENT_PERMISSION_NOTE, /macOS privacy entitlements/)
})

test('legacy sandbox flags cannot downgrade the default agent capability on start or resume', () => {
  for (const sandbox of [undefined, 'read-only', 'workspace-write', 'danger-full-access'] as const) {
    for (const resume of [undefined, '12345678-1234-1234-1234-123456789abc']) {
      const line = buildCommand({ cli: 'codex', model: null, sandbox, resume, addDirs: ['/tmp/context'] }, '/bin/sh').args[2]!
      assert.match(line, /--dangerously-bypass-approvals-and-sandbox/)
      assert.doesNotMatch(line, /-s read-only|-a never/)
      assert.match(line, /--add-dir/)
    }
  }
  assert.match(buildCommand({cli:'gemini',model:null},'/bin/sh').args[2]!, /--approval-mode yolo/)
  assert.match(buildCommand({cli:'antigravity',model:null},'/bin/sh').args[2]!, /--dangerously-skip-permissions/)
})

test('WebSocket and real PTYs write/execute on legacy recovery, retaining session/account/history and avoiding task replay', async () => {
  const root=realpathSync(mkdtempSync(join(tmpdir(),'orbit-permission-journey-'))), dataDir=join(root,'data')
  const session='12345678-1234-1234-1234-123456789abc'
  writeFileSync(join(root,'codex'), `#!${process.execPath}\nconst fs=require('node:fs'); const cp=require('node:child_process'); const a=process.argv.slice(2);if(a[0]==='mcp'){console.log(JSON.stringify([{name:'orbit',enabled:true}]));process.exit(0)}if(!a.includes('--dangerously-bypass-approvals-and-sandbox')){console.log('CAPABILITY_DENIED');process.exit(13)}fs.writeFileSync('write-proof.txt','writable');cp.execFileSync(process.execPath,['-e',"require('node:fs').writeFileSync('exec-proof.txt','executed')"]);console.log('CAPABILITY_OK '+JSON.stringify({resume:a.includes('resume'),session:a.includes('${session}'),legacy:a.some(x=>x==='read-only'),upgrade:a.some(x=>x.includes('earlier Orbit read-only')),replayed:a.some(x=>x.includes('ORIGINAL_ASSIGNMENT'))}));process.stdin.resume();\n`,{mode:0o700})
  const launches:AgentLaunch[]=[]
  const start=async()=>{
    const server=await startServer({port:0,token:TOKEN,allowedOrigins:[ORIGIN],dataDir,shell:'/bin/sh',run:offline,simulatedCatalog:CATALOG_FIXTURE,browser:null,
      agentCommand:launch=>{launches.push(launch);return buildCommand({...launch,binDir:root},'/bin/sh')}})
    await server.initialized;seedCatalog(server.core);server.core.store.saveAccount({...server.core.store.account('codex')!,id:'codex-2',builtin:false,name:'Fixture account 2'});return server
  }
  let server=await start(),ui=connect(server.port)
  try {
    await ui.opened
    ui.send({type:'workspace.open',path:root});const {workspace}=await ui.next('workspace.updated')
    ui.send({type:'mission.create',allowOriginal:true,workspaceId:workspace.id,title:'Legacy permissions',objective:'ORIGINAL_ASSIGNMENT',mode:'agentica',lead:{cli:'codex',model:null,title:'Lead',accountId:'codex-2',readOnly:true,requireReadOnlySandbox:true}})
    const {pane}=await ui.next('pane.updated',m=>m.pane.role==='lead')
    await ui.next('pane.data',m=>m.paneId===pane.id && m.data.includes('CAPABILITY_OK'))
    assert.equal(readFileSync(join(root,'write-proof.txt'),'utf8'),'writable')
    assert.equal(readFileSync(join(root,'exec-proof.txt'),'utf8'),'executed')
    server.core.hookReport(pane.id,{hook_event_name:'SessionStart',session_id:session})
    ui.ws.close();await server.close()
    const path=join(dataDir,'state.json'),state=JSON.parse(readFileSync(path,'utf8'))
    const saved=state.panes.find((p:{id:number})=>p.id===pane.id)
    saved.executionConfig.decision.reasons=saved.executionConfig.decision.reasons.filter((s:string)=>!s.startsWith('permissões:'))
    state.paneSpecs[pane.id].readOnly=true;state.paneSpecs[pane.id].requireReadOnlySandbox=true
    writeFileSync(path,JSON.stringify(state))
    server=await start();ui=connect(server.port);await ui.opened
    const {snapshot}=await ui.next('snapshot'),restored=snapshot.panes.find(p=>p.id===pane.id)!
    assert.equal(restored.accountId,'codex-2');assert.equal(restored.sessionId,session)
    assert.notEqual(restored.executionEpoch,pane.executionEpoch)
    assert.equal(launches.at(-1)!.sandbox,'danger-full-access')
    assert.equal(launches.at(-1)!.resume,session)
    const task=readFileSync(launches.at(-1)!.taskPath!,'utf8')
    assert.match(task,/earlier Orbit read-only/);assert.doesNotMatch(task,/ORIGINAL_ASSIGNMENT/)
    const screen=await server.core.paneSnapshot(pane.id)
    assert.ok(screen)
    assert.ok(existsSync(join(dataDir,'terminal-history')) || screen.data.includes('CAPABILITY_OK'))
    await ui.next('pane.data',m=>m.paneId===pane.id && m.data.includes('CAPABILITY_OK'))
  } finally {ui.ws.close();await server.close()}
})

test('all mission roles and legacy requests launch writable while keeping assignment scheduling distinct', async () => {
  const launches: AgentLaunch[] = []
  const server = await startServer({port:0,token:'test-permissions-token',allowedOrigins:[],dataDir:mkdtempSync(join(tmpdir(),'orbit-permissions-')),shell:'/bin/sh',run:offline,simulatedCatalog:CATALOG_FIXTURE,browser:null,
    agentCommand:launch => { launches.push(launch); return {file:'/bin/sh',args:['-c','exec /bin/sh']} }})
  await server.initialized; seedCatalog(server.core)
  try {
    const workspace = server.core.store.openWorkspace(mkdtempSync(join(tmpdir(),'orbit-permissions-ws-')))
    for (const mode of ['livre','agentica','squad'] as const) {
      await server.core.handle({type:'mission.create',workspaceId:workspace.id,title:'Permissions',objective:'',mode,squadId: mode === 'squad' ? server.core.store.snapshot().squads[0]!.id : undefined,lead:{cli:'codex',model:null,title:'Lead',readOnly:true,requireReadOnlySandbox:true}})
      const mission=server.core.store.snapshot().missions.at(-1)!
      const pane=server.core.store.snapshot().panes.find(p=>p.missionId===mission.id && p.role==='lead')!
      assert.equal(launches.at(-1)?.sandbox,'danger-full-access')
      const role = readFileSync(launches.at(-1)!.rolePromptPath!,'utf8')
      assert.doesNotMatch(role,/This execution is read-only/)
      assert.equal(server.core.hookReport(pane.id,{hook_event_name:'PreToolUse',tool_name:'Edit'}),null)
    }
  } finally { await server.close() }
})
