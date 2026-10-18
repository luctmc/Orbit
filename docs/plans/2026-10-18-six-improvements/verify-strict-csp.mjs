import {chromium,webkit} from '/Users/lucas/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs'
import {readFileSync,writeFileSync} from 'node:fs'
import {pluginDocument} from '../../../apps/desktop/src/orbit/plugins/sandbox.ts'
const engine=process.argv.includes('--webkit')?'webkit':'chromium'
const browser=await(engine==='webkit'?webkit:chromium).launch({executablePath:engine==='webkit'?'/Users/lucas/Library/Caches/ms-playwright/webkit-2359/pw_run.sh':'/Users/lucas/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell'})
const p=await browser.newPage(),csp=JSON.parse(readFileSync(new URL('../../../apps/desktop/src-tauri/tauri.conf.json',import.meta.url),'utf8')).app.security.csp
p.on('console',message=>{if(message.type()==='error')console.log('CSP console:',message.text())})
p.on('pageerror',error=>console.log('Page error:',error.message))
const channel='strict-csp-fixture',srcDoc=pluginDocument('http://127.0.0.1:5508/orbit-plugin-host.js')
const config={channel,panels:[{id:'status',title:'Strict CSP'}],commands:['probe'],events:[],code:`orbit.registerCommand('probe',async()=>({network:await fetch('http://127.0.0.1:5509/never').then(()=> 'ALLOWED').catch(()=> 'denied'),process:typeof process,window:typeof window}));`}
try{
 await p.goto('http://127.0.0.1:5508/strict-csp-contract')
 await p.evaluate(({srcDoc,config})=>{window.replies=[];const frame=document.createElement('iframe');frame.sandbox='allow-scripts';frame.srcdoc=srcDoc;const init=()=>frame.contentWindow.postMessage({kind:'orbit-plugin-init',config},'*');frame.onload=init;window.addEventListener('message',event=>{if(event.source!==frame.contentWindow)return;if(event.data?.kind==='orbit-plugin-host-ready')init();window.replies.push(event.data)});document.body.append(frame);window.probe=()=>frame.contentWindow.postMessage({channel:config.channel,kind:'command',command:'probe',requestId:'probe'},'*')},{srcDoc,config})
 await p.waitForFunction(()=>window.replies.some(r=>r.kind==='ready'||r.kind==='error'))
 console.log('startup',await p.evaluate(()=>window.replies))
 await p.evaluate(()=>window.probe())
 await p.waitForFunction(()=>window.replies.some(r=>r.kind==='result'))
 const result=await p.evaluate(()=>window.replies.find(r=>r.kind==='result'))
 if(!result.ok||!result.text.includes('"network":"denied"')||!result.text.includes('"process":"undefined"')||!result.text.includes('"window":"undefined"'))throw Error('Isolation contract failed')
 writeFileSync(new URL(`strict-csp-${engine}.json`,import.meta.url),JSON.stringify({engine,csp,pass:true,result},null,2)+'\n')
 console.log(engine,'production CSP + opaque frame + static controller + worker: PASS')
}finally{await browser.close()}
