import {test} from 'node:test'
import assert from 'node:assert/strict'
import {pluginDocument,validPluginReply} from './sandbox.ts'
import type {LoadedAppPlugin} from '@orbit/protocol'
const fixture:LoadedAppPlugin={key:'fixture.demo',hash:'hash',code:'</script><script>parent.PWNED=true</script>',manifest:{manifestVersion:1,pluginApi:1,experimental:true,id:'demo',publisher:'fixture',name:'Fixture',version:'1.0.0',entry:'main.js',permissions:['panels'],contributes:{panels:[],commands:[],events:[]}}}
test('plugin source cannot escape trusted srcdoc script or gain native/network/parent authority',()=>{
 const doc=pluginDocument('http://localhost/orbit-plugin-host.js')
 assert.equal((doc.match(/<script/g)??[]).length,1)
 assert.equal((doc.match(/<\/script>/g)??[]).length,1)
 assert.ok(doc.includes("connect-src 'none'"));assert.ok(doc.includes('script src="http://localhost/orbit-plugin-host.js"'));assert.ok(!doc.includes(fixture.code))
 assert.throws(()=>pluginDocument('javascript:alert(1)'));assert.throws(()=>pluginDocument('http://localhost/other.js'))
 assert.equal(validPluginReply({channel:'wrong',kind:'ready'},'channel'),false)
 assert.equal(validPluginReply({channel:'channel',kind:'result',requestId:'id',ok:true,text:'x'.repeat(8193)},'channel'),false)
 assert.equal(validPluginReply({channel:'channel',kind:'result',requestId:'id',ok:true,text:{nested:'object'}},'channel'),false)
 assert.equal(validPluginReply({channel:'channel',kind:'result',requestId:'id',ok:true,text:'ok'},'channel'),true)
})
