import {test} from 'node:test'
import assert from 'node:assert/strict'
import {reconcileTree,splitTree,resizeTree,treeLeaves,treeGeometry} from './splitTree.ts'
test('nested splits move stable identities, normalize removal, restore and reject corrupt/duplicate data',()=>{
 let tree=reconcileTree(null,[1,2,3])!
 tree=splitTree(tree,1,2,'x');tree=splitTree(tree,1,3,'y')
 assert.deepEqual(treeLeaves(tree),[1,3,2])
 assert.deepEqual(treeLeaves(reconcileTree(JSON.parse(JSON.stringify(tree)),[1,3])!),[1,3])
 assert.deepEqual(treeLeaves(reconcileTree({kind:'split',first:{kind:'leaf',paneId:1},second:{kind:'leaf',paneId:1}},[1,2])!),[1,2])
 assert.deepEqual(treeLeaves(reconcileTree(tree,[1,3,4])!),[1,3,4])
 assert.equal(reconcileTree(tree,[]),null)
})
test('geometry keeps minimum pane sizes, resize clamps, and persistent tree is not mutated by a narrow viewport',()=>{
 let tree=splitTree(reconcileTree(null,[1,2,3])!,1,3,'y')
 const before=JSON.stringify(tree),wide=treeGeometry(tree,900,700)
 assert.equal(wide.leaves.length,3)
 for(const leaf of wide.leaves){assert.ok(leaf.width>=240);assert.ok(leaf.height>=220)}
 const small=treeGeometry(tree,300,300)
 assert.ok(small.width>=480);assert.equal(JSON.stringify(tree),before)
 if(tree.kind==='split'){tree=resizeTree(tree,tree.id,100);assert.equal(tree.kind==='split'&&tree.ratio,.9)}
})
