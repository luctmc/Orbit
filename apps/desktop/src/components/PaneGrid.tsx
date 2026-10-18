import {reconcileTree,splitTree,resizeTree,treeGeometry,type SplitTree} from '../orbit/splitTree.ts'
import { useEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react'
import { gridColumns, fitTracks, resizeTracks, trackSizes, type Columns, type Layout } from '../orbit/paneLayout.ts'

type Sizes = Record<string, number[]>
const GAP = 12
function readSizes(missionId: string): Sizes {
  try {
    const value = JSON.parse(localStorage.getItem(`orbit.dividers.${missionId}`) ?? '{}')
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch { return {} }
}

/** Flat keyed children stay mounted when their grid coordinates or visibility change. */
export function PaneGrid({ missionId, panes, selectedId, layout, columns }: {
  missionId: string; panes: { id: number; content: ReactNode }[]; selectedId: number | null; layout: Layout; columns: Columns
}) {
  const box = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [height,setHeight]=useState(600)
  const [savedTree,setSavedTree]=useState<unknown>(()=>{try{return JSON.parse(localStorage.getItem(`orbit.splits.${missionId}`)??'null')}catch{return null}})
  const [moving,setMoving]=useState<number|null>(null)
  const splitDrag=useRef<{pointer:number;id:string;axis:'x'|'y';start:number;ratio:number;available:number}|null>(null)
  const [sizes, setSizes] = useState<Sizes>(() => readSizes(missionId))
  const drag = useRef<{ pointer: number; axis: 'x' | 'y'; index: number; start: number; initial: number[]; available: number; key: string } | null>(null)
  const [dragging, setDragging] = useState(false)
  useEffect(() => {
    const element = box.current!
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width > 0) {setWidth(entry.contentRect.width);setHeight(entry.contentRect.height)}
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (dragging) return
    try { localStorage.setItem(`orbit.dividers.${missionId}`, JSON.stringify(sizes)) } catch { /* storage unavailable */ }
  }, [sizes, missionId, dragging])
  const tree=reconcileTree(savedTree,panes.map(p=>p.id))
  const treeKey=JSON.stringify(tree)
  useEffect(()=>{if(tree)try{localStorage.setItem(`orbit.splits.${missionId}`,treeKey)}catch{}},[treeKey,missionId])
  const narrow=layout==='livre'&&width>0&&width<640
  const free=layout==='livre'&&!narrow&&tree!==null
  const geometry=tree?treeGeometry(tree,width,Math.max(220,height-(box.current?.querySelector<HTMLElement>('.split-tools')?.offsetHeight??48))):null
  const other=panes.some(p=>p.id===moving&&p.id!==selectedId)?moving:panes.find(p=>p.id!==selectedId)?.id??null
  const cols = layout === 'foco'||narrow ? 1 : gridColumns(width, panes.length, columns)
  const rows = layout === 'foco'||narrow ? 1 : Math.max(1, Math.ceil(panes.length / cols))
  const xKey = `x:${cols}`, yKey = `y:${cols}:${rows}`
  const x = fitTracks(trackSizes(sizes[xKey], cols), width - (cols - 1) * GAP, 240), y = trackSizes(sizes[yKey], rows)
  const template = (tracks: number[], minimum: number) => tracks.map(v => `minmax(${minimum}px, ${v}fr)`).join(` ${GAP}px `)
  const update = (key: string, value: number[]) => setSizes(current => ({ ...current, [key]: value }))
  const finish = () => { drag.current = null; setDragging(false) }
  // A responsive reflow invalidates the coordinates of an active drag.
  useEffect(finish, [cols, rows, layout])
  function separator(axis: 'x' | 'y', index: number) {
    const vertical = axis === 'x', tracks = vertical ? x : y, key = vertical ? xKey : yKey
    const min = vertical ? Math.min(240, width / cols) : 260
    const available = () => {
      const element = canvas.current!
      return vertical ? element.clientWidth - (cols - 1) * GAP : element.clientHeight - (rows - 1) * GAP
    }
    const pair = tracks[index]! + tracks[index + 1]!
    const value = Math.round(tracks[index]! / pair * 100)
    const dividerRows = Math.floor(panes.length / cols) + (panes.length % cols > index + 1 ? 1 : 0)
    const style: CSSProperties = vertical
      ? { gridColumn: index * 2 + 2, gridRow: `1 / ${dividerRows * 2}` }
      : { gridRow: index * 2 + 2, gridColumn: `1 / ${cols * 2}` }
    return <div key={`${axis}-${index}`} className={`pane-divider pane-divider--${axis}`} style={style}
      role="separator" tabIndex={0} aria-orientation={vertical ? 'vertical' : 'horizontal'}
      aria-label={`Redimensionar ${vertical ? 'colunas' : 'linhas'} ${index + 1} e ${index + 2}`}
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} aria-valuetext={`${value}% e ${100 - value}%`}
      title="Arraste ou use as setas. Home/End ajustam ao limite; Enter ou clique duplo equilibra."
      onDoubleClick={() => update(key, tracks.map((v, at) => at === index || at === index + 1 ? pair / 2 : v))}
      onKeyDown={event => {
        const negative = vertical ? 'ArrowLeft' : 'ArrowUp', positive = vertical ? 'ArrowRight' : 'ArrowDown'
        if (![negative, positive, 'Home', 'End', 'Enter'].includes(event.key)) return
        event.preventDefault()
        if (event.key === 'Enter') update(key, tracks.map((v, at) => at === index || at === index + 1 ? pair / 2 : v))
        else update(key, resizeTracks(tracks, index, event.key === 'Home' ? -available() : event.key === 'End' ? available() : (event.key === negative ? -1 : 1) * (event.shiftKey ? 64 : 24), available(), min))
      }}
      onPointerDown={event => {
        if (event.button !== 0) return
        event.preventDefault()
        event.currentTarget.focus()
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { pointer: event.pointerId, axis, index, start: vertical ? event.clientX : event.clientY, initial: tracks, available: available(), key }
        setDragging(true)
      }}
      onPointerMove={event => {
        const current = drag.current
        if (!current || current.pointer !== event.pointerId) return
        update(current.key, resizeTracks(current.initial, current.index, (current.axis === 'x' ? event.clientX : event.clientY) - current.start, current.available, min))
      }} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish} />
  }
  return <div ref={box} className={`pane-workbench${narrow?' pane-workbench--narrow':''}${dragging ? ' pane-workbench--resizing' : ''}`} data-layout={layout}>
    {layout==='livre'&&<div className={`split-tools${narrow?' split-tools--narrow':''}`}><label>Pane a mover <select aria-label="Pane a mover" value={other??''} onChange={event=>setMoving(Number(event.target.value))}>{panes.filter(p=>p.id!==selectedId).map(p=><option key={p.id} value={p.id}>#{p.id}</option>)}</select></label><button type="button" className="btn btn--ghost btn--sm" disabled={!other||!selectedId} onClick={()=>{if(tree&&other&&selectedId)setSavedTree(splitTree(tree,selectedId,other,'x'))}}>Dividir à direita</button><button type="button" className="btn btn--ghost btn--sm" disabled={!other||!selectedId} onClick={()=>{if(tree&&other&&selectedId)setSavedTree(splitTree(tree,selectedId,other,'y'))}}>Dividir abaixo</button>{narrow&&<span role="status">Janela estreita: foco temporário. Splits salvos preservados.</span>}</div>}
    <div ref={canvas} className="pane-tiles" style={free&&geometry?{display:'block',position:'relative',width:geometry.width,height:geometry.height,minHeight:geometry.height}:{gridTemplateColumns: template(x, 0), gridTemplateRows: template(y, 0), minHeight: narrow ? 212 : layout === 'foco' ? 0 : rows * 300 + (rows - 1) * GAP, ...(narrow?{height:'auto',flex:'1 0 212px'}:{})}}>
    {panes.map((pane, index) => <div key={pane.id} className="pane-slot" hidden={(layout === 'foco'||narrow) && pane.id !== selectedId}
      style={free&&geometry?{position:'absolute',left:geometry.leaves.find(leaf=>leaf.paneId===pane.id)?.left,top:geometry.leaves.find(leaf=>leaf.paneId===pane.id)?.top,width:geometry.leaves.find(leaf=>leaf.paneId===pane.id)?.width,height:geometry.leaves.find(leaf=>leaf.paneId===pane.id)?.height}:{ gridColumn: layout === 'foco'||narrow ? 1 : index === panes.length - 1 ? `${index % cols * 2 + 1} / ${cols * 2}` : index % cols * 2 + 1, gridRow: layout === 'foco'||narrow ? 1 : Math.floor(index / cols) * 2 + 1 }}>
      {pane.content}
    </div>)}
    {free&&geometry?.dividers.map(divider=><div key={divider.id} className={`pane-divider pane-divider--${divider.axis}`} role="separator" tabIndex={0} aria-label="Redimensionar split" aria-orientation={divider.axis==='x'?'vertical':'horizontal'} aria-valuemin={10} aria-valuemax={90} aria-valuenow={Math.round(divider.ratio*100)}
      style={{position:'absolute',left:divider.left,top:divider.top,width:divider.width,height:divider.height}}
      onDoubleClick={()=>{if(tree)setSavedTree(resizeTree(tree,divider.id,.5))}}
      onKeyDown={event=>{const negative=divider.axis==='x'?'ArrowLeft':'ArrowUp',positive=divider.axis==='x'?'ArrowRight':'ArrowDown';if(![negative,positive,'Home','End','Enter'].includes(event.key))return;event.preventDefault();if(tree)setSavedTree(resizeTree(tree,divider.id,event.key==='Enter'?.5:event.key==='Home'?.1:event.key==='End'?.9:divider.ratio+(event.key===negative?-.05:.05)))}}
      onPointerDown={event=>{if(event.button!==0)return;event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);splitDrag.current={pointer:event.pointerId,id:divider.id,axis:divider.axis,start:divider.axis==='x'?event.clientX:event.clientY,ratio:divider.ratio,available:divider.available};setDragging(true)}}
      onPointerMove={event=>{const drag=splitDrag.current;if(!drag||drag.pointer!==event.pointerId||!tree)return;setSavedTree(resizeTree(tree,drag.id,drag.ratio+((drag.axis==='x'?event.clientX:event.clientY)-drag.start)/drag.available))}}
      onPointerUp={()=>{splitDrag.current=null;setDragging(false)}} onPointerCancel={()=>{splitDrag.current=null;setDragging(false)}} onLostPointerCapture={()=>{splitDrag.current=null;setDragging(false)}} />)}
    {layout === 'grade' && Array.from({ length: cols - 1 }, (_, i) => separator('x', i))}
    {layout === 'grade' && Array.from({ length: rows - 1 }, (_, i) => separator('y', i))}
    </div>
  </div>
}
