import { homedir } from 'node:os'
import { join } from 'node:path'
import { ensureRuntimeDaemon, startRuntimeBridge, publishRuntimeConnection } from './runtimeDaemon.ts'
import { startServer } from './server.ts'

const token = process.env.ORBIT_TOKEN
if (!token) {
  console.error('[orbit] ORBIT_TOKEN ausente: rode pelo `npm run dev` na raiz ou pelo app.')
  process.exit(1)
}

const dataDir=process.env.ORBIT_HOME ?? join(homedir(), '.orbit')
const origins=(process.env.ORBIT_ALLOWED_ORIGINS ?? 'tauri://localhost,http://tauri.localhost').split(',').map(o=>o.trim())
const persistent=process.env.ORBIT_DAEMON_CHILD==='1'
// Packaged desktop sidecars are bridges. The detached engine owns PTYs and hook endpoints.
if(!persistent && (process.env.ORBIT_EXIT_ON_STDIN_CLOSE==='1'||process.env.ORBIT_PERSIST_RUNTIME==='1')) {
 const daemon=await ensureRuntimeDaemon({dataDir,entry:process.argv[1]!,shell:process.env.SHELL??'/bin/zsh',allowedOrigins:origins})
 const bridge=await startRuntimeBridge({daemon,token,port:Number(process.env.ORBIT_PORT??0),allowedOrigins:origins})
 console.log(`ORBIT_READY ${JSON.stringify({port:bridge.port})}`)
 let stopping=false
 const stop=async()=>{if(stopping)return;stopping=true;await bridge.close();process.exit(0)}
 process.on('SIGINT',stop);process.on('SIGTERM',stop)
 if(process.env.ORBIT_EXIT_ON_STDIN_CLOSE==='1'){process.stdin.on('end',stop);process.stdin.resume()}
} else {
 const server=await startServer({port:Number(process.env.ORBIT_PORT??4317),token,allowedOrigins:origins,dataDir,shell:process.env.SHELL??'/bin/zsh',
  ...(persistent?{runtime:{instanceId:process.env.ORBIT_RUNTIME_INSTANCE!,revision:process.env.ORBIT_RUNTIME_REVISION!,stop:async()=>{await server.close();process.exit(0)}}}:{})})
 if(persistent)publishRuntimeConnection(dataDir,{version:1,instanceId:process.env.ORBIT_RUNTIME_INSTANCE!,revision:process.env.ORBIT_RUNTIME_REVISION!,pid:process.pid,port:server.port,token})
 console.log(`ORBIT_READY ${JSON.stringify({port:server.port})}`)
 let stopping=false
 const stop=async()=>{if(stopping)return;stopping=true;await server.close();process.exit(0)}
 process.on('SIGINT',stop);process.on('SIGTERM',stop)
}
