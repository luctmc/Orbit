import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { Pane, PaneHandoff } from '@orbit/protocol'
import { useOrbit, useOrbitClient } from '../orbit/context.tsx'
import { CLI_LABEL, costText, EFFORT_LABEL, pathText, STATUS, tokensText } from '../orbit/labels.ts'
import { CloseIcon, MoreIcon } from './icons.tsx'
import { providerIdentity } from '../orbit/providerIdentity.ts'
import { ProviderMark } from './ProviderMark.tsx'
import { TerminalHistoryDialog } from './TerminalHistoryDialog.tsx'
import { ExecutionConfig } from './ExecutionConfig.tsx'
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
function PaneMenu({ pane, onRename, onDelete, onClose, onSelect, onToggleView, onHistory, chat, anchor }: { onHistory:()=>void; anchor: RefObject<HTMLButtonElement | null>; onSelect: () => void; onToggleView: () => void; chat: boolean; pane: Pane; onRename: () => void; onDelete: () => void; onClose: () => void }) {
  const client = useOrbitClient()
  const account = useOrbit().accounts.find(a => a.id === pane.accountId)
  const identity = providerIdentity(pane, account)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) onClose() }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('resize', onClose)
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    box.current?.querySelector('button')?.focus()
    return () => {
      window.removeEventListener('resize', onClose)
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [onClose])
  const act = (fn: () => void) => () => { fn(); onClose() }
  const alive = pane.status !== 'exited'
  const canResume = pane.cli !== 'shell' && pane.sessionId !== null
  const rect = anchor.current?.getBoundingClientRect()
  const top = Math.max(8, Math.min((rect?.bottom ?? 48) + 4, window.innerHeight - Math.min(520, window.innerHeight * .65) - 8))
  return createPortal(
    <div ref={box} className="menu pane-menu" style={{ position: 'fixed', top, right: Math.max(8, window.innerWidth - (rect?.right ?? window.innerWidth - 8)) }} role="menu" aria-label={`Ações de #${pane.id}`} onKeyDown={event => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
      const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (at + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
      buttons[next]?.focus()
    }}>
      <div className="pane__details">
        <strong>{identity.provider}</strong>
        <span>{identity.model}</span>
        <span>{[account?.name, pane.effort && `esforço ${EFFORT_LABEL[pane.effort]}`].filter(Boolean).join(' · ')}</span>
        <span title={pane.cwd}>{pathText(pane.cwd)}</span>
        {pane.exitCode !== null && <span>código {pane.exitCode}</span>}
        <PaneUsage pane={pane} />
        <ExecutionConfig pane={pane} />
      </div>
      {pane.status === 'waiting' && <>
        <p className="pane__request">{pane.attention ?? 'O agente está esperando sua resposta.'}</p>
        {pane.choices?.map(choice => <button key={choice} type="button" role="menuitem" onClick={act(() => client.send({ type: 'pane.submit', paneId: pane.id, text: choice }))}>{choice}</button>)}
        <button type="button" role="menuitem" onClick={act(onSelect)}>Responder no terminal</button>
        <hr />
      </>}
      {pane.cli !== 'shell' && <button type="button" role="menuitem" onClick={act(onToggleView)}>{chat ? 'Ver terminal' : 'Ver conversa'}</button>}
      <button type="button" role="menuitem" onClick={act(onHistory)}>Histórico das execuções…</button>
      <button type="button" role="menuitem" onClick={act(onRename)}>Renomear</button>
      {canResume && <button type="button" role="menuitem" onClick={act(() => client.send({ type: 'pane.restart', paneId: pane.id, resume: true }))}>{alive ? 'Reiniciar na mesma conversa' : 'Retomar conversa'}</button>}
      {pane.cli !== 'shell' && <button type="button" role="menuitem" onClick={act(() => client.send({ type: 'pane.restart', paneId: pane.id, resume: false }))}>{alive ? 'Reiniciar em conversa nova' : 'Reabrir em conversa nova'}</button>}
      <button type="button" role="menuitem" onClick={act(() => client.send({ type: 'pane.duplicate', paneId: pane.id }))}>Duplicar</button>
      <button type="button" role="menuitem" onClick={act(() => void navigator.clipboard?.writeText(`#${pane.id}`))}>Copiar o número (#{pane.id})</button>
      <hr />
      <button type="button" role="menuitem" className="menu__danger" onClick={act(() => client.send({ type: 'pane.close', paneId: pane.id }))}>{alive ? 'Encerrar' : 'Fechar'}</button>
      <button type="button" role="menuitem" className="menu__danger" onClick={act(onDelete)}>Apagar para sempre…</button>
    </div>, document.body
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
  const identity = providerIdentity(pane, account)
  const status = STATUS[pane.status]
  const alive = pane.status !== 'exited'
  const paneRef = useRef<HTMLElement>(null)
  const [chat, setChat] = useState(() => { try { return localStorage.getItem(`orbit.paneView.${pane.id}`) === 'chat' } catch { return false } })
  useEffect(() => { try { localStorage.setItem(`orbit.paneView.${pane.id}`, chat ? 'chat' : 'terminal') } catch { /* storage unavailable */ } }, [pane.id, chat])
  const [menu, setMenu] = useState(false)
  const menuButton = useRef<HTMLButtonElement>(null)
  const closeMenu = useCallback(() => { setMenu(false); menuButton.current?.focus() }, [])
  const [renaming, setRenaming] = useState(false)
  const [historyOpen,setHistoryOpen]=useState(false)
  const [deleting, setDeleting] = useState(false)

  return (
    <section ref={paneRef} className={`pane${selected ? ' pane--selected' : ''}${pane.status === 'waiting' ? ' pane--waiting' : ''}`} aria-label={`Agente ${pane.id}: ${pane.title}. ${CLI_LABEL[pane.cli]}${pane.model ? `, ${pane.model}` : ''}${pane.effort ? `, esforço ${EFFORT_LABEL[pane.effort]}` : ''}`}>
      <header className="pane__head">
        <ProviderMark brand={identity.brand} />
        <span className={`role role--${pane.role}`}>{pane.role === 'lead' ? 'Líder' : pane.squadRole ?? pane.taskType ?? 'Ajudante'}</span>
        <span className="pane__id">#{pane.id}</span>
        <PaneTitle pane={pane} editing={renaming} onEditing={setRenaming} onSelect={onSelect} />
        {pane.handoffStatus && <span className={`chip ${HANDOFF_CHIP[pane.handoffStatus].tone}`} title={HANDOFF_CHIP[pane.handoffStatus].title}>{HANDOFF_CHIP[pane.handoffStatus].label}</span>}
        <span className="pane__session" title={[identity.provider, identity.model, account?.name, pane.effort && `esforço ${EFFORT_LABEL[pane.effort]}`].filter(Boolean).join(' · ')}>{pane.model ?? CLI_LABEL[pane.cli]}{pane.effort ? ` · ${EFFORT_LABEL[pane.effort]}` : ''}</span>
        <button type="button" className={`pane__state tone--${status.tone}`} aria-label={`Estado de #${pane.id}: ${status.label}. Ver detalhes`} onClick={() => setMenu(!menu)} aria-expanded={menu}><span className={`dot dot--${status.tone}`} />{status.label}</button>
        <div className="menu-anchor">
          <button ref={menuButton} type="button" className="icon-btn" aria-label={`Ações de #${pane.id}`} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
            <MoreIcon size={15} />
          </button>
          {menu && <PaneMenu onHistory={()=>setHistoryOpen(true)} pane={pane} onRename={() => setRenaming(true)} onDelete={() => setDeleting(true)} onClose={closeMenu} onSelect={() => { setChat(false); onSelect(); requestAnimationFrame(() => paneRef.current?.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea')?.focus()) }} onToggleView={() => setChat(open => !open)} chat={chat} anchor={menuButton} />}
        </div>
        <button type="button" className="icon-btn" aria-label={alive ? `Encerrar agente ${pane.id}` : `Fechar agente ${pane.id}`} onClick={() => client.send({ type: 'pane.close', paneId: pane.id })}>
          <CloseIcon size={14} />
        </button>
      </header>
      <div className="pane__body">
        {chat && <Conversation key={pane.id} pane={pane} onTerminal={() => setChat(false)} />}
        <div className="pane__terminal" hidden={chat}><Terminal key={pane.executionEpoch ?? pane.id} paneId={pane.id} interactive={alive} onFocus={onSelect} suggestions={suggestions} predictionEnabled={suggestionsOn} predictionReady={terminalPredictionReady(pane.status)} executionEpoch={pane.executionEpoch} /></div>
      </div>
      {!alive && pane.cli !== 'shell' && (
        <div className="ended" role="status">
          <span className="ended__text">{pane.sessionId ? 'O agente encerrou. A conversa continua salva na CLI.' : 'O agente encerrou.'}</span>
          {pane.sessionId && <button type="button" className="btn btn--sm btn--primary" onClick={() => client.send({ type: 'pane.restart', paneId: pane.id, resume: true })}>Retomar conversa</button>}
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => client.send({ type: 'pane.restart', paneId: pane.id, resume: false })}>Conversa nova</button>
        </div>
      )}
      {historyOpen && <TerminalHistoryDialog pane={pane} onClose={()=>setHistoryOpen(false)} />}
      {deleting && <DeleteAgentDialog pane={pane} onClose={() => setDeleting(false)} />}
    </section>
  )
}

/** Tokens this agent's session used, how full its context is and Claude's API-equivalent cost. */
function PaneUsage({ pane }: { pane: Pane }) {
  const context = pane.contextUsage
  const contextTitle = context ? `${context.kind === 'measured' ? 'Medido' : context.kind === 'estimated' ? 'Estimado' : 'Indisponível'} · ${context.source} · ${new Date(context.observedAt).toLocaleTimeString('pt-BR')}${context.capacityTokens ? ` · capacidade ${context.capacityTokens.toLocaleString('pt-BR')} tokens` : ''}` : 'Contexto não informado'
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
      {pane.usage && <span>{tokensText(pane.usage.total)} tokens acumulados</span>}
      {pane.contextPercent !== null ? (
        <span className="pane__context" title={contextTitle} data-level={pane.contextPercent >= 80 ? 'wait' : 'ok'}>
          <span className="limit__bar" aria-hidden="true"><span style={{ width: `${Math.min(100, pane.contextPercent)}%` }} /></span>
          contexto {context?.kind === 'estimated' ? '≈ ' : ''}{pane.contextPercent}%{context?.usedTokens !== null && context?.usedTokens !== undefined && context.capacityTokens ? ` · ${tokensText(context.usedTokens)} / ${tokensText(context.capacityTokens)}` : ''}
        </span>
      ) : <span title={contextTitle}>contexto indisponível</span>}
      {pane.usage?.costUsd === null && <span>custo indisponível</span>}
    </span>
  )
}
