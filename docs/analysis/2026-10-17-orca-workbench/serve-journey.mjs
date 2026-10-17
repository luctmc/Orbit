// Real Orbit transport, journal, routing and PTYs. Deterministic CLI stand-in; no model inference.
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
const base = new URL('../../../', import.meta.url).pathname
const root = join(base, '.research/journey-agentic')
mkdirSync(root, { recursive: true })
for (const [name, key] of [['claude','CLAUDE_CONFIG_DIR'],['codex','CODEX_HOME'],['gemini','GEMINI_CLI_HOME']]) { process.env[key] = join(root, name); mkdirSync(process.env[key], { recursive: true }) }
const { startServer } = await import('../../../packages/sidecar/src/server.ts')
const { seedRoutingQuota } = await import('../../../packages/sidecar/test/helpers.ts')
const token = 'local-journey-isolated'
const server = await startServer({port: 5390, token, allowedOrigins: ['http://127.0.0.1:5389'], dataDir: join(root, 'data'), shell:'/bin/sh', run:async()=>({code:127,stdout:'',stderr:'offline'}), browser:null, scheduler:false,
 agentCommand:()=>({file:process.execPath,args:[new URL('./test-agent.mjs',import.meta.url).pathname]})})
await server.initialized
await seedRoutingQuota(server.core)
server.core.store.saveSettings({...server.core.store.settings(),smartClassify:false,agentsInEnglish:false,resumeOnStart:false})
const workspace = server.core.store.snapshot().workspaces[0] ?? server.core.store.createWorkspace('Bancada de agentes', [root])
if (!server.core.store.snapshot().missions.length) for (const title of ['Revisar a experiência de agentes','Validar integração']) await server.core.handle({type:'mission.create',requestId:crypto.randomUUID(),workspaceId:workspace.id,title,objective:'',mode:'agentica',lead:{cli:'codex',model:'gpt-6-luna',effort:'low',title:'Coordenar trabalho'},allowOriginal:true})
const vite=await createServer({configFile:false,root:join(base,'apps/desktop'),plugins:[{name:'journey',enforce:'pre',transform(code,id){if(id.split('?')[0].endsWith('/orbit/context.tsx'))return code.replace(/export const isTauri = [^\n]+/,'export const isTauri = false').replace("import.meta.env.VITE_ORBIT_PORT ?? '4317'","'5390'").replace("import.meta.env.VITE_ORBIT_TOKEN ?? ''",JSON.stringify(token))}},react()],server:{host:'127.0.0.1',port:5389,strictPort:true}})
await vite.listen()
console.log('Orbit journey http://127.0.0.1:5389 · real sidecar and PTYs; deterministic agents')
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,async()=>{await vite.close();await server.close();process.exit(0)})
