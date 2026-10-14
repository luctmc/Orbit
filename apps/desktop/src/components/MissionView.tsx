import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { Mission, Pane } from '@orbit/protocol'
import { useOrbit, useOrbitClient } from '../orbit/context.tsx'
import { dictationAvailable, joinText, useDictation } from '../orbit/dictation.ts'
import { costText, MODE_LABEL, tokensText } from '../orbit/labels.ts'
import { BoardPanel } from './BoardPanel.tsx'
import { BrowserPanel } from './BrowserPanel.tsx'
import { FilesPanel } from './FilesPanel.tsx'
import { PrDialog } from './PrDialog.tsx'
import { SaveTemplateDialog } from './SaveTemplateDialog.tsx'
import { ReportDialog } from './ReportDialog.tsx'
import { BudgetChip, BudgetDialog } from './Budget.tsx'
import { LeadChangeDialog } from './dialogs.tsx'
import { ArchiveIcon, BoardIcon, BookmarkIcon, BranchIcon, ReportIcon, FolderIcon, GlobeIcon, MicIcon, PlusIcon, SendIcon } from './icons.tsx'
import { PaneView } from './PaneView.tsx'

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
  const { squads, browsers, workspaces, cards } = useOrbit()
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
  type Side = 'quadro' | 'arquivos' | 'navegador'
  const [side, setSide] = useState<Side | null>(null)
  const browserOpen = side === 'navegador'
  const toggleSide = (panel: Side) => setSide((open) => (open === panel ? null : panel))
  const [command, setCommand] = useState('')
  const commandInput = useRef<HTMLInputElement>(null)
  const [columns, setColumns] = useState<Columns>(rememberedColumns)
  useEffect(() => {
    try {
      localStorage.setItem('orbit.columns', columns)
    } catch {
      // private window
    }
  }, [columns])
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
            {mission.readyAt && <span className="badge badge--ready" title={mission.readySummary ?? undefined}>Pronta</span>}
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
          {layout === 'grade' && panes.length > 1 && (
            <label className="columns" title="Colunas da grade">
              <span className="sr-only">Colunas</span>
              <select value={columns} onChange={(e) => setColumns(e.target.value as Columns)}>
                {COLUMNS.map((c) => <option key={c} value={c}>{c === 'auto' ? 'Colunas: auto' : `${c} ${c === '1' ? 'coluna' : 'colunas'}`}</option>)}
              </select>
            </label>
          )}
          {mission.git && (
            <button className="btn btn--ghost btn--sm" onClick={() => setPrOpen(true)} title={`Branch ${mission.git.branch} (a partir de ${mission.git.base})`}>
              <BranchIcon size={14} />{mission.git.pr ? `PR #${mission.git.pr.number}` : 'Abrir PR'}
            </button>
          )}
          <button className="btn btn--ghost btn--sm" aria-pressed={side === 'quadro'} onClick={() => toggleSide('quadro')} title="O que está planejado, em andamento e feito">
            <BoardIcon size={14} />Quadro{missionCards.length > 0 && <span className="muted"> {cardsDone}/{missionCards.length}</span>}
          </button>
          {workspace && (
            <button className="btn btn--ghost btn--sm" aria-pressed={side === 'arquivos'} onClick={() => toggleSide('arquivos')} title="O que os agentes mudaram e os arquivos do workspace">
              <FolderIcon size={14} />Arquivos
            </button>
          )}
          <button className="btn btn--ghost btn--sm browser-toggle" aria-pressed={browserOpen} onClick={() => toggleSide('navegador')}
            title={page ? `Página aberta: ${page.title || page.url}` : 'Navegador da missão'}>
            <GlobeIcon size={14} />Navegador{page && !browserOpen && <span className="dot dot--live" aria-label="(página aberta)" />}
          </button>
          {!archived && <BudgetChip mission={mission} onEdit={() => setBudgetOpen(true)} />}
          {!archived && <button type="button" className="btn btn--ghost btn--sm" onClick={() => setLeadOpen(true)} title="Passar a liderança para outro agente, sem perder o contexto">Trocar líder</button>}
          <button className="icon-btn" aria-label="Relatório da missão" title="Relatório da missão" onClick={() => setReportOpen(true)}><ReportIcon /></button>
          {!archived && (
            <>
              <button className="btn btn--ghost btn--sm" onClick={onAddAgent}><PlusIcon size={14} />Agente</button>
              <button className="icon-btn" aria-label="Salvar como modelo" title="Salvar como modelo" onClick={() => setSavingTemplate(true)}><BookmarkIcon /></button>
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
          <div className={`pane-grid pane-grid--${layout}${layout === 'grade' && columns !== 'auto' ? ` pane-grid--cols-${columns}` : ''}`}>
            {visible.map((p) => <PaneView key={p.id} pane={p} selected={p.id === selected?.id} onSelect={() => onSelectPane(p.id)} />)}
          </div>
        )}
        {browserOpen && <BrowserPanel missionId={mission.id} archived={archived} onClose={() => setSide(null)} />}
        {side === 'quadro' && <BoardPanel missionId={mission.id} panes={panes} archived={archived} onClose={() => setSide(null)} />}
        {side === 'arquivos' && workspace && <FilesPanel workspace={workspace} missionId={mission.id} onClose={() => setSide(null)} />}
      </div>

      {selected && selected.status !== 'exited' && (
        <form className="command" onSubmit={sendCommand}>
          <label htmlFor="command" className="command__label" title="⌘J escreve aqui · ⌘1–9 troca de agente · ⌘[ ⌘] anterior e próximo">Falar com #{selected.id}</label>
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
      {budgetOpen && <BudgetDialog mission={mission} onClose={() => setBudgetOpen(false)} />}
      {leadOpen && <LeadChangeDialog mission={mission} onClose={() => setLeadOpen(false)} />}
      {reportOpen && <ReportDialog mission={mission} onClose={() => setReportOpen(false)} />}
      {savingTemplate && <SaveTemplateDialog mission={mission} lead={panes.find((p) => p.role === 'lead')} onClose={() => setSavingTemplate(false)} />}
      {prOpen && mission.git && <PrDialog mission={mission} onClose={() => setPrOpen(false)} />}
      {dictation.error && (
        <div className="command__note" role="alert">
          <span>{dictation.error}</span>
          <button type="button" className="link-btn" onClick={dictation.dismissError}>Ok</button>
        </div>
      )}
    </main>
  )
}
