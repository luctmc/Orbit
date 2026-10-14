import { useMemo, useState, type DragEvent, type FormEvent } from 'react'
import { CARD_COLUMN_LABEL, CARD_COLUMNS, CARD_LIMITS, type Card, type CardColumn, type Pane } from '@orbit/protocol'
import { useOrbit, useOrbitClient } from '../orbit/context.tsx'
import { relativeTime } from '../orbit/time.ts'
import { BackIcon, ChevronIcon, CloseIcon, PlusIcon } from './icons.tsx'

const DRAG_TYPE = 'application/x-orbit-card'

/** The mission's board: the same cards the agents read and move through MCP. */
export function BoardPanel({ missionId, panes, archived, onClose }: { missionId: string; panes: Pane[]; archived: boolean; onClose: () => void }) {
  const client = useOrbitClient()
  const { cards: all } = useOrbit()
  const cards = useMemo(() => all.filter((c) => c.missionId === missionId), [all, missionId])
  const [open, setOpen] = useState<string | null>(null)
  const [adding, setAdding] = useState<CardColumn | null>(null)
  const [dropAt, setDropAt] = useState<{ column: CardColumn; index: number } | null>(null)
  const editing = cards.find((c) => c.id === open)

  const columnCards = (column: CardColumn) => cards.filter((c) => c.column === column).sort((a, b) => a.order - b.order)
  const done = cards.filter((c) => c.column === 'feito').length

  const onDrop = (column: CardColumn, index: number) => (event: DragEvent) => {
    event.preventDefault()
    const id = event.dataTransfer.getData(DRAG_TYPE)
    setDropAt(null)
    if (!id) return
    const card = cards.find((c) => c.id === id)
    // Moving down inside the same column: the card's own slot disappears first.
    const at = card && card.column === column && card.order < index ? index - 1 : index
    client.send({ type: 'card.move', cardId: id, column, index: at })
  }

  return (
    <aside className="side-panel board" aria-label="Quadro da missão">
      <div className="side-panel__bar">
        {editing ? (
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setOpen(null)}><BackIcon size={14} />Quadro</button>
        ) : (
          <span className="board__summary"><strong>Quadro</strong> <span className="muted">{cards.length ? `${done} de ${cards.length} feitos` : 'vazio'}</span></span>
        )}
        <span className="spacer" />
        <button type="button" className="icon-btn" aria-label="Fechar o quadro" onClick={onClose}><CloseIcon size={14} /></button>
      </div>
      <div className="side-panel__body">
        {editing ? (
          <CardEditor key={editing.id} card={editing} panes={panes} archived={archived} onDone={() => setOpen(null)} />
        ) : (
          <div className="board__columns">
            {CARD_COLUMNS.map((column) => {
              const list = columnCards(column)
              return (
                <section key={column} className={`board__column board__column--${column}`} aria-label={CARD_COLUMN_LABEL[column]}
                  onDragOver={(e) => { if (!archived && e.dataTransfer.types.includes(DRAG_TYPE)) { e.preventDefault(); if (dropAt?.column !== column || dropAt.index !== list.length) setDropAt({ column, index: list.length }) } }}
                  onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropAt(null) }}
                  onDrop={onDrop(column, dropAt?.column === column ? dropAt.index : list.length)}>
                  <header className="board__column-head">
                    <span>{CARD_COLUMN_LABEL[column]}</span>
                    <span className="muted">{list.length}</span>
                    <span className="spacer" />
                    {!archived && <button type="button" className="icon-btn" aria-label={`Novo cartão em ${CARD_COLUMN_LABEL[column]}`} onClick={() => setAdding(column)}><PlusIcon size={13} /></button>}
                  </header>
                  {adding === column && <NewCard missionId={missionId} column={column} onDone={() => setAdding(null)} />}
                  <ol className="plain-list board__cards">
                    {list.map((card, index) => (
                      <li key={card.id}
                        onDragOver={(e) => {
                          if (archived || !e.dataTransfer.types.includes(DRAG_TYPE)) return
                          e.preventDefault()
                          e.stopPropagation()
                          const box = e.currentTarget.getBoundingClientRect()
                          const at = e.clientY < box.top + box.height / 2 ? index : index + 1
                          if (dropAt?.column !== column || dropAt.index !== at) setDropAt({ column, index: at })
                        }}
                        onDrop={(e) => { e.stopPropagation(); onDrop(column, dropAt?.column === column ? dropAt.index : index)(e) }}
                        className={dropAt?.column === column ? (dropAt.index === index ? 'drop-before' : dropAt.index === index + 1 && index === list.length - 1 ? 'drop-after' : '') : ''}>
                        <CardItem card={card} panes={panes} draggable={!archived} onOpen={() => setOpen(card.id)}
                          onMove={(to) => client.send({ type: 'card.move', cardId: card.id, column: to })} />
                      </li>
                    ))}
                  </ol>
                  {list.length === 0 && adding !== column && <p className="muted board__empty">{column === 'afazer' ? 'Nada planejado.' : column === 'fazendo' ? 'Ninguém trabalhando.' : 'Nada feito ainda.'}</p>}
                </section>
              )
            })}
          </div>
        )}
      </div>
    </aside>
  )
}

function who(id: number | null, panes: Pane[]): string | null {
  if (id === null) return null
  const pane = panes.find((p) => p.id === id)
  return pane ? `#${id} ${pane.title}` : `#${id}`
}

function CardItem({ card, panes, draggable, onOpen, onMove }: { card: Card; panes: Pane[]; draggable: boolean; onOpen: () => void; onMove: (to: CardColumn) => void }) {
  const at = CARD_COLUMNS.indexOf(card.column)
  const next = CARD_COLUMNS[at + 1]
  const assignee = who(card.assignee, panes)
  return (
    <article className="card" draggable={draggable} onDragStart={(e) => { e.dataTransfer.setData(DRAG_TYPE, card.id); e.dataTransfer.effectAllowed = 'move' }}>
      <button type="button" className="card__open" onClick={onOpen} aria-label={`T${card.number}: ${card.title}. Abrir`}>
        <span className="card__number">T{card.number}</span>
        <span className="card__title">{card.title}</span>
      </button>
      <div className="card__meta">
        {assignee && <span className="chip card__who" title={`Responsável: ${assignee}`}>#{card.assignee}</span>}
        {card.notes && <span className="muted" title={card.notes}>notas</span>}
        <span className="spacer" />
        {draggable && next && (
          <button type="button" className="card__move" onClick={() => onMove(next)} title={`Mover para ${CARD_COLUMN_LABEL[next]}`} aria-label={`Mover T${card.number} para ${CARD_COLUMN_LABEL[next]}`}>
            {CARD_COLUMN_LABEL[next]}<ChevronIcon size={11} />
          </button>
        )}
      </div>
    </article>
  )
}

function NewCard({ missionId, column, onDone }: { missionId: string; column: CardColumn; onDone: () => void }) {
  const client = useOrbitClient()
  const [title, setTitle] = useState('')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (title.trim()) client.send({ type: 'card.add', missionId, title: title.trim(), column })
    setTitle('')
    onDone()
  }
  return (
    <form className="card card--new" onSubmit={submit}>
      <label className="sr-only" htmlFor={`new-card-${column}`}>Título do cartão</label>
      <input id={`new-card-${column}`} value={title} maxLength={CARD_LIMITS.title} autoFocus placeholder="O que fazer"
        onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') onDone() }} onBlur={() => { if (!title.trim()) onDone() }} />
    </form>
  )
}

function CardEditor({ card, panes, archived, onDone }: { card: Card; panes: Pane[]; archived: boolean; onDone: () => void }) {
  const client = useOrbitClient()
  const [title, setTitle] = useState(card.title)
  const [notes, setNotes] = useState(card.notes)
  const changed = title.trim() !== card.title || notes.trim() !== card.notes
  const save = (event?: FormEvent) => {
    event?.preventDefault()
    if (title.trim() && changed) client.send({ type: 'card.update', cardId: card.id, title: title.trim(), notes })
    onDone()
  }
  const agents = panes.filter((p) => p.cli !== 'shell' || p.id === card.assignee)
  return (
    <form className="card-editor" onSubmit={save}>
      <div className="card-editor__head">
        <span className="card__number">T{card.number}</span>
        <span className="muted">criado por {card.createdBy} · atualizado {relativeTime(card.updatedAt)}</span>
      </div>
      <div className="field">
        <label htmlFor="card-title">Título</label>
        <input id="card-title" value={title} maxLength={CARD_LIMITS.title} disabled={archived} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="card-notes">Notas</label>
        <textarea id="card-notes" rows={6} value={notes} maxLength={CARD_LIMITS.notes} disabled={archived} placeholder="Contexto, critério de pronto…" onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="card-assignee">Responsável</label>
        <select id="card-assignee" value={card.assignee ?? ''} disabled={archived}
          onChange={(e) => client.send({ type: 'card.update', cardId: card.id, assignee: e.target.value ? Number(e.target.value) : null })}>
          <option value="">Ninguém</option>
          {agents.map((p) => <option key={p.id} value={p.id}>#{p.id} {p.title}</option>)}
        </select>
      </div>
      <fieldset className="field">
        <legend>Coluna</legend>
        <div className="segmented">
          {CARD_COLUMNS.map((c) => <button key={c} type="button" disabled={archived} aria-pressed={card.column === c} onClick={() => client.send({ type: 'card.move', cardId: card.id, column: c })}>{CARD_COLUMN_LABEL[c]}</button>)}
        </div>
      </fieldset>
      <div className="card-editor__actions">
        {!archived && <button type="button" className="btn btn--ghost btn--sm btn--danger" onClick={() => { if (confirm(`Apagar T${card.number}?`)) { client.send({ type: 'card.delete', cardId: card.id }); onDone() } }}>Apagar</button>}
        <span className="spacer" />
        <button type="button" className="btn btn--ghost btn--sm" onClick={onDone}>Voltar</button>
        {!archived && <button type="submit" className="btn btn--primary btn--sm" disabled={!title.trim() || !changed}>Salvar</button>}
      </div>
    </form>
  )
}
