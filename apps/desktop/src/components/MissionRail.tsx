import { useState } from 'react'
import type { Mission, Pane, Workspace } from '@orbit/protocol'
import { MODE_LABEL, pathText, STATUS } from '../orbit/labels.ts'
import { ChevronIcon, MissionGlyph, PlusIcon } from './icons.tsx'

export function MissionRail({ workspace, onEditWorkspace, missions, panes, activeMissionId, selectedPaneId, onSelectMission, onSelectPane, onNewMission }: {
  workspace: Workspace
  onEditWorkspace: () => void
  missions: Mission[]
  panes: Pane[]
  activeMissionId: string | null
  selectedPaneId: number | null
  onSelectMission: (id: string) => void
  onSelectPane: (id: number) => void
  onNewMission: () => void
}) {
  const [showArchived, setShowArchived] = useState(false)
  const active = missions.filter((m) => m.status === 'active').sort((a, b) => b.updatedAt - a.updatedAt)
  const archived = missions.filter((m) => m.status === 'archived')
  const crew = panes.filter((p) => p.missionId === activeMissionId).sort((a, b) => (a.role === b.role ? a.id - b.id : a.role === 'lead' ? -1 : 1))
  const countFor = (id: string) => panes.filter((p) => p.missionId === id && p.status !== 'exited').length

  const missionButton = (m: Mission) => (
    <li key={m.id}>
      <button className="mission-card" aria-current={m.id === activeMissionId} onClick={() => onSelectMission(m.id)}>
        <MissionGlyph />
        <span className="mission-card__text">
          <span className="mission-card__title">{m.title}</span>
          <span className="mission-card__meta">{MODE_LABEL[m.mode]} · {countFor(m.id)} {countFor(m.id) === 1 ? 'agente' : 'agentes'}</span>
        </span>
      </button>
      {m.id === activeMissionId && crew.length > 0 && (
        <div className="crew">
          <div className="eyebrow">Agentes desta missão</div>
          <ul className="plain-list">
            {crew.map((p) => (
              <li key={p.id}>
                <button className="crew__row" title={p.attention ?? p.title} data-attention={p.status === 'waiting'} aria-current={p.id === selectedPaneId} onClick={() => onSelectPane(p.id)}>
                  <span className={`dot dot--${STATUS[p.status].tone}`} />
                  <span className={p.role === 'lead' ? 'crew__name crew__name--lead' : 'crew__name'}>{p.role === 'lead' ? 'Líder' : p.title} <small>#{p.id}</small></span>
                  <span className={`crew__status tone--${STATUS[p.status].tone}`}>{STATUS[p.status].label}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

    </li>
  )

  return (
    <aside className="rail" aria-label="Missões">
      <div className="rail-ws">
        <div className="rail-ws__text">
          <span className="rail-ws__name">{workspace.name}</span>
          <span className="rail-ws__folders" title={workspace.folders.join('\n')}>
            {workspace.folders.length === 1 ? pathText(workspace.path) : `${workspace.folders.length} pastas`}
          </span>
        </div>
        <button className="btn btn--ghost btn--sm" onClick={onEditWorkspace} aria-label={`Editar workspace ${workspace.name}`}>Editar</button>
      </div>
      <div className="rail__head">
        <span className="eyebrow">Missões</span>
        <button className="icon-btn" aria-label="Nova missão" onClick={onNewMission}><PlusIcon size={14} /></button>
      </div>
      {active.length === 0 ? <p className="muted rail__empty">Nenhuma missão ativa neste workspace.</p> : <ul className="plain-list">{active.map(missionButton)}</ul>}


      <div className="rail__spacer" />
      {archived.length > 0 && (
        <div>
          <button className="rail__toggle" aria-expanded={showArchived} onClick={() => setShowArchived(!showArchived)}>
            <ChevronIcon size={12} className={showArchived ? 'rotate-90' : undefined} />Arquivadas · {archived.length}
          </button>
          {showArchived && <ul className="plain-list">{archived.map(missionButton)}</ul>}
        </div>
      )}
    </aside>
  )
}
