import {useEffect,useState} from 'react'
import type {Pane} from '@orbit/protocol'
import {useOrbitClient} from '../orbit/context.tsx'
import {Dialog} from './Dialog.tsx'
export function TerminalHistoryDialog({pane,onClose}:{pane:Pane;onClose:()=>void}){
 const client=useOrbitClient()
 const [entries,setEntries]=useState<Array<{epoch:string;updatedAt:number}>>([])
 const [epoch,setEpoch]=useState(''),[text,setText]=useState(''),[error,setError]=useState<string|null>(null)
 useEffect(()=>{
  let active=true;const requestId=crypto.randomUUID();setError(null)
  void client.ask({type:'pane.history.get',paneId:pane.id,requestId,...(epoch?{epoch}:{})},'pane.history',m=>m.requestId===requestId).then(result=>{
   if(!active)return;setEntries(result.entries);setError(result.error??null)
   if(result.text!==undefined)setText(result.text)
   if(!epoch&&result.entries[0])setEpoch(result.entries[0].epoch)
  }).catch(error=>{if(active)setError(error instanceof Error?error.message:String(error))})
  return()=>{active=false}
 },[client,pane.id,epoch])
 return <Dialog title={`Histórico de #${pane.id}`} submitLabel="Fechar" onSubmit={onClose} onClose={onClose}>
  <p className="note">Saída local somente para leitura. Até 16.000 linhas por execução; não reenvia comandos. Até 64 execuções recentes aparecem nesta lista.</p>
  <label htmlFor={`history-${pane.id}`}>Execução</label>
  <select id={`history-${pane.id}`} value={epoch} onChange={event=>{setText('');setEpoch(event.target.value)}}>{entries.map(entry=><option key={entry.epoch} value={entry.epoch}>{new Date(entry.updatedAt).toLocaleString('pt-BR')} · {entry.epoch.slice(0,8)}</option>)}</select>
  {error&&<p role="alert">{error}</p>}
  {!error&&!entries.length&&<p>Nenhuma saída persistida.</p>}
  <pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:'55vh',overflow:'auto',fontSize:12}}>{text}</pre>
 </Dialog>
}
