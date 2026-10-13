import { useState, type FormEvent } from 'react'
import type { Mission, Pane } from '@orbit/protocol'
import { useOrbitClient } from '../orbit/context.tsx'
import { MODE_LABEL } from '../orbit/labels.ts'
import { ArchiveIcon, PlusIcon, SendIcon } from './icons.tsx'
import { PaneView } from './PaneView.tsx'

export type Layout = 'grade' | 'foco'

export function MissionView({ mission, panes, selectedPaneId, layout, onLayout, onSelectPane, onAddAgent }: {
  mission: Mission
  panes: Pane[]
  selectedPaneId: number | null
  layout: Layout
  onLayout: (layout: Layout) => void
  onSelectPane: (id: number) => void
  onAddAgent: () => void
}) {
  const client = useOrbitClient()
  const [command, setCommand] = useState('')
  const archived = mission.status === 'archived'
  const selected = panes.find((p) => p.id === selectedPaneId) ?? panes[0] ?? null
  const visible = layout === 'foco' && selected ? [selected] : panes
  const alive = panes.filter((p) => p.status !== 'exited').length

  const sendCommand = (event: FormEvent) => {
    event.preventDefault()
    if (!selected || !command.trim()) return
    client.send({ type: 'pane.input', paneId: selected.id, data: `${command}\r` })
    setCommand('')
  }

  return (
    <main className="mission">
      <div className="mission__head">
        <div className="mission__title">
          <div className="mission__title-row">
            <h1>{mission.title}</h1>
            <span className={`badge badge--${mission.mode}`}>{MODE_LABEL[mission.mode]}</span>
            {archived && <span className="badge">Arquivada</span>}
          </div>
          <p className="muted">{mission.objective || 'Sem objetivo descrito.'} · {alive} {alive === 1 ? 'agente vivo' : 'agentes vivos'}</p>
        </div>
        <div className="mission__actions">
          <div className="segmented" role="group" aria-label="Layout dos agentes">
            <button type="button" aria-pressed={layout === 'grade'} onClick={() => onLayout('grade')}>Grade</button>
            <button type="button" aria-pressed={layout === 'foco'} onClick={() => onLayout('foco')}>Foco</button>
          </div>
          {!archived && (
            <>
              <button className="btn btn--ghost btn--sm" onClick={onAddAgent}><PlusIcon size={14} />Agente</button>
              <button className="icon-btn" aria-label="Arquivar missão" title="Arquivar missão (encerra os agentes)" onClick={() => {
                if (confirm('Arquivar a missão encerra todos os agentes dela. Continuar?')) client.send({ type: 'mission.archive', missionId: mission.id })
              }}><ArchiveIcon /></button>
            </>
          )}
        </div>
      </div>

      {panes.length === 0 ? (
        <div className="empty">
          <p>{archived ? 'Missão arquivada, sem agentes.' : 'Nenhum agente nesta missão.'}</p>
          {!archived && <button className="btn btn--primary" onClick={onAddAgent}><PlusIcon size={14} />Abrir um agente</button>}
        </div>
      ) : (
        <div className={`pane-grid pane-grid--${layout}`}>
          {visible.map((p) => <PaneView key={p.id} pane={p} selected={p.id === selected?.id} onSelect={() => onSelectPane(p.id)} />)}
        </div>
      )}

      {selected && selected.status !== 'exited' && (
        <form className="command" onSubmit={sendCommand}>
          <label htmlFor="command" className="command__label">Falar com #{selected.id}</label>
          <input id="command" value={command} onChange={(e) => setCommand(e.target.value)} placeholder="Escreva para o agente selecionado e tecle Enter" autoComplete="off" />
          <button type="submit" className="icon-btn icon-btn--boxed" aria-label="Enviar"><SendIcon /></button>
        </form>
      )}
    </main>
  )
}
