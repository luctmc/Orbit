import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, statSync, readdirSync, lstatSync, readlinkSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import WebSocket from '../../../node_modules/ws/wrapper.mjs'
const root='/Users/lucas/Documents/GitHub/Orbit-default-bypass'
const evidence=new URL('.',import.meta.url).pathname
const bundle=process.env.ORBIT_VERIFY_BUNDLE??join(root,'apps/desktop/src-tauri/target/release/bundle/macos/Orbit.app')
const installed='/Applications/Orbit.app'
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex')
function manifest(dir){const files={};const visit=(base,rel='')=>{for(const entry of readdirSync(base,{withFileTypes:true})){const key=rel+entry.name,p=join(base,entry.name);if(entry.isSymbolicLink())files[key]='symlink:'+readlinkSync(p);else if(entry.isDirectory())visit(p,key+'/');else if(entry.isFile())files[key]=hash(p)}};visit(dir);return files}
const expected=manifest(bundle),actual=manifest(installed)
if(JSON.stringify(expected)!==JSON.stringify(actual))throw Error('Installed bundle manifest differs')
const rows=execFileSync('ps',['-axo','pid,ppid,comm'],{encoding:'utf8'}).split('\n').map(l=>l.trim().split(/\s+/))
const native=rows.find(r=>r[2]===join(installed,'Contents/MacOS/orbit-desktop'))
if(!native)throw Error('Native Orbit is not running')
const engine=rows.find(r=>r[1]===native[0]&&r[2]===join(installed,'Contents/Resources/node/node'))
if(!engine)throw Error('Current packaged sidecar is absent')
const env=execFileSync('ps',['eww','-p',engine[0],'-o','command='],{encoding:'utf8'})
const token=/(?:^|\s)ORBIT_TOKEN=([^\s]+)/.exec(env)?.[1]
const sockets=execFileSync('lsof',['-nP','-a','-p',engine[0],'-iTCP','-sTCP:LISTEN','-Fn'],{encoding:'utf8'})
const port=/n127\.0\.0\.1:(\d+)/.exec(sockets)?.[1]
if(!token||!port)throw Error('No authenticated native connection')
const mappings=execFileSync('lsof',['-a','-p',native[0],'-d','txt','-Fn','-Fi'],{encoding:'utf8'})
const inode=statSync(join(installed,'Contents/MacOS/orbit-desktop')).ino
if(!mappings.includes(`i${inode}\n`))throw Error('Running binary mapping is stale')
const ws=new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`,{origin:'tauri://localhost'})
const result=await new Promise((resolve,reject)=>{let snapshot,catalog,statuses;const timer=setTimeout(()=>reject(Error('Native inspection timed out')),35000);ws.on('error',reject);ws.on('message',raw=>{const m=JSON.parse(String(raw));if(m.type==='snapshot')snapshot=m.snapshot;if(m.type==='catalog')catalog=m.catalog;if(m.type==='account.status')statuses=m.statuses;if(snapshot&&catalog&&statuses?.length&&statuses.every(s=>!s.busy)){clearTimeout(timer);resolve({snapshot,catalog,statuses})}})})
ws.close()
const version=execFileSync('/usr/libexec/PlistBuddy',['-c','Print CFBundleShortVersionString',join(installed,'Contents/Info.plist')],{encoding:'utf8'}).trim()
const sidecar='Contents/Resources/sidecar/dist/index.mjs',binary='Contents/MacOS/orbit-desktop'
const report={time:new Date().toISOString(),version,bundle,installed,nativePid:Number(native[0]),sidecarPid:Number(engine[0]),mappedInstalledInode:inode,fileCount:Object.keys(actual).length,identicalBundle:true,bundleManifestSha256:createHash('sha256').update(JSON.stringify(actual)).digest('hex'),binarySha256:hash(join(installed,binary)),sidecarSha256:hash(join(installed,sidecar)),accounts:result.snapshot.accounts.map(a=>({id:a.id,cli:a.cli,builtin:a.builtin,loggedIn:result.statuses.find(s=>s.accountId===a.id)?.loggedIn,checking:result.statuses.find(s=>s.accountId===a.id)?.busy})),counts:Object.fromEntries(['workspaces','missions','panes','accounts','templates','schedules'].map(k=>[k,result.snapshot[k]?.length])),unauthenticatedMcpStatus:(await fetch(`http://127.0.0.1:${port}/mcp`)).status,mutationsSent:[],visualNative:'not verified: macOS denies Accessibility automation and window capture; preview DOM/screenshots verified separately'}
writeFileSync(evidence+'installed-manifest.json',JSON.stringify(actual,null,2));writeFileSync(evidence+'installed.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
