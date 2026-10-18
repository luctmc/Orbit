/** Independent local engine lifetime. Bridges are disposable; only the daemon owns PTYs. */
import {spawn} from 'node:child_process'
import {randomBytes,createHash} from 'node:crypto'
import {mkdirSync,readFileSync,writeFileSync,renameSync,unlinkSync,openSync,closeSync,lstatSync,chmodSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {createServer,request as httpRequest} from 'node:http'
import {request as requestHttp} from 'node:http'

export interface RuntimeConnection {version:1;instanceId:string;pid:number;port:number;token:string;revision:string}
export interface RuntimeOptions {dataDir:string;entry:string;shell:string;allowedOrigins:string[];bootTimeoutMs?:number}
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms))
export function runtimeDirectory(dataDir:string):string{
 const root=join(resolve(dataDir),'runtime-daemon')
 mkdirSync(root,{recursive:true,mode:0o700})
 const stat=lstatSync(root)
 if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==process.getuid?.())throw new Error('Diretório do motor deve pertencer ao usuário e não pode ser um link')
 chmodSync(root,0o700);return root
}
export function runtimeRevision(entry:string):string{return createHash('sha256').update(readFileSync(entry)).update(process.version).digest('hex')}
function privateFile(path:string):void{
 const stat=lstatSync(path)
 if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==process.getuid?.()||(stat.mode&0o077)!==0)throw new Error('Recibo privado do motor com propriedade/permissões inválidas')
}
export function readRuntimeConnection(root:string):RuntimeConnection|null{
 const path=join(root,'connection.json')
 try{privateFile(path)}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error}
 const data=JSON.parse(readFileSync(path,'utf8'))
 if(data.version!==1||!Number.isSafeInteger(data.pid)||data.pid<1||!Number.isInteger(data.port)||data.port<1||data.port>65535||!/^[a-f0-9]{64}$/.test(data.token)||!/^[a-f0-9]{32}$/.test(data.instanceId)||!/^[a-f0-9]{64}$/.test(data.revision))throw new Error('Recibo do motor inválido; recuperação automática recusada')
 return data
}
async function status(connection:RuntimeConnection):Promise<{instanceId:string;revision:string;live:number}|null>{
 try{
  const response=await fetch(`http://127.0.0.1:${connection.port}/runtime/status`,{headers:{authorization:`Bearer ${connection.token}`},signal:AbortSignal.timeout(1500)})
  if(!response.ok)return null
  const result=await response.json() as any
  return result.instanceId===connection.instanceId&&result.revision===connection.revision&&Number.isSafeInteger(result.live)?result:null
 }catch{return null}
}
function alive(pid:number):boolean{try{process.kill(pid,0);return true}catch(error){return (error as NodeJS.ErrnoException).code!=='ESRCH'}}
export async function ensureRuntimeDaemon(options:RuntimeOptions):Promise<RuntimeConnection>{
 const root=runtimeDirectory(options.dataDir),revision=runtimeRevision(options.entry),lock=join(root,'boot.lock')
 const deadline=Date.now()+Math.max(50,Math.min(15000,options.bootTimeoutMs??15000)),nonce=randomBytes(16).toString('hex')
 let lockOwned=false,bootUnconfirmed=false
 while(!lockOwned){
  try{const fd=openSync(lock,'wx',0o600);writeFileSync(fd,JSON.stringify({pid:process.pid,phase:'locked',nonce}));closeSync(fd);lockOwned=true}catch(error){
   if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error
   privateFile(lock)
   const raw=readFileSync(lock,'utf8'),owner=JSON.parse(raw)
   if(!Number.isSafeInteger(owner.pid)||owner.pid<1)throw new Error('Trava do motor inválida')
   if(!alive(owner.pid)){
    // A dead bridge can have a detached child that has not published readiness yet.
    // Never start a second engine merely because the bridge PID is gone.
    const published=readRuntimeConnection(root)
    const ready=published&&published.instanceId===owner.instanceId?await status(published):null
    const safe=owner.phase==='locked'||ready||Number.isSafeInteger(owner.childPid)&&!alive(owner.childPid)
    if(safe&&readFileSync(lock,'utf8')===raw){unlinkSync(lock);continue}
   }
   if(Date.now()>deadline)throw new Error('Outro inicializador do motor não terminou em 15 s')
   await wait(50)
  }
 }
 try{
  const known=readRuntimeConnection(root)
  if(known){
   const observed=await status(known)
   if(observed){
    if(known.revision===revision)return known
    if(observed.live>0)throw new Error('Motor anterior ainda tem terminais ativos. Encerre-os explicitamente antes de aplicar a atualização; nenhum trabalho foi interrompido.')
    const stop=await fetch(`http://127.0.0.1:${known.port}/runtime/stop`,{method:'POST',headers:{authorization:`Bearer ${known.token}`},signal:AbortSignal.timeout(2000)})
    if(!stop.ok)throw new Error('O motor anterior não confirmou encerramento seguro')
    while(alive(known.pid)){if(Date.now()>deadline)throw new Error('Motor anterior ainda não encerrou');await wait(50)}
   }else if(alive(known.pid))throw new Error('PID do motor ainda existe, mas sua identidade não foi confirmada. Recusada duplicação de PTYs.')
  }
  const token=randomBytes(32).toString('hex'),instanceId=randomBytes(16).toString('hex')
  const log=join(root,'engine.log')
  let logFd:number
  try{privateFile(log);logFd=openSync(log,'a')}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;logFd=openSync(log,'wx',0o600)}
  bootUnconfirmed=true
  writeFileSync(lock,JSON.stringify({pid:process.pid,phase:'starting',instanceId,nonce}),{mode:0o600})
  const child=spawn(process.execPath,[options.entry],{detached:true,stdio:['ignore',logFd,logFd],env:{...process.env,ORBIT_DAEMON_CHILD:'1',ORBIT_HOME:options.dataDir,ORBIT_TOKEN:token,ORBIT_RUNTIME_INSTANCE:instanceId,ORBIT_RUNTIME_REVISION:revision,ORBIT_PORT:'0',ORBIT_ALLOWED_ORIGINS:options.allowedOrigins.join(','),ORBIT_EXIT_ON_STDIN_CLOSE:'0',SHELL:options.shell}})
  closeSync(logFd)
  if(child.pid)writeFileSync(lock,JSON.stringify({pid:process.pid,phase:'starting',instanceId,childPid:child.pid,nonce}),{mode:0o600})
  let launchError:Error|undefined;child.once('error',error=>{launchError=error;bootUnconfirmed=false});child.once('exit',()=>{bootUnconfirmed=false});child.unref()
  while(Date.now()<deadline){
   if(launchError)throw launchError
   const current=readRuntimeConnection(root)
   if(current?.instanceId===instanceId&&await status(current)){bootUnconfirmed=false;return current}
   if(child.exitCode!==null)throw new Error(`Motor encerrou durante inicialização (${child.exitCode}); consulte o log privado`)
   await wait(50)
  }
  // Never kill an unconfirmed process or automatically create a second engine.
  throw new Error('Motor não confirmou inicialização em 15 s; nenhuma segunda execução foi criada')
 }finally{if(lockOwned&&!bootUnconfirmed){const current=JSON.parse(readFileSync(lock,'utf8'));if(current.nonce===nonce)unlinkSync(lock)}}
}
export function publishRuntimeConnection(dataDir:string,connection:RuntimeConnection):void{
 const root=runtimeDirectory(dataDir),temporary=join(root,`${connection.instanceId}.tmp`)
 const fd=openSync(temporary,'wx',0o600)
 try{writeFileSync(fd,JSON.stringify(connection));}finally{closeSync(fd)}
 renameSync(temporary,join(root,'connection.json'))
}

/** Per-shell token proxy: the daemon's private token never reaches the renderer. */
export async function startRuntimeBridge(options:{daemon:RuntimeConnection;token:string;port:number;allowedOrigins:string[]}):Promise<{port:number;close:()=>Promise<void>}> {
 const {daemon,token,allowedOrigins}=options
 const sockets=new Set<import('node:net').Socket>()
 const authenticated=(url:URL,authorization?:string)=>url.searchParams.get('token')===token||authorization===`Bearer ${token}`
 const server=createServer((req,res)=>{
  const url=new URL(req.url??'/','http://127.0.0.1')
  if(!url.pathname.startsWith('/update/')||!authenticated(url,req.headers.authorization)){res.writeHead(401);res.end();return}
  url.searchParams.set('token',daemon.token)
  const upstream=httpRequest({host:'127.0.0.1',port:daemon.port,path:url.pathname+url.search,method:req.method,headers:{...req.headers,authorization:`Bearer ${daemon.token}`,host:`127.0.0.1:${daemon.port}`}},response=>{res.writeHead(response.statusCode??502,response.headers);response.pipe(res)})
  upstream.setTimeout(15000,()=>upstream.destroy())
  upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end('Motor indisponível')})
  req.pipe(upstream)
 })
 server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket))})
 server.on('upgrade',(req,socket,head)=>{
  const url=new URL(req.url??'/','http://127.0.0.1')
  if(url.pathname!=='/ws'||!authenticated(url)||!allowedOrigins.includes(req.headers.origin??'')){socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n');return}
  url.searchParams.set('token',daemon.token)
  const upstream=requestHttp({host:'127.0.0.1',port:daemon.port,path:url.pathname+url.search,method:'GET',headers:{...req.headers,host:`127.0.0.1:${daemon.port}`}})
  upstream.setTimeout(5000,()=>upstream.destroy())
  upstream.on('upgrade',(response,remote,remoteHead)=>{
   upstream.setTimeout(0)
   socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(response.headers).map(([k,v])=>`${k}: ${v}`).join('\r\n')}\r\n\r\n`)
   if(remoteHead.length)socket.write(remoteHead)
   if(head.length)remote.write(head)
   // Node pipe implements bounded socket backpressure; no unbounded message queue.
   remote.pipe(socket);socket.pipe(remote)
   const close=()=>{remote.destroy();socket.destroy()};remote.on('error',close);socket.on('error',close);socket.on('close',()=>remote.destroy());remote.on('close',()=>socket.destroy())
  })
  upstream.on('response',response=>{response.resume();socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n')})
  upstream.on('error',()=>socket.destroy());upstream.end()
 })
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(options.port,'127.0.0.1',resolve)})
 const address=server.address();const port=typeof address==='object'&&address?address.port:0
 return {port,close:async()=>{for(const socket of sockets)socket.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()))}}
}
