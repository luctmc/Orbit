import type { Workspace } from '@orbit/protocol'
import type { OrbitState } from '../orbit/client.ts'
import { HomeIcon, OrbitMark, PlusIcon } from './icons.tsx'

const CONNECTION_LABEL: Record<OrbitState['connection'], string> = {
  connecting: 'Conectando ao motor…',
  open: 'Motor ativo',
  closed: 'Motor fora do ar',
}

export function TitleBar({ connection, liveAgents }: { connection: OrbitState['connection']; liveAgents: number }) {
  return (
    // data-tauri-drag-region only applies to the element itself, so every non-interactive piece carries it.
    <header className="titlebar" data-tauri-drag-region>
      <div className="brand" data-tauri-drag-region>
        <OrbitMark />
        <span className="brand__name" data-tauri-drag-region>Orbit</span>
        <span className="brand__version" data-tauri-drag-region>0.1.0</span>
      </div>
      <div className="titlebar__drag" data-tauri-drag-region />
      <div className="titlebar__status">
        <span className="muted">{liveAgents} {liveAgents === 1 ? 'agente vivo' : 'agentes vivos'}</span>
        <span className="status-pill" data-state={connection}>
          <span className={`dot ${connection === 'open' ? 'dot--live' : connection === 'closed' ? 'dot--wait' : 'dot--idle'}`} />
          {CONNECTION_LABEL[connection]}
        </span>
      </div>
    </header>
  )
}

export function WorkspaceTabs({ workspaces, activeId, homeActive, onHome, onSelect, onOpen, onNewMission, onSquads, onSettings }: {
  workspaces: Workspace[]
  activeId: string | null
  homeActive: boolean
  onHome: () => void
  onSelect: (id: string) => void
  onOpen: () => void
  onNewMission: (() => void) | null
  onSquads: () => void
  onSettings: () => void
}) {
  return (
    <nav className="tabs" aria-label="Workspaces">
      <button className="tabs__home" aria-label="Base" aria-current={homeActive} title="Base" onClick={onHome}><HomeIcon size={18} /></button>
      <div className="tabs__list">
        {workspaces.map((w) => (
          <button key={w.id} aria-current={w.id === activeId} className="tab" title={w.path} onClick={() => onSelect(w.id)}>
            {w.name}
          </button>
        ))}
        <button className="icon-btn" aria-label="Abrir pasta como workspace" onClick={onOpen}><PlusIcon size={15} /></button>
      </div>
      <button className="btn btn--ghost btn--sm" onClick={onSquads}>Squads</button>
      <button className="btn btn--ghost btn--sm" onClick={onSettings} title="Quem faz cada tarefa">Ajustes</button>
      {onNewMission && (
        <button className="btn btn--primary btn--sm" onClick={onNewMission}><PlusIcon size={14} />Nova missão</button>
      )}
    </nav>
  )
}
