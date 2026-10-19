import { readFileSync } from 'node:fs'
import { createHash, createPublicKey, verify, randomBytes } from 'node:crypto'
import { startRuntimeBridge } from '../../../packages/sidecar/src/runtimeDaemon.ts'
const daemon = JSON.parse(readFileSync(process.env.HOME+'/.orbit/runtime-daemon/connection.json','utf8'))
const token = randomBytes(24).toString('hex')
const bridge = await startRuntimeBridge({daemon,token,port:0,allowedOrigins:[]})
try {
 const headers={'x-orbit-token':token}
 const res=await fetch(`http://127.0.0.1:${bridge.port}/update/latest.json`,{headers})
 const manifest=await res.json()
 const platform=manifest.platforms['darwin-aarch64']
 const archive=await fetch(platform.url,{headers})
 const data=Buffer.from(await archive.arrayBuffer())
 const conf=JSON.parse(readFileSync(new URL('../../../apps/desktop/src-tauri/tauri.conf.json',import.meta.url),'utf8'))
 const key=Buffer.from(Buffer.from(conf.plugins.updater.pubkey,'base64').toString().trim().split('\n')[1]!, 'base64')
 const lines=Buffer.from(platform.signature,'base64').toString().trim().split('\n')
 const sig=Buffer.from(lines[1]!,'base64')
 const pub=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),key.subarray(10)]),format:'der',type:'spki'})
 const signed=sig.subarray(0,2).toString()==='ED'?createHash('blake2b512').update(data).digest():data
 const archiveValid=verify(null,signed,pub,sig.subarray(10))
 const comment=lines[2]!.replace(/^trusted comment: /,'')
 const commentValid=verify(null,Buffer.concat([sig.subarray(10),Buffer.from(comment)]),pub,Buffer.from(lines[3]!,'base64'))
 const runtime=await fetch(`http://127.0.0.1:${daemon.port}/runtime/status`,{headers:{authorization:`Bearer ${daemon.token}`}}).then(r=>r.json())
 const result={manifestStatus:res.status,version:manifest.version,archiveStatus:archive.status,archiveBytes:data.length,sha256:createHash('sha256').update(data).digest('hex'),archiveValid,commentValid,signatureAlgorithm:sig.subarray(0,2).toString(),bridgeUrl:new URL(platform.url).port===String(bridge.port),runtimePid:daemon.pid,live:runtime.live,instanceId:runtime.instanceId}
 console.log(JSON.stringify(result,null,2))
 if(!archiveValid||!commentValid||res.status!==200||archive.status!==200)process.exitCode=1
} finally {await bridge.close()}
