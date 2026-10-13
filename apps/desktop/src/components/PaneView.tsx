import type { Pane } from '@orbit/protocol'
import { useOrbitClient } from '../orbit/context.tsx'
import { CLI_LABEL, costText, EFFORT_LABEL, pathText, STATUS, tokensText } from '../orbit/labels.ts'
import { CloseIcon } from './icons.tsx'
import { Terminal } from './Terminal.tsx'

export function PaneView({ pane, selected, onSelect }: { pane: Pane; selected: boolean; onSelect: () => void }) {
  const client = useOrbitClient()
  const status = STATUS[pane.status]
  const alive = pane.status !== 'exited'

  return (
    <section className={`pane${selected ? ' pane--selected' : ''}${pane.status === 'waiting' ? ' pane--waiting' : ''}`} aria-label={`Agente ${pane.id}: ${pane.title}`}>
      <header className="pane__head">
        <span className={`dot dot--${status.tone}`} title={status.label} />
        <span className={`role role--${pane.role}`}>{pane.role === 'lead' ? 'Líder' : pane.squadRole ?? pane.taskType ?? 'Ajudante'}</span>
        <span className="pane__id">#{pane.id}</span>
        <button type="button" className="pane__title" onClick={onSelect}>{pane.title}</button>
        {pane.deliveredAt !== null && <span className="chip chip--done">entregue</span>}
        <span className="chip">{[CLI_LABEL[pane.cli], pane.model, pane.effort && `esforço ${EFFORT_LABEL[pane.effort]}`].filter(Boolean).join(' · ')}</span>
        <button type="button" className="icon-btn" aria-label={alive ? `Encerrar agente ${pane.id}` : `Fechar agente ${pane.id}`} onClick={() => client.send({ type: 'pane.close', paneId: pane.id })}>
          <CloseIcon size={14} />
        </button>
      </header>
      <div className="pane__body">
        <Terminal paneId={pane.id} interactive={alive} onFocus={onSelect} />
      </div>
      {pane.status === 'waiting' && (
        <div className="attention" role="status">
          <span className="attention__text">Precisa de você: {pane.attention ?? 'o agente está esperando'}</span>
          <button type="button" className="btn btn--sm btn--attention" onClick={onSelect}>Responder no terminal</button>
        </div>
      )}
      <footer className="pane__foot">
        <span className={`tone--${status.tone}`}>{status.label}</span>
        <span aria-hidden="true">·</span>
        <span className="pane__cwd" title={pane.cwd}>{pathText(pane.cwd)}</span>
        {pane.exitCode !== null && <><span aria-hidden="true">·</span><span>código {pane.exitCode}</span></>}
        <PaneUsage pane={pane} />
      </footer>
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
