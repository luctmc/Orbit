/** Account isolation and fail-closed capabilities; Claude control protocol adapted from Orca
 * bbdbe72, MIT Copyright (c) 2026 Lovecast Inc. See THIRD_PARTY_NOTICES.md. */
import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { EFFORTS, MODEL_ID, type Account, type CliCatalog, type Effort, type ModelInfo } from '@orbit/protocol'
import { AccountFiles, userConfigDir } from './accounts.ts'
import { codexDefaults, parseAntigravityModels, parseCodexCatalog, type Run } from './clis.ts'
import { shellQuote } from './command.ts'

const effort = (v: unknown): v is Effort => EFFORTS.includes(v as Effort)
export const CLAUDE_LIST_REQUEST = JSON.stringify({type:'control_request',request_id:'orbit-model-discovery',request:{subtype:'list_models'}})+'\n'
export function parseClaudeCatalog(text: string): CliCatalog {
 if (text.length > 2 * 1024 * 1024) throw new Error('Catálogo excessivo')
 for (const line of text.split(/\r?\n/)) {
  let p: any;try {p=JSON.parse(line)}catch {continue}
  if(p?.type!=='control_response'||p.response?.subtype!=='success'||!Array.isArray(p.response.response?.models)) continue
  const raw=p.response.response.models.slice(0,512), models:ModelInfo[]=[],seen=new Set<string>()
  const defaultRow=raw.find((m:any)=>m?.value==='default')
  let defaultModel:string|null=null
  for(const m of raw) {
   if(!m||typeof m.value!=='string'||!MODEL_ID.test(m.value)||m.disabled===true||m.value==='default'||seen.has(m.value))continue
   seen.add(m.value)
   const efforts=m.supportsEffort===true&&Array.isArray(m.supportedEffortLevels)?[...new Set<Effort>(m.supportedEffortLevels.filter(effort))]:[]
   models.push({id:m.value,label:typeof m.displayName==='string'?m.displayName.slice(0,256):m.value,description:typeof m.description==='string'?m.description.slice(0,2048):'',efforts,defaultEffort:null,capabilities:{effort:typeof m.supportsEffort==='boolean'?m.supportsEffort:null,fast:typeof m.supportsFastMode==='boolean'?m.supportsFastMode:null,auto:typeof m.supportsAutoMode==='boolean'?m.supportsAutoMode:null}})
   if(typeof defaultRow?.resolvedModel==='string'&&m.resolvedModel===defaultRow.resolvedModel)defaultModel??=m.value
  }
  if(models.length)return {source:'cli',origin:'claude:list_models',models,efforts:[],defaultModel}
 }
 throw new Error('A CLI não forneceu catálogo compatível')
}

/** No inference from a CLI-wide --effort flag to model capability. */
export async function discoverAccountCatalog(account:Account, files:AccountFiles, run:Run):Promise<CliCatalog> {
 const prefix=files.envPrefix(account)
 const helper=files.apiKeyHelper(account)
 const claudeSettings=helper?` --settings ${shellQuote(JSON.stringify({apiKeyHelper:helper}))}`:''
 const configured=files.configDir(account)
 const home=account.cli==='gemini'&&configured?join(configured,'.gemini'):configured??userConfigDir(account.cli)
 const commands:Partial<Record<Account['cli'],string>>={
  codex:'codex debug models',
  claude:`printf %s ${shellQuote(CLAUDE_LIST_REQUEST)} | ${prefix}claude -p --input-format stream-json --output-format stream-json --verbose${claudeSettings}`,
  antigravity:'agy models',
 }
 const command=commands[account.cli]
 let reason=account.kind==='api'&&(account.baseUrl||account.model)?'Provedor/modelo personalizado: a CLI não certifica catálogo ou capacidades deste endpoint. Configuração explícita, suporte remoto não confirmado.':'A CLI não expõe listagem segura de modelos; disponibilidade por conta não confirmada.'
 if(command && !(account.kind==='api' && (account.baseUrl || account.model))) {
  const result=await run(account.cli==='claude'?command:`${prefix}${command}`,20_000)
  if(result.code===0)try{
   const catalog=account.cli==='codex'?parseCodexCatalog(result.stdout):account.cli==='claude'?parseClaudeCatalog(result.stdout):parseAntigravityModels(result.stdout)
   return {...catalog,efforts:[],origin:account.cli==='codex'?'codex:debug-models':account.cli==='claude'?'claude:list_models':'agy:models',...(account.cli==='codex'?codexDefaults(home):{})}
  }catch{reason='A CLI respondeu sem catálogo compatível; modelos e capacidades não confirmados.'}
  else reason='Descoberta indisponível (CLI, autenticação ou prazo); capacidades não confirmadas.'
 }
 // Explicitly configured IDs are suggestions, never a claim of provider availability.
 let model=account.model
 if(!model&&account.cli==='gemini')try{model=JSON.parse(readFileSync(join(home,'settings.json'),'utf8')).model?.name}catch{}
 const aliases=account.kind==='api'&&(account.baseUrl||account.model)?[]:account.cli==='claude'?['opus','sonnet','haiku']:account.cli==='gemini'?['auto','pro','flash']:[]
 const ids=[...new Set([...(model&&MODEL_ID.test(model)?[model]:[]),...aliases])]
 return {source:'builtin',origin:model?'account-config':'documented-aliases',reason,efforts:[],models:ids.map(id=>({id,label:id,description:'Sugestão; suporte nesta conta não confirmado',efforts:[],defaultEffort:null,capabilities:{effort:null,fast:null,auto:null}})),defaultModel:model??null}
}

/** Fingerprint contains no secret; auth/config changes invalidate cached account results. */
export function accountCatalogKey(account:Account,files:AccountFiles,version:string|null):string {
 const configured=files.configDir(account)
 const dir=account.cli==='gemini'&&configured?join(configured,'.gemini'):configured??userConfigDir(account.cli)
 const stamps=['config.toml','auth.json','settings.json','.credentials.json','oauth_creds.json'].map(name=>{try{const s=statSync(join(dir,name));return `${name}:${s.mtimeMs}:${s.size}`}catch{return `${name}:missing`}})
 let keyStamp='missing';try{const st=statSync(files.keyPath(account));keyStamp=`${st.mtimeMs}:${st.size}`}catch{}
 return createHash('sha256').update(JSON.stringify([keyStamp,account.cli,account.kind,account.baseUrl,account.model,account.keyHint,dir,version,stamps])).digest('hex')
}
export class CatalogInvalidated extends Error {}
export class AccountCatalogs {
 private entries=new Map<string,{key:string;expires:number;value:Promise<CliCatalog>}>()
 private now: () => number
 private ttlMs: number
 constructor(now=Date.now,ttlMs=5*60_000){this.now=now;this.ttlMs=ttlMs}
 invalidate(id?:string):void{if(id){this.entries.delete(id)}else{this.entries.clear()}}
 get(account:Account,key:string,load:()=>Promise<CliCatalog>):Promise<CliCatalog>{
  const cached=this.entries.get(account.id)
  if(cached?.key===key&&cached.expires>this.now())return cached.value
  const observedAt=this.now()
  const value:Promise<CliCatalog>=Promise.resolve().then(load).then(item=>{if(this.entries.get(account.id)?.value!==value)throw new CatalogInvalidated('Descoberta substituída por uma atualização mais recente');return {...item,accountId:account.id,observedAt,expiresAt:observedAt+this.ttlMs}})
  this.entries.set(account.id,{key,expires:observedAt+this.ttlMs,value})
  value.catch(()=>{if(this.entries.get(account.id)?.value===value)this.entries.delete(account.id)})
  return value
 }
}
