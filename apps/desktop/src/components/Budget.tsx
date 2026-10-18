import { useState } from 'react'
import { budgetStatus, type Mission } from '@orbit/protocol'
import { useOrbitClient } from '../orbit/context.tsx'
import { costText, tokensText } from '../orbit/labels.ts'
import { Dialog } from './Dialog.tsx'

/** Thousands of tokens and dollars as typed; empty = no limit. */
export function BudgetFields({ tokens, cost, onTokens, onCost, idPrefix }: { tokens: string; cost: string; onTokens: (v: string) => void; onCost: (v: string) => void; idPrefix: string }) {
  return (
    <div className="budget-fields">
      <label htmlFor={`${idPrefix}-tokens`}>Até</label>
      <input id={`${idPrefix}-tokens`} type="number" min={1} step={1} inputMode="numeric" value={tokens} placeholder="sem limite" onChange={(e) => onTokens(e.target.value)} />
      <span>mil tokens</span>
      <span className="muted">ou</span>
      <label htmlFor={`${idPrefix}-cost`}>US$</label>
      <input id={`${idPrefix}-cost`} type="number" min={0.01} step={0.01} inputMode="decimal" value={cost} placeholder="sem limite" onChange={(e) => onCost(e.target.value)} />
    </div>
  )
}

/** The fields' values as limits for the sidecar. */
export function budgetFrom(tokens: string, cost: string): { tokens: number | null; costUsd: number | null } | null {
  const t = Number(tokens)
  const c = Number(cost)
  const limits = { tokens: tokens.trim() && t > 0 ? Math.round(t * 1000) : null, costUsd: cost.trim() && c > 0 ? c : null }
  return limits.tokens === null && limits.costUsd === null ? null : limits
}

/** Share of the budget used (the larger of tokens and cost). */
export function budgetShare(mission: Mission): number {
  const b = mission.budget
  if (!b) return 0
  return budgetStatus(mission.usage,b).share ?? NaN
}

/** Header chip: how much of the budget the mission used; opens the editor. */
export function BudgetChip({ mission, onEdit }: { mission: Mission; onEdit: () => void }) {
  const b = mission.budget
  if (!b) return <button type="button" className="btn btn--ghost btn--sm" onClick={onEdit} title="Limitar tokens ou custo desta missão">Orçamento</button>
  const share = budgetShare(mission)
  const level = b.exceeded ? 'danger' : share >= 0.8 ? 'wait' : 'ok'
  const usd = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const coverage = budgetStatus(mission.usage,b)
  const text = b.tokens ? `${tokensText(mission.usage.total)} / ${tokensText(b.tokens)}` : coverage.cost !== 'reported' ? `Custo ${coverage.cost === 'partial' ? 'parcial' : 'indisponível'} / US$ ${usd(b.costUsd!)}` : `US$ ${usd(mission.usage.costUsd!)} / ${usd(b.costUsd!)}`
  return (
    <button type="button" className="budget-chip" data-level={level} onClick={onEdit} title={b.exceeded ? 'Orçamento esgotado: os agentes foram interrompidos. Clique para aumentar.' : 'Orçamento da missão'}>
      <span className="limit__bar" aria-hidden="true"><span style={{ width: `${Number.isFinite(share) ? Math.min(100, share * 100) : 0}%` }} /></span>
      {b.exceeded ? 'Orçamento esgotado' : text}
    </button>
  )
}

export function BudgetDialog({ mission, onClose }: { mission: Mission; onClose: () => void }) {
  const client = useOrbitClient()
  const [tokens, setTokens] = useState(mission.budget?.tokens ? String(mission.budget.tokens / 1000) : '')
  const [cost, setCost] = useState(mission.budget?.costUsd ? String(mission.budget.costUsd) : '')
  return (
    <Dialog eyebrow={mission.title} title="Orçamento da missão" submitLabel="Salvar" onClose={onClose} onSubmit={() => {
      const limits = budgetFrom(tokens, cost)
      client.send({ type: 'mission.budget', missionId: mission.id, tokens: limits?.tokens ?? null, costUsd: limits?.costUsd ?? null })
      onClose()
    }}>
      <p className="muted">Usado até agora: {tokensText(mission.usage.total)} tokens{costText(mission.usage.costUsd) ? ` · ${costText(mission.usage.costUsd)} (Claude)` : ''}.</p>
      <BudgetFields idPrefix="budget" tokens={tokens} cost={cost} onTokens={setTokens} onCost={setCost} />
      <p className="note">Aos 80% o Orbit avisa. Ao chegar no limite, interrompe os agentes da missão, recusa as próximas ferramentas do Claude e não abre novos agentes até você aumentar o orçamento. O custo só considera valores relatados. Custo ausente ou parcial não garante controle do teto em dólares; use também limite de tokens. O valor do Claude é uma estimativa de preço de API e pode diferir da cobrança. Deixe os dois em branco para tirar o limite.</p>
    </Dialog>
  )
}
