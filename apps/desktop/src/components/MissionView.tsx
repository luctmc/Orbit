import { useEffect, useRef, useState } from 'react'
import type { Mission, Pane } from '@orbit/protocol'
import { useOrbit, useOrbitClient } from '../orbit/context.tsx'
import { costText, MODE_LABEL, tokensText } from '../orbit/labels.ts'
import { BoardPanel } from './BoardPanel.tsx'
import { BrowserPanel } from './BrowserPanel.tsx'
import { FilesPanel } from './FilesPanel.tsx'
import { PrDialog } from './PrDialog.tsx'
import { SaveTemplateDialog } from './SaveTemplateDialog.tsx'
import { ReportDialog } from './ReportDialog.tsx'
import { BudgetChip, BudgetDialog } from './Budget.tsx'
import { LeadChangeDialog } from './dialogs.tsx'
import { DeleteMissionDialog } from './deletions.tsx'
import { ArchiveIcon, TrashIcon, BoardIcon, BookmarkIcon, BranchIcon, ReportIcon, FolderIcon, GlobeIcon, PlusIcon } from './icons.tsx'
import { MessageComposer } from './MessageComposer.tsx'
import { PaneView } from './PaneView.tsx'
import { OrbitCompanion } from './OrbitCompanion.tsx'
import { MissionProgress } from './MissionProgress.tsx'
import { useMissionProgress } from '../orbit/useMissionProgress.ts'
import { missionSignal } from '../orbit/missionStatus.ts'
import { inputSuggestions } from '../orbit/inputSuggestions.ts'
import { FlowTimeline } from './FlowTimeline.tsx'
import { ActionMenu } from './ActionMenu.tsx'

export type Layout = 'grade' | 'foco'
type Columns = 'auto' | '1' | '2' | '3'
const COLUMNS: Columns[] = ['auto', '1', '2', '3']

function rememberedColumns(): Columns {
  try {
    const saved = localStorage.getItem('orbit.columns') as Columns | null
    return saved && COLUMNS.includes(saved) ? saved : 'auto'
  } catch {
    return 'auto'
  }
}

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
  const progress = useMissionProgress(mission.id)
  const signal = missionSignal(mission, panes, progress.data, progress.connection, progress.error)
  const { squads, browsers, workspaces, cards, events } = useOrbit()
  const missionCards = cards.filter((c) => c.missionId === mission.id)
  const cardsDone = missionCards.filter((c) => c.column === 'feito').length
  const squad = squads.find((s) => s.id === mission.squadId)
  const workspace = workspaces.find((w) => w.id === mission.workspaceId)
  const page = browsers.find((b) => b.missionId === mission.id)
  /** One side panel at a time, next to the agents. */
  const [prOpen, setPrOpen] = useState(false)
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [budgetOpen, setBudgetOpen] = useState(false)
  const [leadOpen, setLeadOpen] = useState(false)
  const [deletingMission, setDeletingMission] = useState(false)
  type Side = 'atividades' | 'fluxo' | 'quadro' | 'arquivos' | 'navegador'
  const [side, setSide] = useState<Side | null>(null)
  const browserOpen = side === 'navegador'
  const toggleSide = (panel: Side) => setSide((open) => (open === panel ? null : panel))
  const commandInput = useRef<HTMLTextAreaElement>(null)
  const [columns, setColumns] = useState<Columns>(rememberedColumns)
  const [suggestionsOn, setSuggestionsOn] = useState(() => {
    try { return localStorage.getItem('orbit.inputSuggestions') !== 'false' } catch { return true }
  })
  const toggleSuggestions = () => {
    const next = !suggestionsOn
    setSuggestionsOn(next)
    try { localStorage.setItem('orbit.inputSuggestions', String(next)) } catch { /* private window */ }
  }
  useEffect(() => {
    try {
      localStorage.setItem('orbit.columns', columns)
    } catch {
      // private window
    }
  }, [columns])
  const archived = mission.status === 'archived'
  const selected = panes.find((p) => p.id === selectedPaneId) ?? panes[0] ?? null
  const visible = layout === 'foco' && selected ? [selected] : panes
  const leader = panes.find(p => p.role === 'lead')
  const suggestions = suggestionsOn && leader ? inputSuggestions({ mission, pane: leader, progress: progress.error ? null : progress.data, cards: missionCards, connected: progress.connection === 'open' }) : []

  // ⌘1–9 picks an agent, ⌘[ and ⌘] step through them, ⌘J writes to the selected one.
  const latest = useRef({ panes, selected, onSelectPane })
  latest.current = { panes, selected, onSelectPane }
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
      const { panes: list, selected: current, onSelectPane: select } = latest.current
      const at = current ? list.findIndex((p) => p.id === current.id) : -1
      let target: number | null = null
      if (/^[1-9]$/.test(event.key)) target = Number(event.key) - 1
      else if (event.key === '[') target = at <= 0 ? list.length - 1 : at - 1
      else if (event.key === ']') target = at >= list.length - 1 ? 0 : at + 1
      else if (event.key.toLowerCase() === 'j') {
        event.preventDefault()
        commandInput.current?.focus()
        return
      } else return
      const pane = list[target]
      if (!pane) return
      event.preventDefault()
      select(pane.id)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
  const alive = panes.filter((p) => p.status !== 'exited').length

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
          <ActionMenu label="Visualizar">
          <span className="eyebrow">Layout dos agentes</span>
          <div className="segmented" role="group" aria-label="Layout dos agentes">
            <button type="button" aria-pressed={layout === 'grade'} onClick={() => onLayout('grade')}>Grade</button>
            <button type="button" aria-pressed={layout === 'foco'} onClick={() => onLayout('foco')}>Foco</button>
          </div>
          {layout === 'grade' && panes.length > 1 && (
            <label className="columns" title="Colunas da grade">
              <span className="sr-only">Colunas</span>
              <select value={columns} onChange={(e) => setColumns(e.target.value as Columns)}>
                {COLUMNS.map((c) => <option key={c} value={c}>{c === 'auto' ? 'Colunas: auto' : `${c} ${c === '1' ? 'coluna' : 'colunas'}`}</option>)}
              </select>
            </label>
          )}
          <button type="button" aria-pressed={side === 'fluxo'} onClick={() => toggleSide('fluxo')}>Histórico</button>
          <button type="button" aria-pressed={side === 'quadro'} onClick={() => toggleSide('quadro')}><BoardIcon size={14} />Quadro{missionCards.length > 0 && <span> {cardsDone}/{missionCards.length}</span>}</button>
          <button type="button" aria-pressed={browserOpen} onClick={() => toggleSide('navegador')}><GlobeIcon size={14} />Navegador{page && !browserOpen && <span className="dot dot--live" aria-label="página aberta" />}</button>
          </ActionMenu>
          {mission.git && (
            <button className="btn btn--ghost btn--sm" onClick={() => setPrOpen(true)} title={`Branch ${mission.git.branch} (a partir de ${mission.git.base})`}>
              <BranchIcon size={14} />{mission.git.pr ? `PR #${mission.git.pr.number}` : 'Abrir PR'}
            </button>
          )}
          <button type="button" className="btn btn--ghost btn--sm" aria-pressed={side === 'atividades'} onClick={() => toggleSide('atividades')}>Atividades</button>
          {workspace && (
            <button className="btn btn--ghost btn--sm" aria-pressed={side === 'arquivos'} onClick={() => toggleSide('arquivos')} title="O que os agentes mudaram e os arquivos do workspace">
              <FolderIcon size={14} />Arquivos
            </button>
          )}
          {!archived && <BudgetChip mission={mission} onEdit={() => setBudgetOpen(true)} />}
          {!archived && <button className="btn btn--ghost btn--sm" onClick={onAddAgent}><PlusIcon size={14} />Agente</button>}
          <ActionMenu label="Missão">
          <span className="eyebrow">Gerenciar missão</span>
          {!archived && <button type="button" onClick={() => setLeadOpen(true)}>Trocar líder</button>}
          <button type="button" onClick={() => setReportOpen(true)}><ReportIcon />Relatório da missão</button>
          {!archived && (
            <>
              <button type="button" onClick={() => setSavingTemplate(true)}><BookmarkIcon />Salvar como modelo</button>
              <button type="button" onClick={() => {
                if (confirm('Arquivar a missão encerra todos os agentes dela. Continuar?')) client.send({ type: 'mission.archive', missionId: mission.id })
              }}><ArchiveIcon />Arquivar missão</button>
            </>
          )}
          <button type="button" className="menu__danger" onClick={() => setDeletingMission(true)}><TrashIcon />Apagar missão…</button>
          </ActionMenu>
        </div>
      </div>

      <section className="mission-signal" data-state={signal.state} aria-label="Próximo passo da missão">
        <OrbitCompanion state={signal.state} />
        <div className="mission-signal__text">
          <span className="eyebrow">Próximo passo</span>
          <strong role="status">{signal.title}</strong>
          <p>{signal.detail}</p>
          {progress.error && <p className="composer__error" role="alert">{progress.error}</p>}
        </div>
        <button type="button" className="btn btn--ghost btn--sm" disabled={progress.connection !== 'open' || progress.loading} onClick={progress.refresh}>{progress.loading ? 'Conferindo…' : 'Conferir agora'}</button>
      </section>

      <div className="mission__body">
        {panes.length === 0 ? (
          <div className="empty">
            <p>{archived ? 'Missão arquivada, sem agentes.' : 'Nenhum agente nesta missão.'}</p>
            {!archived && <button className="btn btn--primary" onClick={onAddAgent}><PlusIcon size={14} />Abrir um agente</button>}
          </div>
        ) : (
          <div className={`pane-grid pane-grid--${layout}${layout === 'grade' && columns !== 'auto' ? ` pane-grid--cols-${columns}` : ''}`}>
            {visible.map((p) => <PaneView key={p.id} pane={p} selected={p.id === selected?.id} onSelect={() => onSelectPane(p.id)} suggestions={p.role === 'lead' ? suggestions : []} suggestionsOn={suggestionsOn && p.role === 'lead' && ['claude', 'codex'].includes(p.cli)} />)}
          </div>
        )}
        {side === 'atividades' && <aside className="activity-panel" aria-label="Histórico das atividades">
          <div className="activity-panel__head"><h2>Trabalho da missão</h2><button type="button" className="btn btn--ghost btn--sm" onClick={() => setSide(null)}>Recolher</button></div>
          <MissionProgress progress={progress.data} panes={panes} onSelectPane={onSelectPane} />
        </aside>}
        {side === 'fluxo' && <FlowTimeline events={events.filter(e => e.missionId === mission.id)} />}
        {browserOpen && <BrowserPanel missionId={mission.id} archived={archived} onClose={() => setSide(null)} />}
        {side === 'quadro' && <BoardPanel missionId={mission.id} panes={panes} archived={archived} onClose={() => setSide(null)} />}
        {side === 'arquivos' && workspace && <FilesPanel workspace={workspace} missionId={mission.id} onClose={() => setSide(null)} />}
      </div>

      {!archived && panes.filter((p) => p.status !== 'exited').map((p) => <MessageComposer key={p.id} pane={p} active={p.id === selected?.id} inputRef={commandInput} suggestions={p.role === 'lead' ? suggestions : []} suggestionsOn={suggestionsOn} onToggleSuggestions={toggleSuggestions} />)}
      {budgetOpen && <BudgetDialog mission={mission} onClose={() => setBudgetOpen(false)} />}
      {leadOpen && <LeadChangeDialog mission={mission} onClose={() => setLeadOpen(false)} />}
      {deletingMission && <DeleteMissionDialog mission={mission} onClose={() => setDeletingMission(false)} />}
      {reportOpen && <ReportDialog mission={mission} onClose={() => setReportOpen(false)} />}
      {savingTemplate && <SaveTemplateDialog mission={mission} lead={panes.find((p) => p.role === 'lead')} onClose={() => setSavingTemplate(false)} />}
      {prOpen && mission.git && <PrDialog mission={mission} onClose={() => setPrOpen(false)} />}
    </main>
  )
}
