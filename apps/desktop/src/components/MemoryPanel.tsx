import { useEffect, useState } from 'react'
import { MEMORY_KIND_LABEL, MEMORY_LIMITS, type MemoryEntry, type MemoryKind } from '@orbit/protocol'
import { useOrbitClient } from '../orbit/context.tsx'
import { relativeTime } from '../orbit/time.ts'

const WRITABLE: MemoryKind[] = ['decisao', 'fato', 'licao']

/**
 * What a workspace remembers across missions: decisions, facts and lessons the leads wrote down,
 * the summaries of finished missions, and what the person adds. New leads start with it.
 */
export function MemoryPanel({ workspaceId }: { workspaceId: string }) {
  const client = useOrbitClient()
  const [entries, setEntries] = useState<MemoryEntry[] | null>(null)
  const [kind, setKind] = useState<MemoryKind>('fato')
  const [text, setText] = useState('')
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)

  useEffect(() => {
    const stop = client.listen((m) => {
      if (m.type === 'memory' && m.workspaceId === workspaceId) setEntries(m.entries)
    })
    client.send({ type: 'memory.get', workspaceId })
    return stop
  }, [client, workspaceId])

  const save = (entry: { id?: string; kind: MemoryKind; text: string; pinned?: boolean }) => client.send({ type: 'memory.save', workspaceId, entry })
  // Inside the workspace dialog's form: plain buttons, never a nested form.
  const add = () => {
    if (!text.trim()) return
    save({ kind, text: text.trim() })
    setText('')
  }
  const sorted = [...(entries ?? [])].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.at - a.at)

  return (
    <section className="memory" aria-labelledby="memory-title">
      <div className="memory__head">
        <h3 id="memory-title" className="eyebrow">Memória do projeto</h3>
        <span className="muted">{entries === null ? 'lendo…' : `${entries.length} ${entries.length === 1 ? 'anotação' : 'anotações'}`}</span>
      </div>
      <p className="note">
        O que as missões deste workspace aprenderam: decisões, fatos e lições que os líderes anotaram e o resumo de cada missão pronta. Todo líder novo começa com isso. Fixe o que deve vir sempre primeiro; apague o que ficou velho.
      </p>
      <div className="memory__add">
        <label className="sr-only" htmlFor="memory-kind">Tipo</label>
        <select id="memory-kind" value={kind} onChange={(e) => setKind(e.target.value as MemoryKind)}>
          {WRITABLE.map((k) => <option key={k} value={k}>{MEMORY_KIND_LABEL[k]}</option>)}
        </select>
        <label className="sr-only" htmlFor="memory-text">Anotação</label>
        <input id="memory-text" value={text} maxLength={MEMORY_LIMITS.text} placeholder="Ex.: os testes de integração precisam do Docker rodando" onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }} />
        <button type="button" className="btn btn--ghost btn--sm" disabled={!text.trim()} onClick={add}>Anotar</button>
      </div>
      {entries !== null && entries.length === 0 && <p className="muted">Nada ainda. Os líderes anotam aqui o que vale para as próximas missões, e o resumo de cada missão pronta entra sozinho.</p>}
      <ul className="plain-list memory__list">
        {sorted.map((e) => (
          <li key={e.id} className={`memory__entry${e.pinned ? ' memory__entry--pinned' : ''}`}>
            <div className="memory__meta">
              <span className={`chip memory__kind memory__kind--${e.kind}`}>{MEMORY_KIND_LABEL[e.kind]}</span>
              <span className="muted">{e.source ? `${e.source.missionTitle}${e.source.paneId !== null ? ` · #${e.source.paneId}` : ''}` : 'você'} · {relativeTime(e.at)}</span>
              <span className="spacer" />
              <button type="button" className="link-btn" aria-pressed={e.pinned} onClick={() => save({ id: e.id, kind: e.kind, text: e.text, pinned: !e.pinned })}>{e.pinned ? 'Desafixar' : 'Fixar'}</button>
              <button type="button" className="link-btn" onClick={() => setEditing({ id: e.id, text: e.text })}>Editar</button>
              <button type="button" className="link-btn link-btn--danger" onClick={() => { if (confirm('Apagar esta anotação da memória do projeto?')) client.send({ type: 'memory.delete', workspaceId, entryId: e.id }) }}>Apagar</button>
            </div>
            {editing?.id === e.id ? (
              <div className="memory__edit">
                <label className="sr-only" htmlFor={`memory-edit-${e.id}`}>Editar anotação</label>
                <textarea id={`memory-edit-${e.id}`} rows={3} value={editing.text} maxLength={MEMORY_LIMITS.text} autoFocus onChange={(ev) => setEditing({ id: e.id, text: ev.target.value })} />
                <div className="memory__edit-actions">
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditing(null)}>Cancelar</button>
                  <button type="button" className="btn btn--primary btn--sm" onClick={() => {
                    if (editing.text.trim()) save({ id: e.id, kind: e.kind, text: editing.text.trim(), pinned: e.pinned })
                    setEditing(null)
                  }}>Salvar</button>
                </div>
              </div>
            ) : (
              <p className="memory__text">{e.text}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
