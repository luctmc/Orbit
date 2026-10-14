import { useRef, useState, type FormEvent } from 'react'
import type { Mission, Pane } from '@orbit/protocol'
import { useOrbit, useOrbitClient } from '../orbit/context.tsx'
import { dictationAvailable, joinText, useDictation } from '../orbit/dictation.ts'
import { costText, MODE_LABEL, tokensText } from '../orbit/labels.ts'
import { BrowserPanel } from './BrowserPanel.tsx'
import { FilesPanel } from './FilesPanel.tsx'
import { ArchiveIcon, FolderIcon, GlobeIcon, MicIcon, PlusIcon, SendIcon } from './icons.tsx'
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
  const { squads, browsers, workspaces } = useOrbit()
  const squad = squads.find((s) => s.id === mission.squadId)
  const workspace = workspaces.find((w) => w.id === mission.workspaceId)
  const page = browsers.find((b) => b.missionId === mission.id)
  /** One side panel at a time, next to the agents. */
  const [side, setSide] = useState<'arquivos' | 'navegador' | null>(null)
  const browserOpen = side === 'navegador'
  const toggleSide = (panel: 'arquivos' | 'navegador') => setSide((open) => (open === panel ? null : panel))
  const [command, setCommand] = useState('')
  const commandInput = useRef<HTMLInputElement>(null)
  /** What was typed before dictating, plus each phrase already recognized. */
  const dictated = useRef('')
  const dictation = useDictation((text, final) => {
    if (final) {
      dictated.current = joinText(dictated.current, text)
      setCommand(dictated.current)
    } else {
      setCommand(joinText(dictated.current, text))
    }
  })
  const toggleDictation = () => {
    if (dictation.listening) return dictation.stop()
    dictated.current = command
    dictation.start()
    commandInput.current?.focus()
  }
  const archived = mission.status === 'archived'
  const selected = panes.find((p) => p.id === selectedPaneId) ?? panes[0] ?? null
  const visible = layout === 'foco' && selected ? [selected] : panes
  const alive = panes.filter((p) => p.status !== 'exited').length

  const sendCommand = (event: FormEvent) => {
    event.preventDefault()
    if (!selected || !command.trim()) return
    if (dictation.listening) dictation.stop()
    dictated.current = ''
    client.send({ type: 'pane.submit', paneId: selected.id, text: command })
    setCommand('')
  }

  return (
    <main className="mission">
      <div className="mission__head">
        <div className="mission__title">
          <div className="mission__title-row">
            <h1>{mission.title}</h1>
            <span className={`badge badge--${mission.mode}`}>{MODE_LABEL[mission.mode]}{squad ? ` · ${squad.name}` : ''}</span>
            {archived && <span className="badge">Arquivada</span>}
          </div>
          <p className="muted">
            {mission.objective || 'Sem objetivo descrito.'} · {alive} {alive === 1 ? 'agente vivo' : 'agentes vivos'}
            {mission.usage.total > 0 && <span title={costText(mission.usage.costUsd) ? `${costText(mission.usage.costUsd)} em preço de API (Claude)` : undefined}> · {tokensText(mission.usage.total)} tokens</span>}
          </p>
        </div>
        <div className="mission__actions">
          <div className="segmented" role="group" aria-label="Layout dos agentes">
            <button type="button" aria-pressed={layout === 'grade'} onClick={() => onLayout('grade')}>Grade</button>
            <button type="button" aria-pressed={layout === 'foco'} onClick={() => onLayout('foco')}>Foco</button>
          </div>
          {workspace && (
            <button className="btn btn--ghost btn--sm" aria-pressed={side === 'arquivos'} onClick={() => toggleSide('arquivos')} title="O que os agentes mudaram e os arquivos do workspace">
              <FolderIcon size={14} />Arquivos
            </button>
          )}
          <button className="btn btn--ghost btn--sm browser-toggle" aria-pressed={browserOpen} onClick={() => toggleSide('navegador')}
            title={page ? `Página aberta: ${page.title || page.url}` : 'Navegador da missão'}>
            <GlobeIcon size={14} />Navegador{page && !browserOpen && <span className="dot dot--live" aria-label="(página aberta)" />}
          </button>
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

      <div className="mission__body">
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
        {browserOpen && <BrowserPanel missionId={mission.id} archived={archived} onClose={() => setSide(null)} />}
        {side === 'arquivos' && workspace && <FilesPanel workspace={workspace} missionId={mission.id} onClose={() => setSide(null)} />}
      </div>

      {selected && selected.status !== 'exited' && (
        <form className="command" onSubmit={sendCommand}>
          <label htmlFor="command" className="command__label">Falar com #{selected.id}</label>
          <input
            id="command"
            ref={commandInput}
            value={command}
            onChange={(e) => {
              setCommand(e.target.value)
              dictated.current = e.target.value
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && dictation.listening) {
                e.preventDefault()
                dictation.stop()
              }
            }}
            placeholder={dictation.listening ? 'Ouvindo… fale; Esc ou o microfone para parar' : 'Escreva para o agente selecionado e tecle Enter'}
            autoComplete="off"
          />
          {dictationAvailable && (
            <button type="button" className={`icon-btn icon-btn--boxed mic${dictation.listening ? ' mic--on' : ''}`} aria-pressed={dictation.listening}
              aria-label={dictation.listening ? 'Parar o ditado' : 'Ditar'} title={dictation.listening ? 'Parar o ditado (Esc)' : 'Ditar para o agente'} onClick={toggleDictation}>
              <MicIcon />
            </button>
          )}
          <button type="submit" className="icon-btn icon-btn--boxed" aria-label="Enviar"><SendIcon /></button>
        </form>
      )}
      {dictation.error && (
        <div className="command__note" role="alert">
          <span>{dictation.error}</span>
          <button type="button" className="link-btn" onClick={dictation.dismissError}>Ok</button>
        </div>
      )}
    </main>
  )
}
