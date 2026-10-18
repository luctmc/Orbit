import {useEffect,useMemo,useRef,useState} from 'react'
import type {AppPluginSummary,LoadedAppPlugin,AppPluginEvent} from '@orbit/protocol'
import {useOrbit,useOrbitClient} from '../orbit/context.tsx'
import {pluginDocument,validPluginReply} from '../orbit/plugins/sandbox.ts'
import {Dialog} from './Dialog.tsx'

function IsolatedPlugin({plugin}:{plugin:LoadedAppPlugin}){
 const {panes,missions}=useOrbit(),frame=useRef<HTMLIFrameElement>(null)
 const channel=useMemo(()=>crypto.randomUUID(),[plugin.hash])
 const source=useMemo(()=>pluginDocument(new URL('/orbit-plugin-host.js',window.location.href).href),[plugin.hash])
 const initialize=()=>frame.current?.contentWindow?.postMessage({kind:'orbit-plugin-init',config:{channel,code:plugin.code,commands:plugin.manifest.contributes.commands.map(command=>command.id),panels:plugin.manifest.contributes.panels,events:plugin.manifest.contributes.events}},'*')
 const [ready,setReady]=useState(false),[result,setResult]=useState('Preparando worker isolado…')
 const prior=useRef(new Map<string,string>())
 useEffect(()=>{
  const receive=(event:MessageEvent)=>{
   if(event.source!==frame.current?.contentWindow||event.origin!=='null')return
   if(event.data?.kind==='orbit-plugin-host-ready'){initialize();return}
   if(!validPluginReply(event.data,channel))return
   if(event.data.kind==='ready'){setReady(true);setResult('Plugin ativo em sandbox; rede, arquivos e APIs nativas indisponíveis.')}
   else if(event.data.kind==='error'){setReady(false);setResult(event.data.text??'Falha no plugin')}
   else setResult(`${event.data.ok?'Resultado':'Erro'}: ${event.data.text}`)
  }
  const timer=setTimeout(()=>{setResult(current=>current==='Preparando worker isolado…'?'Host isolado não respondeu; execução indisponível.':current)},4000)
  window.addEventListener('message',receive);return()=>{clearTimeout(timer);window.removeEventListener('message',receive)}
 },[channel])
 useEffect(()=>{
  if(!ready)return
  const events:AppPluginEvent[]=[...missions.map(m=>({name:'mission.status.changed' as const,missionId:m.id,status:m.status})),...panes.map(p=>({name:'pane.status.changed' as const,paneId:p.id,missionId:p.missionId,status:p.status}))]
  for(const event of events){const key=event.name+('paneId' in event?event.paneId:event.missionId);if(prior.current.get(key)===event.status)continue;prior.current.set(key,event.status);if(plugin.manifest.contributes.events.includes(event.name))frame.current?.contentWindow?.postMessage({channel,kind:'event',event},'*')}
 },[ready,panes,missions,plugin,channel])
 return <section className="app-plugin-runtime">
  <p role="status">{result}</p>
  <div className="app-plugin-commands">{plugin.manifest.contributes.commands.map(command=><button type="button" className="btn btn--sm" key={command.id} disabled={!ready} onClick={()=>frame.current?.contentWindow?.postMessage({channel,kind:'command',command:command.id,requestId:crypto.randomUUID()},'*')}>{command.title}</button>)}</div>
  <iframe ref={frame} title={`Plugin isolado: ${plugin.manifest.name}`} sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={source} onLoad={initialize} style={{width:'100%',minHeight:220,border:'1px solid #34343c',borderRadius:8}} />
 </section>
}
export function AppPluginsPanel({onClose}:{onClose:()=>void}){
 const client=useOrbitClient()
 const [plugins,setPlugins]=useState<AppPluginSummary[]>([]),[loaded,setLoaded]=useState<LoadedAppPlugin|null>(null),[error,setError]=useState<string|null>(null)
 const refresh=async()=>{const requestId=crypto.randomUUID();const result=await client.ask({type:'app-plugins.list',requestId},'app-plugins',m=>m.requestId===requestId);setPlugins(result.plugins);setError(result.error??null);setLoaded(current=>result.plugins.some(p=>p.key===current?.key&&p.hash===current.hash&&p.enabled)?current:null)}
 useEffect(()=>{
  void refresh().catch(error=>setError(String(error)))
  return client.listen(message=>{if(message.type==='app-plugins'&&message.requestId===''){setPlugins(message.plugins);setLoaded(current=>message.plugins.some(p=>p.key===current?.key&&p.hash===current.hash&&p.enabled)?current:null)}})
 },[client])
 const configure=async(plugin:AppPluginSummary,enabled:boolean)=>{
  if(!enabled)setLoaded(null)
  try{const requestId=crypto.randomUUID();const result=await client.ask({type:'app-plugins.configure',key:plugin.key,hash:plugin.hash,enabled,permissions:enabled?plugin.manifest?.permissions??[]:[],requestId},'app-plugins',m=>m.requestId===requestId);if(result.error)throw new Error(result.error);setPlugins(result.plugins);if(!enabled)setLoaded(null)}catch(error){setError(String(error))}
 }
 const open=async(plugin:AppPluginSummary)=>{try{const requestId=crypto.randomUUID();const result=await client.ask({type:'app-plugins.load',key:plugin.key,requestId},'app-plugins.loaded',m=>m.requestId===requestId);if(!result.plugin)throw new Error(result.error??'Plugin indisponível');setLoaded(result.plugin);setError(null)}catch(error){setError(String(error))}}
 return <Dialog title="Plugins do aplicativo · experimental" submitLabel="Fechar" onClose={onClose} onSubmit={onClose}>
  <p>Plugins do Orbit usam contrato próprio e experimental. Cada ativação autoriza o hash revisado e as permissões abaixo. Alterações de código exigem nova autorização.</p>
  <p className="note">Host isolado: painéis de texto, comandos do plugin e eventos de status. Sem acesso a arquivos, shell, rede, credenciais ou APIs nativas. Plugins da CLI/Orca não são compatíveis automaticamente. Nenhum plugin de terceiros é instalado por este painel.</p>
  <button type="button" className="btn btn--ghost btn--sm" onClick={()=>void refresh().catch(error=>setError(String(error)))}>Atualizar lista local</button>
  {error&&<p role="alert">{error}</p>}
  {!plugins.length&&<p>Nenhum plugin local. O host permanece desativado até uma instalação e ativação explícitas.</p>}
  {plugins.map(plugin=><section key={plugin.key} className="app-plugin-entry"><h3>{plugin.manifest?.name??plugin.key}</h3><p>{plugin.key} · {plugin.manifest?.version??'inválido'} · {plugin.enabled?'ativado':'desativado'}</p><p>Permissões: {plugin.manifest?.permissions.join(', ')||'nenhuma'}</p>{plugin.hash&&<code style={{overflowWrap:'anywhere'}}>SHA-256 {plugin.hash}</code>}{plugin.error&&<p role="alert">{plugin.error}</p>}
   <div className="app-plugin-commands">{plugin.enabled?<><button type="button" className="btn btn--sm" onClick={()=>void open(plugin)}>Abrir painéis e comandos</button><button type="button" className="btn btn--ghost btn--sm" onClick={()=>void configure(plugin,false)}>Revogar e desativar</button></>:<button type="button" className="btn btn--sm" disabled={!plugin.manifest} onClick={()=>void configure(plugin,true)}>Autorizar este hash e permissões</button>}</div>
  </section>)}
  {loaded&&<IsolatedPlugin key={loaded.hash} plugin={loaded} />}
 </Dialog>
}
