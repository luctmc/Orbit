// First-party deterministic fixture: real core, WebSocket and PTYs; no live provider calls.
import {createServer} from 'vite'
import react from '@vitejs/plugin-react'
import {mkdirSync,writeFileSync,mkdtempSync,readFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
const base=new URL('../../../',import.meta.url).pathname,root=mkdtempSync(join(tmpdir(),'orbit-six-preview-'))
for(const [name,key] of [['claude','CLAUDE_CONFIG_DIR'],['codex','CODEX_HOME'],['gemini','GEMINI_CLI_HOME']]){process.env[key]=join(root,name);mkdirSync(process.env[key],{recursive:true})}
const {startServer}=await import('../../../packages/sidecar/src/server.ts')
const {seedRoutingQuota}=await import('../../../packages/sidecar/test/helpers.ts')
const {CATALOG_FIXTURE}=await import('../../../packages/sidecar/test/catalogFixture.ts')
const token='six-improvements-isolated-preview',origin='http://127.0.0.1:5508'
const server=await startServer({port:5509,token,allowedOrigins:[origin],dataDir:join(root,'data'),shell:'/bin/sh',run:async()=>({code:127,stdout:'',stderr:'offline'}),browser:null,scheduler:false,simulatedCatalog:CATALOG_FIXTURE,agentCommand:()=>({file:process.execPath,args:[new URL('../../analysis/2026-10-17-orca-recovery/test-agent.mjs',import.meta.url).pathname]})})
await server.initialized;await seedRoutingQuota(server.core)
server.core.store.saveSettings({...server.core.store.settings(),smartClassify:false,agentsInEnglish:false,resumeOnStart:false})
const workspace=server.core.store.createWorkspace('Orbit · seis melhorias',[root])
for(const title of ['Revisar experiência dos agentes','Validar integração']){
 await server.core.handle({type:'mission.create',requestId:crypto.randomUUID(),workspaceId:workspace.id,title,objective:'',mode:'livre',lead:{cli:'codex',model:'gpt-6-luna',effort:'low',title:'Líder'},allowOriginal:true})
 const mission=server.core.store.snapshot().missions.find(m=>m.title===title)
 for(const [cli,name] of [['codex','Implementação'],['claude','Revisão']])await server.core.handle({type:'pane.spawn',request:{missionId:mission.id,role:'crew',cli,model:cli==='codex'?'gpt-6.1-sol':'opus',effort:'medium',title:name,readOnly:true}})
}
const pluginDir=join(root,'data/app-plugins/fixture.sandbox');mkdirSync(pluginDir,{recursive:true})
const manifest={manifestVersion:1,pluginApi:1,experimental:true,publisher:'fixture',id:'sandbox',name:'Teste próprio do sandbox',version:'1.0.0',entry:'main.js',permissions:['panels','commands','events:pane.status.changed'],contributes:{panels:[{id:'status',title:'Status isolado'}],commands:[{id:'probe',title:'Testar isolamento'},{id:'hang',title:'Testar prazo'}],events:['pane.status.changed']}}
writeFileSync(join(pluginDir,'orbit-plugin.json'),JSON.stringify(manifest))
writeFileSync(join(pluginDir,'main.js'),`orbit.render('status',{body:'Fixture própria; nenhum terceiro carregado.'});orbit.registerCommand('probe',async()=>({process:typeof process,require:typeof require,window:typeof window,network:await fetch('http://127.0.0.1:5509/should-never-reach').then(()=> 'ALLOWED').catch(()=> 'denied')}));orbit.registerCommand('hang',()=>{while(true){}});orbit.onEvent(event=>orbit.render('status',{body:JSON.stringify(event)}));`)
// Test control routes are bound only to this isolated preview fixture, never production.
const security=JSON.parse(readFileSync(join(base,'apps/desktop/src-tauri/tauri.conf.json'),'utf8')).app.security
const appCsp=security.devCsp
const vite=await createServer({configFile:false,root:join(base,'apps/desktop'),plugins:[{name:'preview',configureServer(server){server.middlewares.use((req,res,next)=>{if(req.url==='/strict-csp-contract'){res.setHeader('Content-Security-Policy',security.csp);res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><body></body></html>');return}res.setHeader('Content-Security-Policy',appCsp);next()})},enforce:'pre',transform(code,id){if(id.split('?')[0].endsWith('/orbit/context.tsx'))return code.replace(/export const isTauri = [^\n]+/,'export const isTauri = false').replace("import.meta.env.VITE_ORBIT_PORT ?? '4317'","'5509'").replace("import.meta.env.VITE_ORBIT_TOKEN ?? ''",JSON.stringify(token))}},react()],server:{host:'127.0.0.1',port:5508,strictPort:true}})
await vite.listen();console.log('Preview: '+origin+' · deterministic own fixtures; no provider calls')
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await vite.close();await server.close();process.exit(0)})
