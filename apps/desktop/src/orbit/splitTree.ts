/** Nested split model inspired by Orca bbdbe72 terminal-pane-layout-tree (MIT).
 * Orbit uses stable numeric pane identities and flat mounted React children. */
export type SplitTree={kind:'leaf';paneId:number}|{kind:'split';id:string;axis:'x'|'y';ratio:number;first:SplitTree;second:SplitTree}
export const treeLeaves=(tree:SplitTree|null):number[]=>!tree?[]:tree.kind==='leaf'?[tree.paneId]:[...treeLeaves(tree.first),...treeLeaves(tree.second)]
function remove(tree:SplitTree,id:number):SplitTree|null{
 if(tree.kind==='leaf')return tree.paneId===id?null:tree
 const first=remove(tree.first,id),second=remove(tree.second,id)
 return !first?second:!second?first:{...tree,first,second}
}
function parse(value:unknown,seen:Set<number>,nodes:Set<string>,depth=0):SplitTree|null{
 if(!value||typeof value!=='object'||depth>32||seen.size>128)return null
 const v=value as any
 if(v.kind==='leaf'&&Number.isSafeInteger(v.paneId)&&v.paneId>0&&!seen.has(v.paneId)){seen.add(v.paneId);return {kind:'leaf',paneId:v.paneId}}
 if(v.kind!=='split'||typeof v.id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(v.id)||nodes.has(v.id)||!['x','y'].includes(v.axis)||!Number.isFinite(v.ratio)||v.ratio<.1||v.ratio>.9)return null
 nodes.add(v.id)
 const first=parse(v.first,seen,nodes,depth+1),second=parse(v.second,seen,nodes,depth+1)
 return first&&second?{kind:'split',id:v.id,axis:v.axis,ratio:v.ratio,first,second}:null
}
export function reconcileTree(saved:unknown,panes:readonly number[]):SplitTree|null{
 const ids=[...new Set(panes.filter(id=>Number.isSafeInteger(id)&&id>0))].slice(0,128)
 if(!ids.length)return null
 let tree=parse(saved,new Set(),new Set())
 if(tree)for(const id of treeLeaves(tree))if(!ids.includes(id))tree=tree&&remove(tree,id)
 for(const id of ids)if(!treeLeaves(tree).includes(id)){tree=tree?{kind:'split',id:`auto-${id}`,axis:'x',ratio:.5,first:tree,second:{kind:'leaf',paneId:id}}:{kind:'leaf',paneId:id}}
 return tree
}
export function splitTree(tree:SplitTree,target:number,moving:number,axis:'x'|'y'):SplitTree{
 if(target===moving||!treeLeaves(tree).includes(target)||!treeLeaves(tree).includes(moving))return tree
 const stripped=remove(tree,moving)!
 const taken=new Set<string>();const collect=(node:SplitTree)=>{if(node.kind==='split'){taken.add(node.id);collect(node.first);collect(node.second)}};collect(stripped)
 let id=`split-${target}-${moving}-${axis}`,suffix=0
 while(taken.has(id))id=`split-${target}-${moving}-${axis}-${++suffix}`
 const visit=(node:SplitTree):SplitTree=>node.kind==='leaf'?node.paneId===target?{kind:'split',id,axis,ratio:.5,first:node,second:{kind:'leaf',paneId:moving}}:node:{...node,first:visit(node.first),second:visit(node.second)}
 return visit(stripped)
}
export function resizeTree(tree:SplitTree,id:string,ratio:number):SplitTree{
 if(tree.kind==='leaf'||!Number.isFinite(ratio))return tree
 return {...tree,ratio:tree.id===id?Math.max(.1,Math.min(.9,ratio)):tree.ratio,first:resizeTree(tree.first,id,ratio),second:resizeTree(tree.second,id,ratio)}
}
interface Rect {left:number;top:number;width:number;height:number}
function minimum(tree:SplitTree):{width:number;height:number}{
 if(tree.kind==='leaf')return {width:240,height:220}
 const a=minimum(tree.first),b=minimum(tree.second)
 return tree.axis==='x'?{width:a.width+b.width+8,height:Math.max(a.height,b.height)}:{width:Math.max(a.width,b.width),height:a.height+b.height+8}
}
export function treeGeometry(tree:SplitTree,width:number,height:number){
 const min=minimum(tree),leaves:Array<Rect&{paneId:number}>=[],dividers:Array<Rect&{id:string;axis:'x'|'y';ratio:number;available:number}>=[]
 const root={left:0,top:0,width:Math.max(min.width,width),height:Math.max(min.height,height)}
 const visit=(node:SplitTree,rect:Rect)=>{
  if(node.kind==='leaf'){leaves.push({...rect,paneId:node.paneId});return}
  const a=minimum(node.first),b=minimum(node.second),vertical=node.axis==='x',available=(vertical?rect.width:rect.height)-8
  const first=Math.max(vertical?a.width:a.height,Math.min(available-(vertical?b.width:b.height),available*node.ratio)),second=available-first
  const ratio=first/available
  dividers.push({...rect,id:node.id,axis:node.axis,ratio,available,...(vertical?{left:rect.left+first,width:8}:{top:rect.top+first,height:8})})
  visit(node.first,{...rect,...(vertical?{width:first}:{height:first})})
  visit(node.second,{...rect,...(vertical?{left:rect.left+first+8,width:second}:{top:rect.top+first+8,height:second})})
 }
 visit(tree,root)
 return {...root,leaves,dividers}
}
