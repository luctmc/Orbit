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
  const [sizes, setSizes] = useState<Sizes>(() => readSizes(missionId))
  const drag = useRef<{ pointer: number; axis: 'x' | 'y'; index: number; start: number; initial: number[]; available: number; key: string } | null>(null)
  const [dragging, setDragging] = useState(false)
  useEffect(() => {
    const element = box.current!
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width > 0) setWidth(entry.contentRect.width)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (dragging) return
    try { localStorage.setItem(`orbit.dividers.${missionId}`, JSON.stringify(sizes)) } catch { /* storage unavailable */ }
  }, [sizes, missionId, dragging])
  const cols = layout === 'foco' ? 1 : gridColumns(width, panes.length, columns)
  const rows = layout === 'foco' ? 1 : Math.max(1, Math.ceil(panes.length / cols))
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
  return <div ref={box} className={`pane-workbench${dragging ? ' pane-workbench--resizing' : ''}`} data-layout={layout}>
    <div ref={canvas} className="pane-tiles" style={{ gridTemplateColumns: template(x, 0), gridTemplateRows: template(y, 0), minHeight: layout === 'foco' ? 0 : rows * 300 + (rows - 1) * GAP }}>
    {panes.map((pane, index) => <div key={pane.id} className="pane-slot" hidden={layout === 'foco' && pane.id !== selectedId}
      style={{ gridColumn: layout === 'foco' ? 1 : index === panes.length - 1 ? `${index % cols * 2 + 1} / ${cols * 2}` : index % cols * 2 + 1, gridRow: layout === 'foco' ? 1 : Math.floor(index / cols) * 2 + 1 }}>
      {pane.content}
    </div>)}
    {layout === 'grade' && Array.from({ length: cols - 1 }, (_, i) => separator('x', i))}
    {layout === 'grade' && Array.from({ length: rows - 1 }, (_, i) => separator('y', i))}
    </div>
  </div>
}
