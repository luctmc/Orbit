/** Private output-only journal. It never records keystrokes, submits or credentials separately. */
import {appendFileSync,readFileSync,writeFileSync,renameSync,mkdirSync,lstatSync,chmodSync,openSync,closeSync,fsyncSync,statSync,readdirSync} from 'node:fs'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
export const HISTORY_LIMITS={bytes:32*1024*1024,scrollbackLines:16000,checkpointMs:250} as const
export interface HistorySnapshot {sequence:number;data:string;cols:number;rows:number}
export type HistoryEvent={sequence:number;type:'data';data:string}|{sequence:number;type:'resize';cols:number;rows:number}
export class TerminalHistory {
 static entries(root:string,paneId:number):Array<{epoch:string;updatedAt:number}> {
  if(!Number.isSafeInteger(paneId)||paneId<1)throw new Error('Pane inválido')
  const path=join(root,String(paneId))
  try{const st=lstatSync(path);if(!st.isDirectory()||st.isSymbolicLink())throw new Error('Histórico inseguro')
   return readdirSync(path).filter(epoch=>/^[a-f0-9-]{36}$/.test(epoch)).map(epoch=>({epoch,updatedAt:lstatSync(join(path,epoch)).mtimeMs})).sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,64)
  }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error}
 }
 private readonly root:string
 private readonly log:string
 private readonly snapshot:string
 private sequence=0
 constructor(root:string,paneId:number,epoch:string){
  if(!Number.isSafeInteger(paneId)||paneId<1||!/^[a-f0-9-]{36}$/.test(epoch))throw new Error('Identidade de histórico inválida')
  const base=join(root,String(paneId));this.root=join(base,epoch)
  for(const dir of [root,base,this.root]){mkdirSync(dir,{recursive:true,mode:0o700});const st=lstatSync(dir);if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==process.getuid?.())throw new Error('Diretório de histórico inseguro');chmodSync(dir,0o700)}
  this.log=join(this.root,'output.jsonl');this.snapshot=join(this.root,'screen.json')
 }
 private read(path:string,max=HISTORY_LIMITS.bytes):string|null{
  try{const st=lstatSync(path);if(!st.isFile()||st.isSymbolicLink()||st.uid!==process.getuid?.()||(st.mode&0o077)!==0||st.size>max)throw new Error('Arquivo de histórico inseguro ou excessivo');return readFileSync(path,'utf8')}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error}
 }
 recover():{snapshot:HistorySnapshot|null;events:HistoryEvent[]}{
  const text=this.read(this.snapshot),snapshot=text?JSON.parse(text) as HistorySnapshot:null
  if(snapshot&&(!Number.isSafeInteger(snapshot.sequence)||snapshot.sequence<0||typeof snapshot.data!=='string'||!Number.isInteger(snapshot.cols)||snapshot.cols<2||snapshot.cols>1000||!Number.isInteger(snapshot.rows)||snapshot.rows<1||snapshot.rows>500))throw new Error('Snapshot de histórico inválido')
  const journal=this.read(this.log),events:HistoryEvent[]=[]
  const lines=journal?.split('\n')??[]
  let previous=snapshot?.sequence??0
  for(let i=0;i<lines.length;i++){
   if(!lines[i])continue
   let event:HistoryEvent
   try{event=JSON.parse(lines[i]!)}catch{if(i===lines.length-1)break;throw new Error('Histórico corrompido; não será interpretado como entrada')}
   if(!Number.isSafeInteger(event.sequence)||event.sequence<1)throw new Error('Sequência de histórico inválida')
   if(event.sequence<=(snapshot?.sequence??0))continue
   if(event.sequence!==previous+1)throw new Error('Lacuna no histórico; recuperação exata indisponível')
   if(event.type==='data'&&(typeof event.data!=='string'||event.data.length>1024*1024)||event.type==='resize'&&(!Number.isInteger(event.cols)||event.cols<2||event.cols>1000||!Number.isInteger(event.rows)||event.rows<1||event.rows>500)||!['data','resize'].includes(event.type))throw new Error('Evento de histórico inválido')
   events.push(event);previous=event.sequence
  }
  this.sequence=previous
  return {snapshot,events}
 }
 append(event:{type:'data';data:string}|{type:'resize';cols:number;rows:number}):number{
  this.readSecurity()
  const row={...event,sequence:this.sequence+1},text=JSON.stringify(row)+'\n'
  let bytes=0;try{bytes=statSync(this.log).size}catch{}
  if(bytes+Buffer.byteLength(text)>HISTORY_LIMITS.bytes)throw new Error('Histórico atingiu 32 MiB sem checkpoint; saída não persistida')
  appendFileSync(this.log,text,{mode:0o600});this.sequence++;return this.sequence
 }
 private readSecurity():void{try{const st=lstatSync(this.log);if(!st.isFile()||st.isSymbolicLink()||st.uid!==process.getuid?.()||(st.mode&0o077)!==0)throw new Error('Journal de histórico inseguro')}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}}
 get head():number{return this.sequence}
 checkpoint(screen:HistorySnapshot):void{
  if(screen.sequence>this.sequence)throw new Error('Checkpoint além do journal')
  // Persist snapshot before pruning old rows: either generation remains recoverable after a crash.
  const temp=join(this.root,`screen-${randomUUID()}.tmp`)
  const fd=openSync(temp,'wx',0o600)
  try{writeFileSync(fd,JSON.stringify(screen));fsyncSync(fd)}finally{closeSync(fd)}
  renameSync(temp,this.snapshot)
  const text=this.read(this.log)??''
  const rest=text.split('\n').filter(line=>{if(!line)return false;try{return JSON.parse(line).sequence>screen.sequence}catch{return false}}).join('\n')
  const logTemp=join(this.root,`output-${randomUUID()}.tmp`),out=openSync(logTemp,'wx',0o600)
  try{writeFileSync(out,rest?rest+'\n':'');fsyncSync(out)}finally{closeSync(out)}
  renameSync(logTemp,this.log)
 }
}
