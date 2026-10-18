import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,symlinkSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {AppPlugins,parseAppPluginManifest} from '../src/appPlugins.ts'
const manifest={manifestVersion:1,pluginApi:1,experimental:true,publisher:'fixture',id:'sample',name:'Synthetic plugin',version:'1.0.0',entry:'main.js',permissions:['panels','commands','events:pane.status.changed'],contributes:{panels:[{id:'status',title:'Status'}],commands:[{id:'ping',title:'Ping'}],events:['pane.status.changed']}}
function fixture(){const root=mkdtempSync(join(tmpdir(),'orbit-app-plugins-')),path=join(root,'app-plugins','fixture.sample');mkdirSync(path,{recursive:true,mode:0o700});writeFileSync(join(path,'orbit-plugin.json'),JSON.stringify(manifest));writeFileSync(join(path,'main.js'),'orbit.registerCommand("ping",()=>"pong")');return {root,path,host:new AppPlugins(root)}}
test('strict experimental contract refuses native capabilities, traversal, duplicates and undeclared event permissions',()=>{
 assert.equal(parseAppPluginManifest(manifest).id,'sample')
 for(const change of [{main:'node.js'},{permissions:['filesystem']},{entry:'../secret'},{pluginApi:2},{experimental:false},{contributes:{...manifest.contributes,commands:[{id:'ping',title:'One'},{id:'ping',title:'Duplicate'}]}},{permissions:['panels','commands']}])assert.throws(()=>parseAppPluginManifest({...manifest,...change}))
})
test('disabled by default; explicit grants pin source hash, revocation and restart preserve permission boundaries',()=>{
 const f=fixture(),initial=f.host.list()[0]!
 assert.equal(initial.enabled,false);assert.throws(()=>f.host.load(initial.key),/ativado/)
 f.host.configure(initial.key,initial.hash,true,initial.manifest!.permissions)
 assert.equal(f.host.load(initial.key).code.includes('ping'),true)
 assert.equal(new AppPlugins(f.root).list()[0]!.enabled,true)
 writeFileSync(join(f.path,'main.js'),'throw new Error("changed")')
 assert.equal(f.host.list()[0]!.enabled,false);assert.throws(()=>f.host.load(initial.key),/ativado|alterado/)
 assert.throws(()=>f.host.configure(initial.key,initial.hash,true,initial.manifest!.permissions),/alterado/)
 const current=f.host.list()[0]!;f.host.configure(current.key,current.hash,false,[]);assert.throws(()=>f.host.load(initial.key))
})
test('symlinked plugin entries cannot expose credentials or arbitrary host files',()=>{
 const f=fixture();const secret=join(f.root,'secret');writeFileSync(secret,'DO_NOT_EXPOSE')
 writeFileSync(join(f.path,'orbit-plugin.json'),JSON.stringify({...manifest,entry:'secret.js'}));symlinkSync(secret,join(f.path,'secret.js'))
 const entry=f.host.list()[0]!;assert.equal(entry.enabled,false);assert.equal(entry.manifest,null);assert.doesNotMatch(JSON.stringify(entry),/DO_NOT_EXPOSE/)
})
