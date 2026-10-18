import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AccountCatalogs, parseClaudeCatalog } from '../src/accountCatalog.ts'
import { effortsFor } from '@orbit/protocol'
import { BUILTIN_ACCOUNTS } from '../src/accounts.ts'

test('Claude parser preserves per-model capabilities, hides disabled rows, never invents effort', () => {
 const parsed = parseClaudeCatalog(JSON.stringify({type:'control_response',response:{subtype:'success',response:{models:[
  {value:'opus',displayName:'Opus',supportsEffort:true,supportedEffortLevels:['low','max'],supportsFastMode:true},
  {value:'haiku',supportsEffort:false,supportedEffortLevels:['max']},{value:'blocked',disabled:true}
 ]}}}))
 assert.deepEqual(parsed.models.map(m=>m.id),['opus','haiku'])
 assert.deepEqual(parsed.models[0]!.efforts,['low','max']);assert.deepEqual(parsed.models[1]!.efforts,[])
 assert.equal(parsed.models[0]!.capabilities?.fast,true)
 assert.throws(()=>parseClaudeCatalog('{"type":"control_response","response":{"subtype":"error"}}'))
})
test('account catalog cache isolates accounts, joins probes, expires and invalidates',async()=>{
 let now=1, calls=0
 const cache=new AccountCatalogs(()=>now,10)
 const a={...BUILTIN_ACCOUNTS[1]!,id:'A'},b={...a,id:'B'}
 const load=async(account:typeof a)=>{calls++;return {source:'cli' as const,efforts:[],models:[{id:account.id,label:account.id,description:'',efforts:[],defaultEffort:null}]}}
 const [one,two]=await Promise.all([cache.get(a,'v1',()=>load(a)),cache.get(a,'v1',()=>load(a))]);assert.equal(calls,1);assert.deepEqual(one,two)
 assert.equal((await cache.get(b,'v1',()=>load(b))).models[0]!.id,'B');assert.equal(calls,2)
 now=20;await cache.get(a,'v1',()=>load(a));assert.equal(calls,3)
 cache.invalidate('A');await cache.get(a,'v1',()=>load(a));assert.equal(calls,4)
 await cache.get(a,'v2',()=>load(a));assert.equal(calls,5)
})
test('unavailable catalog and unknown model do not authorize universal effort',()=>{
 assert.deepEqual(effortsFor(null,'claude',null),[])
 const item={source:'cli' as const,efforts:['high' as const],models:[]}
 assert.deepEqual(effortsFor({claude:item,codex:item,gemini:item,antigravity:item},'codex','unlisted'),[])
})
test('automatic seats use the available account own models and effort, never another account catalog',async()=>{
 const {automaticTaskSeat}=await import('../src/taskPolicy.ts')
 const {CATALOG_FIXTURE}=await import('./catalogFixture.ts')
 const make=(id:string,used:number)=>({account:{...BUILTIN_ACCOUNTS[1]!,id},used,live:0,resetsAt:null,full:false})
 const rooms=[make('A',1),make('B',20)]
 const result=automaticTaskSeat({catalog:CATALOG_FIXTURE,preferred:{cli:'codex',model:'gpt-6.1-sol',effort:'medium'},difficulty:'normal',design:null,allowed:['codex'],rooms:()=>rooms,catalogForAccount:account=>account.id==='A'?{source:'cli',efforts:[],models:[]}:{source:'cli',efforts:[],models:[{id:'gpt-6.1-sol',label:'Sol',description:'',efforts:['low','medium'],defaultEffort:'low'}]}})
 assert.equal(result?.accountId,'B');assert.equal(result?.effort,'medium')
})
test('refresh timestamps preserve harness evidence revision; actual per-account capabilities change it',async()=>{
 const {catalogRevision}=await import('../src/catalogRevision.ts')
 const first={accountId:'A',observedAt:1,expiresAt:2,reason:'old',models:[{id:'model',efforts:['low']}]}
 assert.equal(catalogRevision(first),catalogRevision({...first,observedAt:10,expiresAt:20,reason:'refreshed'}))
 assert.notEqual(catalogRevision(first),catalogRevision({...first,models:[{id:'model',efforts:['low','high']}]}))
 const {harnessCandidates}=await import('../src/harnessEligibility.ts'),{blankStatus}=await import('../src/clis.ts'),{CATALOG_FIXTURE}=await import('./catalogFixture.ts')
 const account={...BUILTIN_ACCOUNTS[1]!,id:'second'}
 const candidates=harnessCandidates(CATALOG_FIXTURE,[{...blankStatus('codex'),installed:true,version:'test'}],[account],['codex'],false,()=>({source:'cli',efforts:[],models:[{id:'only-this-account',label:'Own',description:'',efforts:['low'],defaultEffort:null}]}))
 assert.deepEqual(candidates.map(c=>[c.model,c.effort]),[['only-this-account','low']])
})
test('Claude pipeline pins the CLI process, not printf, and custom API backends never inherit native capabilities',async()=>{
 const {discoverAccountCatalog}=await import('../src/accountCatalog.ts'),{AccountFiles}=await import('../src/accounts.ts')
 const files=new AccountFiles('/tmp/orbit-synthetic-catalog-path'),account={...BUILTIN_ACCOUNTS[0]!,id:'second',builtin:false}
 let command=''
 await discoverAccountCatalog(account,files,async text=>{command=text;return {code:127,stdout:'',stderr:'offline'}})
 assert.match(command,/\| CLAUDE_CONFIG_DIR='[^']+second\/claude' claude /)
 let calls=0
 const custom=await discoverAccountCatalog({...account,kind:'api',baseUrl:'https://example.invalid/v1',model:'custom-model'},files,async()=>{calls++;throw Error('No generic probe for custom backend')})
 assert.equal(calls,0);assert.equal(custom.source,'builtin');assert.equal(custom.origin,'account-config')
 assert.ok(custom.reason?.includes('personalizado'));assert.ok(custom.models.every(model=>!model.efforts.length))
})
test('advertised 1M Claude aliases survive discovery and are shell-quoted without enabling glob injection',async()=>{
 const {buildCommand}=await import('../src/command.ts')
 const parsed=parseClaudeCatalog(JSON.stringify({type:'control_response',response:{subtype:'success',response:{models:[{value:'opus[1m]',supportsEffort:true,supportedEffortLevels:['high']}]}}}))
 assert.equal(parsed.models[0]!.id,'opus[1m]')
 assert.match(buildCommand({cli:'claude',model:'opus[1m]',effort:'high'},'/bin/sh').args.join(' '),/--model 'opus\[1m\]'/)
 assert.throws(()=>buildCommand({cli:'claude',model:'opus[1m]; echo injected'},'/bin/sh'))
})
test('an invalidated slow probe cannot overwrite its replacement account catalog',async()=>{
 const {CatalogInvalidated}=await import('../src/accountCatalog.ts')
 const cache=new AccountCatalogs(),account=BUILTIN_ACCOUNTS[1]!
 let finish!:(value:any)=>void
 const old=cache.get(account,'same-version',()=>new Promise(resolve=>{finish=resolve}))
 await Promise.resolve();cache.invalidate(account.id)
 const fresh=await cache.get(account,'same-version',async()=>({source:'cli',efforts:[],models:[{id:'fresh',label:'Fresh',description:'',efforts:[],defaultEffort:null}]}))
 const rejected=assert.rejects(old,CatalogInvalidated)
 finish({source:'cli',efforts:[],models:[]});await rejected
 assert.equal((await cache.get(account,'same-version',async()=>{throw Error('Cached value was lost')})).models[0]?.id,fresh.models[0]?.id)
})
