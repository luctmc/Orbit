import {startServer} from '../../src/server.ts'
import {publishRuntimeConnection} from '../../src/runtimeDaemon.ts'
const server=await startServer({port:0,token:process.env.ORBIT_TOKEN,allowedOrigins:process.env.ORBIT_ALLOWED_ORIGINS.split(','),dataDir:process.env.ORBIT_HOME,shell:'/bin/sh',run:async()=>({code:127,stdout:'',stderr:'offline'}),browser:null,scheduler:false,agentCommand:()=>({file:'/bin/sh',args:[]}),runtime:{instanceId:process.env.ORBIT_RUNTIME_INSTANCE,revision:process.env.ORBIT_RUNTIME_REVISION,stop:async()=>{await server.close();process.exit(0)}}})
publishRuntimeConnection(process.env.ORBIT_HOME,{version:1,pid:process.pid,port:server.port,token:process.env.ORBIT_TOKEN,instanceId:process.env.ORBIT_RUNTIME_INSTANCE,revision:process.env.ORBIT_RUNTIME_REVISION})
process.on('SIGTERM',async()=>{await server.close();process.exit(0)})
