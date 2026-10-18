/** App plugin contract inspired by Orca bbdbe72 plugin-manifest, MIT; see notices.
 * No plugin JavaScript executes in Node. Only an approved hash may reach the isolated UI host. */
import {z} from 'zod'
import {createHash,randomUUID} from 'node:crypto'
import {mkdirSync,lstatSync,realpathSync,readdirSync,readFileSync,writeFileSync,renameSync,chmodSync,openSync,closeSync,fsyncSync} from 'node:fs'
import {join,relative,isAbsolute} from 'node:path'
import {APP_PLUGIN_EVENTS,APP_PLUGIN_PERMISSIONS,type AppPluginManifest,type AppPluginPermission,type AppPluginSummary,type LoadedAppPlugin} from '@orbit/protocol'
const slug=z.string().min(1).max(64).regex(/^[a-z][a-z0-9-]*$/)
const contribution=z.object({id:slug,title:z.string().min(1).max(100)}).strict()
const schema=z.object({manifestVersion:z.literal(1),pluginApi:z.literal(1),experimental:z.literal(true),publisher:slug,id:slug,name:z.string().min(1).max(100),version:z.string().regex(/^\d+\.\d+\.\d+$/),entry:z.string().min(1).max(120).regex(/^[a-zA-Z0-9_/-]+\.js$/),permissions:z.array(z.enum(APP_PLUGIN_PERMISSIONS)).max(4),contributes:z.object({panels:z.array(contribution).max(8),commands:z.array(contribution).max(32),events:z.array(z.enum(APP_PLUGIN_EVENTS)).max(2)}).strict()}).strict()
export function parseAppPluginManifest(raw:unknown):AppPluginManifest{
 const m=schema.parse(raw)
 if(isAbsolute(m.entry)||m.entry.split('/').some(part=>!part||part==='.'||part==='..'))throw new Error('Entry inválida')
 for(const list of [m.contributes.panels,m.contributes.commands])if(new Set(list.map(x=>x.id)).size!==list.length)throw new Error('Contribuição duplicada')
 if(new Set(m.permissions).size!==m.permissions.length||new Set(m.contributes.events).size!==m.contributes.events.length)throw new Error('Permissão/evento duplicado')
 if(m.contributes.panels.length&&!m.permissions.includes('panels')||m.contributes.commands.length&&!m.permissions.includes('commands')||m.contributes.events.some(event=>!m.permissions.includes(`events:${event}`)))throw new Error('Contribuição sem permissão declarada')
 return m
}
interface Grant {hash:string;enabled:boolean;permissions:AppPluginPermission[]}
export class AppPlugins {
 private readonly root:string
 private readonly grantsPath:string
 constructor(dataDir:string){this.root=join(dataDir,'app-plugins');this.grantsPath=join(dataDir,'app-plugin-grants.json')}
 private directory():void{
  mkdirSync(this.root,{recursive:true,mode:0o700})
  const st=lstatSync(this.root)
  if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==process.getuid?.())throw new Error('Diretório de plugins inseguro')
  chmodSync(this.root,0o700)
 }
 private grants():Record<string,Grant>{
  try{
   const st=lstatSync(this.grantsPath)
   if(!st.isFile()||st.isSymbolicLink()||st.uid!==process.getuid?.()||(st.mode&0o077)!==0||st.size>128*1024)throw new Error('Permissões de plugins inseguras')
   const data=JSON.parse(readFileSync(this.grantsPath,'utf8'))
   if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('Permissões inválidas')
   return data
  }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {};throw error}
 }
 private file(root:string,path:string,maximum:number):string{
  const target=join(root,path),st=lstatSync(target)
  const real=realpathSync(target),rel=relative(realpathSync(root),real)
  if(!st.isFile()||st.isSymbolicLink()||isAbsolute(rel)||rel.startsWith('..')||st.size>maximum)throw new Error('Arquivo de plugin inseguro ou excessivo')
  // Reject symlinks in every directory segment, even if they point back inside the plugin.
  let cursor=root;for(const part of path.split('/')){cursor=join(cursor,part);if(lstatSync(cursor).isSymbolicLink())throw new Error('Links não são permitidos no plugin')}
  return readFileSync(target,'utf8')
 }
 private inspect(key:string,grants:Record<string,Grant>):AppPluginSummary&{code?:string}{
  if(!/^[a-z][a-z0-9-]{0,63}\.[a-z][a-z0-9-]{0,63}$/.test(key))throw new Error('ID de plugin inválido')
  try{
   const root=join(this.root,key),st=lstatSync(root)
   if(!st.isDirectory()||st.isSymbolicLink())throw new Error('Pasta do plugin insegura')
   const manifestText=this.file(root,'orbit-plugin.json',32*1024),manifest=parseAppPluginManifest(JSON.parse(manifestText))
   if(`${manifest.publisher}.${manifest.id}`!==key)throw new Error('Identidade divergente')
   const code=this.file(root,manifest.entry,128*1024),hash=createHash('sha256').update(manifestText).update('\0').update(code).digest('hex'),grant=grants[key]
   const enabled=grant?.enabled===true&&grant.hash===hash&&manifest.permissions.every(p=>grant.permissions?.includes(p))
   return {key,hash,enabled,manifest,code,error:grant?.enabled&&!enabled?'Código/permissões alterados; nova autorização necessária':null}
  }catch{return {key,hash:'',enabled:false,manifest:null,error:'Manifesto/arquivos inválidos ou inseguros; plugin recusado'}}
 }
 list():AppPluginSummary[]{
  this.directory();const grants=this.grants()
  return readdirSync(this.root).filter(name=>/^[a-z][a-z0-9-]{0,63}\.[a-z][a-z0-9-]{0,63}$/.test(name)).slice(0,32).map(key=>{const {code,...summary}=this.inspect(key,grants);return summary})
 }
 configure(key:string,expectedHash:string,enabled:boolean,permissions:AppPluginPermission[]):void{
  this.directory();const grants=this.grants(),current=this.inspect(key,grants)
  if(!current.manifest||!expectedHash||current.hash!==expectedHash)throw new Error('Plugin alterado ou inválido; confira o código atual antes de autorizar')
  if(!Array.isArray(permissions)||permissions.some(p=>!APP_PLUGIN_PERMISSIONS.includes(p)||!current.manifest!.permissions.includes(p))||enabled&&current.manifest.permissions.some(p=>!permissions.includes(p)))throw new Error('Permissões insuficientes ou desconhecidas')
  grants[key]={hash:current.hash,enabled,permissions:enabled?[...new Set(permissions)]:[]}
  const temporary=`${this.grantsPath}.${randomUUID()}.tmp`,fd=openSync(temporary,'wx',0o600)
  try{writeFileSync(fd,JSON.stringify(grants));fsyncSync(fd)}finally{closeSync(fd)}
  renameSync(temporary,this.grantsPath)
 }
 load(key:string):LoadedAppPlugin{
  this.directory();const current=this.inspect(key,this.grants())
  if(!current.enabled||!current.manifest||current.code===undefined)throw new Error('Plugin não ativado ou código alterado; revise suas permissões')
  return {key,hash:current.hash,manifest:current.manifest,code:current.code}
 }
}
