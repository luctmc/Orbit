import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,writeFileSync,symlinkSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {TerminalHistory} from '../src/terminalHistory.ts'
import {PaneManager} from '../src/panes.ts'

test('output journal replays only rows after the atomic checkpoint; partial final write is ignored',()=>{
 const root=mkdtempSync(join(tmpdir(),'orbit-history-')),epoch=randomUUID(),history=new TerminalHistory(root,1,epoch)
 history.append({type:'data',data:'old'});history.checkpoint({sequence:1,data:'screen',cols:80,rows:24});history.append({type:'data',data:'new'})
 const journal=join(root,'1',epoch,'output.jsonl');writeFileSync(journal,readFileSync(journal,'utf8')+'{"sequence":3')
 const recovered=new TerminalHistory(root,1,epoch).recover()
 assert.equal(recovered.snapshot?.data,'screen');assert.deepEqual(recovered.events,[{sequence:2,type:'data',data:'new'}])
})
test('symlink, malformed sequence and traversal cannot inject input or replace arbitrary files',()=>{
 const root=mkdtempSync(join(tmpdir(),'orbit-history-security-')),epoch=randomUUID(),history=new TerminalHistory(root,1,epoch)
 assert.throws(()=>new TerminalHistory(root,1,'../../escape'))
 writeFileSync(join(root,'1',epoch,'output.jsonl'),'{"sequence":2,"type":"data","data":"oops"}\n',{mode:0o600})
 assert.throws(()=>history.recover(),/Lacuna/)
 const second=new TerminalHistory(root,2,epoch),target=join(root,'protected')
 writeFileSync(target,'protected');symlinkSync(target,join(root,'2',epoch,'output.jsonl'))
 assert.throws(()=>second.append({type:'data',data:'overwrite'}),/inseguro/);assert.equal(readFileSync(target,'utf8'),'protected')
})
test('real terminal history survives manager/core loss and is recovered as output without rerunning commands',async()=>{
 const root=mkdtempSync(join(tmpdir(),'orbit-history-pty-')),epoch=randomUUID(),manager=new PaneManager('/bin/sh',()=>({file:'/bin/sh',args:['-c','printf "HISTORY_MARKER\\n"']}),root)
 const pane=manager.spawn({id:1,executionEpoch:epoch,request:{missionId:'history',role:'lead',cli:'shell',model:null,title:'History'},cwd:root,launch:{cli:'shell',model:null},env:{},hookDriven:false,accountId:null,squadRole:null,taskType:null})
 await manager.waitForExit();await manager.flushHistory()
 const recovered=new PaneManager('/bin/sh',undefined,root);recovered.restoreHistory({...pane,status:'exited',pid:null})
 assert.match((await recovered.snapshot(1))!.data,/HISTORY_MARKER/)
 assert.equal(recovered.isAlive(1),false)
})
