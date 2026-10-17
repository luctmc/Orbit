import { createServer } from '../../../node_modules/vite/dist/node/index.js'
import react from '../../../node_modules/@vitejs/plugin-react/dist/index.js'
import { WebSocketServer } from 'ws'
import { snapshot, respond } from './fixture.mjs'
const wss=new WebSocketServer({host:'127.0.0.1',port:5388})
wss.on('connection',ws=>{ws.send(JSON.stringify({type:'snapshot',snapshot}));ws.on('message',raw=>{const answer=respond(JSON.parse(String(raw)));if(answer)ws.send(JSON.stringify(answer))})})
const server=await createServer({configFile:false,root:new URL('../../../apps/desktop',import.meta.url).pathname,plugins:[{name:'isolated-preview',enforce:'pre',transform(code,id){if(id.split('?')[0].endsWith('/orbit/context.tsx'))return code.replace(/export const isTauri = [^\n]+/,'export const isTauri = false').replace("import.meta.env.VITE_ORBIT_PORT ?? '4317'","'5388'")}},react()],server:{host:'127.0.0.1',port:5387,strictPort:true}})
await server.listen();console.log('Synthetic preview http://127.0.0.1:5387; no provider tasks or user profile')
