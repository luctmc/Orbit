import { useCallback, useEffect, useRef, useState } from 'react'
import type { Pane, PaneHandoff } from '@orbit/protocol'
import { useOrbit, useOrbitClient } from '../orbit/context.tsx'
import { CLI_LABEL, costText, EFFORT_LABEL, pathText, STATUS, tokensText } from '../orbit/labels.ts'
import { CloseIcon, MoreIcon, OrbitMark } from './icons.tsx'
import { Conversation } from './Conversation.tsx'
import { Terminal } from './LazyTerminal.tsx'
import { DeleteAgentDialog } from './deletions.tsx'
import type { InputSuggestion } from '../orbit/inputSuggestions.ts'
import { terminalPredictionReady } from '../orbit/terminalPrediction.ts'

/** What a helper's last handoff said. */
const HANDOFF_CHIP: Record<PaneHandoff, { label: string; tone: string; title: string }> = {
  done: { label: 'entregue', tone: 'chip--done', title: 'Entregou o retorno, com evidência' },
  blocked: { label: 'bloqueado', tone: 'chip--warn', title: 'Entregou dizendo que travou; espera resposta' },
  progress: { label: 'em andamento', tone: '', title: 'Mandou um aviso de progresso e segue trabalhando' },
  auto: { label: 'entregue pelo Orbit', tone: 'chip--done', title: 'Encerrou o turno sem entregar; o Orbit mandou a última mensagem dele' },
}

/** The agent's ⋯ menu: rename, resume or reopen, duplicate, copy its number, close. */
function PaneMenu({ pane, onRename, onDelete, onClose }: { pane: Pane; onRename: () => void; onDelete: () => void; onClose: () => void }) {
  const client = useOrbitClient()
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) onClose() }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    box.current?.querySelector('button')?.focus()
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [onClose])
  const act = (fn: () => void) => () => { fn(); onClose() }
  const alive = pane.status !== 'exited'
  const canResume = pane.cli !== 'shell' && pane.sessionId !== null
  return (
    <div ref={box} className="menu" role="menu" aria-label={`Ações de #${pane.id}`} onKeyDown={event => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
      const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (at + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
      buttons[next]?.focus()
    }}>
      <button type="button" role="menuitem" onClick={act(onRename)}>Renomear</button>
      {canResume && <button type="button" role="menuitem" onClick={act(() => client.send({ type: 'pane.restart', paneId: pane.id, resume: true }))}>{alive ? 'Reiniciar na mesma conversa' : 'Retomar conversa'}</button>}
      {pane.cli !== 'shell' && <button type="button" role="menuitem" onClick={act(() => client.send({ type: 'pane.restart', paneId: pane.id, resume: false }))}>{alive ? 'Reiniciar em conversa nova' : 'Reabrir em conversa nova'}</button>}
      <button type="button" role="menuitem" onClick={act(() => client.send({ type: 'pane.duplicate', paneId: pane.id }))}>Duplicar</button>
      <button type="button" role="menuitem" onClick={act(() => void navigator.clipboard?.writeText(`#${pane.id}`))}>Copiar o número (#{pane.id})</button>
      <hr />
      <button type="button" role="menuitem" className="menu__danger" onClick={act(() => client.send({ type: 'pane.close', paneId: pane.id }))}>{alive ? 'Encerrar' : 'Fechar'}</button>
      <button type="button" role="menuitem" className="menu__danger" onClick={act(onDelete)}>Apagar para sempre…</button>
    </div>
  )
}

/** The title, editable in place (double-click or Renomear). */
function PaneTitle({ pane, editing, onEditing, onSelect }: { pane: Pane; editing: boolean; onEditing: (on: boolean) => void; onSelect: () => void }) {
  const client = useOrbitClient()
  const [draft, setDraft] = useState(pane.title)
  useEffect(() => { if (editing) setDraft(pane.title) }, [editing, pane.title])
  if (!editing) {
    return <button type="button" className="pane__title" onClick={onSelect} onDoubleClick={() => onEditing(true)} title="Clique duas vezes para renomear">{pane.title}</button>
  }
  const save = () => {
    const title = draft.trim()
    if (title && title !== pane.title) client.send({ type: 'pane.rename', paneId: pane.id, title })
    onEditing(false)
  }
  return (
    <input className="pane__title-input" value={draft} maxLength={120} autoFocus aria-label={`Novo nome de #${pane.id}`} onChange={(e) => setDraft(e.target.value)} onBlur={save}
      onKeyDown={(e) => { if (e.key === 'Enter') save(); else if (e.key === 'Escape') onEditing(false) }} />
  )
}

export function PaneView({ pane, selected, onSelect, suggestions = [], suggestionsOn = false }: { pane: Pane; selected: boolean; onSelect: () => void; suggestions?: InputSuggestion[]; suggestionsOn?: boolean }) {
  const client = useOrbitClient()
  const account = useOrbit().accounts.find((a) => a.id === pane.accountId)
  const status = STATUS[pane.status]
  const alive = pane.status !== 'exited'
  const [chat, setChat] = useState(pane.role === 'lead' && pane.cli !== 'shell')
  const [menu, setMenu] = useState(false)
  const menuButton = useRef<HTMLButtonElement>(null)
  const closeMenu = useCallback(() => { setMenu(false); menuButton.current?.focus() }, [])
  const [renaming, setRenaming] = useState(false)
  const [deleting, setDeleting] = useState(false)

  return (
    <section className={`pane${selected ? ' pane--selected' : ''}${pane.status === 'waiting' ? ' pane--waiting' : ''}`} aria-label={`Agente ${pane.id}: ${pane.title}. ${CLI_LABEL[pane.cli]}${pane.model ? `, ${pane.model}` : ''}${pane.effort ? `, esforço ${EFFORT_LABEL[pane.effort]}` : ''}`}>
      <header className="pane__head">
        {chat ? <span className="conversation__avatar"><OrbitMark size={22} /></span> : <span className={`dot dot--${status.tone}`} title={status.label} />}
        <span className={`role role--${pane.role}`}>{pane.role === 'lead' ? 'Líder' : pane.squadRole ?? pane.taskType ?? 'Ajudante'}</span>
        <span className="pane__id">#{pane.id}</span>
        <PaneTitle pane={pane} editing={renaming} onEditing={setRenaming} onSelect={onSelect} />
        {pane.handoffStatus && <span className={`chip ${HANDOFF_CHIP[pane.handoffStatus].tone}`} title={HANDOFF_CHIP[pane.handoffStatus].title}>{HANDOFF_CHIP[pane.handoffStatus].label}</span>}
        <span className="chip">{[CLI_LABEL[pane.cli], account && !account.builtin && account.name, pane.model, pane.effort && `esforço ${EFFORT_LABEL[pane.effort]}`].filter(Boolean).join(' · ')}</span>
        {pane.cli !== 'shell' && <button type="button" className="btn btn--ghost btn--sm pane__view-toggle" onClick={() => setChat((open) => !open)}>{chat ? 'Terminal' : 'Conversa'}</button>}
        <div className="menu-anchor">
          <button ref={menuButton} type="button" className="icon-btn" aria-label={`Ações de #${pane.id}`} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((open) => !open)}>
            <MoreIcon size={15} />
          </button>
          {menu && <PaneMenu pane={pane} onRename={() => setRenaming(true)} onDelete={() => setDeleting(true)} onClose={closeMenu} />}
        </div>
        <button type="button" className="icon-btn" aria-label={alive ? `Encerrar agente ${pane.id}` : `Fechar agente ${pane.id}`} onClick={() => client.send({ type: 'pane.close', paneId: pane.id })}>
          <CloseIcon size={14} />
        </button>
      </header>
      <div className="pane__body">
        {chat ? <Conversation key={pane.id} pane={pane} onTerminal={() => setChat(false)} /> : <Terminal paneId={pane.id} interactive={alive} onFocus={onSelect} suggestions={suggestions} predictionEnabled={suggestionsOn} predictionReady={terminalPredictionReady(pane.status)} executionEpoch={pane.executionEpoch} />}
      </div>
      {!alive && pane.cli !== 'shell' && (
        <div className="ended" role="status">
          <span className="ended__text">{pane.sessionId ? 'O agente encerrou. A conversa continua salva na CLI.' : 'O agente encerrou.'}</span>
          {pane.sessionId && <button type="button" className="btn btn--sm btn--primary" onClick={() => client.send({ type: 'pane.restart', paneId: pane.id, resume: true })}>Retomar conversa</button>}
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => client.send({ type: 'pane.restart', paneId: pane.id, resume: false })}>Conversa nova</button>
        </div>
      )}
      {pane.status === 'waiting' && (
        <div className="attention" role="status">
          <span className="attention__text">Precisa de você: {pane.attention ?? 'o agente está esperando'}</span>
          {pane.choices?.map((choice) => (
            <button key={choice} type="button" className="btn btn--sm btn--ghost" onClick={() => client.send({ type: 'pane.submit', paneId: pane.id, text: choice })}>{choice}</button>
          ))}
          <button type="button" className="btn btn--sm btn--attention" onClick={onSelect}>{pane.choices ? 'Outra resposta' : 'Responder no terminal'}</button>
        </div>
      )}
      {(!chat || pane.usage || pane.contextPercent !== null) && <footer className="pane__foot">
        <span className={`tone--${status.tone}`}>{status.label}</span>
        <span aria-hidden="true">·</span>
        <span className="pane__cwd" title={pane.cwd}>{pathText(pane.cwd)}</span>
        {pane.exitCode !== null && <><span aria-hidden="true">·</span><span>código {pane.exitCode}</span></>}
        <PaneUsage pane={pane} />
      </footer>}
      {deleting && <DeleteAgentDialog pane={pane} onClose={() => setDeleting(false)} />}
    </section>
  )
}

/** Tokens this agent's session used, how full its context is and Claude's API-equivalent cost. */
function PaneUsage({ pane }: { pane: Pane }) {
  if (!pane.usage && pane.contextPercent === null) return null
  const cost = costText(pane.usage?.costUsd ?? null)
  const detail = pane.usage
    ? [
        `Entrada ${pane.usage.input.toLocaleString('pt-BR')}`,
        `saída ${pane.usage.output.toLocaleString('pt-BR')}`,
        pane.usage.cacheRead > 0 && `em cache ${pane.usage.cacheRead.toLocaleString('pt-BR')}`,
        cost && `${cost} em preço de API`,
      ].filter(Boolean).join(' · ')
    : undefined
  return (
    <span className="pane__usage" title={detail}>
      {pane.usage && <span>{tokensText(pane.usage.total)} tokens</span>}
      {pane.contextPercent !== null && (
        <span className="pane__context" data-level={pane.contextPercent >= 80 ? 'wait' : 'ok'}>
          <span className="limit__bar" aria-hidden="true"><span style={{ width: `${Math.min(100, pane.contextPercent)}%` }} /></span>
          contexto {pane.contextPercent}%
        </span>
      )}
    </span>
  )
}
