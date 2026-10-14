import { useState } from 'react'
import { TEMPLATE_LIMITS, type Mission, type Pane } from '@orbit/protocol'
import { useOrbit, useOrbitClient } from '../orbit/context.tsx'
import { CLI_LABEL, MODE_LABEL } from '../orbit/labels.ts'
import { Dialog } from './Dialog.tsx'

const RANK = { afazer: 0, fazendo: 1, feito: 2 } as const

/** Keeps a mission's setup, its lead and its board's cards to start another one like it. */
export function SaveTemplateDialog({ mission, lead, onClose }: { mission: Mission; lead: Pane | undefined; onClose: () => void }) {
  const client = useOrbitClient()
  const { cards: allCards, squads } = useOrbit()
  const cards = allCards.filter((c) => c.missionId === mission.id).sort((a, b) => RANK[a.column] - RANK[b.column] || a.order - b.order).map((c) => c.title)
  const [name, setName] = useState(mission.title)
  const [onlyHere, setOnlyHere] = useState(true)
  const [withCards, setWithCards] = useState(cards.length > 0)
  const [error, setError] = useState<string | null>(null)
  const squad = squads.find((s) => s.id === mission.squadId)
  const leadText = lead ? [CLI_LABEL[lead.cli], lead.model, lead.effort && `esforço ${lead.effort}`].filter(Boolean).join(' · ') : 'Claude'

  return (
    <Dialog eyebrow={mission.title} title="Salvar como modelo" submitLabel="Salvar modelo" onClose={onClose} onSubmit={() => {
      if (!name.trim()) return setError('Dê um nome ao modelo.')
      client.send({
        type: 'template.save',
        template: {
          name: name.trim(),
          workspaceId: onlyHere ? mission.workspaceId : null,
          title: mission.title,
          objective: mission.objective,
          mode: mission.mode,
          squadId: mission.squadId,
          isolation: mission.git ? 'worktrees' : null,
          lead: { cli: lead?.cli ?? 'claude', model: lead?.model ?? null, effort: lead?.effort ?? null },
          cards: withCards ? cards.slice(0, TEMPLATE_LIMITS.cards) : [],
        },
      })
      onClose()
    }}>
      <div className="field">
        <label htmlFor="tpl-name">Nome do modelo</label>
        <input id="tpl-name" value={name} maxLength={TEMPLATE_LIMITS.name} onChange={(e) => setName(e.target.value)} autoFocus />
      </div>
      <dl className="template-facts">
        <div><dt>Modo</dt><dd>{MODE_LABEL[mission.mode]}{squad ? ` · ${squad.name}` : ''}</dd></div>
        <div><dt>Líder</dt><dd>{leadText}</dd></div>
        <div><dt>Branch por agente</dt><dd>{mission.git ? 'sim' : 'não'}</dd></div>
        <div className="template-facts__wide"><dt>Objetivo</dt><dd>{mission.objective || 'sem objetivo'}</dd></div>
      </dl>
      {cards.length > 0 && (
        <label className="check">
          <input type="checkbox" checked={withCards} onChange={(e) => setWithCards(e.target.checked)} />
          <span>Começar o quadro com os {Math.min(cards.length, TEMPLATE_LIMITS.cards)} cartões desta missão</span>
        </label>
      )}
      <label className="check">
        <input type="checkbox" checked={onlyHere} onChange={(e) => setOnlyHere(e.target.checked)} />
        <span>Só neste workspace</span>
      </label>
      <p className="note">O título e o objetivo vêm preenchidos ao usar o modelo, e dá para mudar tudo antes de lançar.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
    </Dialog>
  )
}
