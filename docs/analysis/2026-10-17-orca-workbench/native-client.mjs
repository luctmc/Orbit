import { execFileSync } from 'node:child_process'
import WebSocket from 'ws'
/** Inspect only Orbit's installed processes. Authentication stays in memory and never in reports. */
export async function nativeClient() {
 const installed='/Applications/Orbit.app'
 const rows=execFileSync('ps',['-axo','pid,ppid,comm'],{encoding:'utf8'}).split('\n').map(l=>l.trim().split(/\s+/))
 const app=rows.find(r=>r[2]===installed+'/Contents/MacOS/orbit-desktop')
 const engine=app&&rows.find(r=>r[1]===app[0]&&r[2]===installed+'/Contents/Resources/node/node')
 if(!engine)throw Error('Installed Orbit sidecar is not running')
 const env=execFileSync('ps',['eww','-p',engine[0],'-o','command='],{encoding:'utf8'})
 const token=/(?:^|\s)ORBIT_TOKEN=([^\s]+)/.exec(env)?.[1]
 const sockets=execFileSync('lsof',['-nP','-a','-p',engine[0],'-iTCP','-sTCP:LISTEN','-Fn'],{encoding:'utf8'})
 const port=/n127\.0\.0\.1:(\d+)/.exec(sockets)?.[1]
 if(!token||!port)throw Error('Native authentication unavailable')
 const ws=new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`,{origin:'tauri://localhost'})
 const messages=[],waiters=new Set()
 ws.on('message',raw=>{messages.push(JSON.parse(String(raw)));for(const w of waiters)w()})
 function next(type,match=()=>true,timeout=30000) {
  return new Promise((resolve,reject)=>{const check=()=>{const m=messages.find(m=>m.type===type&&match(m));if(m){clearTimeout(timer);waiters.delete(check);resolve(m)}};const timer=setTimeout(()=>{waiters.delete(check);reject(Error(`Timed out awaiting ${type}`))},timeout);waiters.add(check);check()})
 }
 await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject)})
 const {snapshot}=await next('snapshot')
 return {ws,snapshot,messages,next,send:m=>ws.send(JSON.stringify(m)),appPid:Number(app[0]),sidecarPid:Number(engine[0])}
}
