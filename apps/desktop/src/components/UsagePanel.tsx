import { useEffect, useMemo, useState } from 'react'
import { AGENT_CLIS, type UsageEntry } from '@orbit/protocol'
import { useOrbit, useOrbitClient } from '../orbit/context.tsx'
import { accountLabel, CLI_LABEL, costText, tokensText } from '../orbit/labels.ts'
import { budgetShare } from './Budget.tsx'

type GroupBy = 'missao' | 'workspace' | 'modelo' | 'conta'
const GROUPS: Array<[GroupBy, string]> = [['missao', 'Missão'], ['workspace', 'Workspace'], ['modelo', 'CLI e modelo'], ['conta', 'Conta']]

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
const shiftMonth = (month: string, by: number) => {
  const [y, m] = month.split('-').map(Number) as [number, number]
  return monthKey(new Date(y, m - 1 + by, 1))
}
const monthName = (month: string) => {
  const [y, m] = month.split('-').map(Number) as [number, number]
  const name = new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  return name.charAt(0).toUpperCase() + name.slice(1)
}

/** Settings › Uso: where the tokens of a month went, by mission, workspace, model or account. */
export function UsagePanel() {
  const client = useOrbitClient()
  const { missions, workspaces, accounts } = useOrbit()
  const [month, setMonth] = useState(() => monthKey(new Date()))
  const [entries, setEntries] = useState<UsageEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [groupBy, setGroupBy] = useState<GroupBy>('missao')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let current = true
    setEntries(null)
    setError(null)
    client.ask({ type: 'ledger.get', month }, 'ledger', (m) => m.month === month)
      .then((m) => current && setEntries(m.entries), (e: Error) => current && setError(e.message))
    return () => {
      current = false
    }
  }, [client, month])

  const label = useMemo(() => ({
    missao: (e: UsageEntry) => missions.find((m) => m.id === e.missionId)?.title ?? 'missão apagada',
    workspace: (e: UsageEntry) => workspaces.find((w) => w.id === e.workspaceId)?.name ?? 'workspace removido',
    modelo: (e: UsageEntry) => `${CLI_LABEL[e.cli]} · ${e.model ?? 'modelo padrão'}`,
    conta: (e: UsageEntry) => accountLabel(accounts.find((a) => a.id === e.accountId), e.cli),
  }), [missions, workspaces, accounts])

  const list = entries ?? []
  const total = list.reduce((sum, e) => sum + e.tokens, 0)
  const cost = list.reduce((sum, e) => sum + e.costUsd, 0)
  const groups = [...list.reduce((map, e) => {
    const key = label[groupBy](e)
    const g = map.get(key) ?? { name: key, tokens: 0, costUsd: 0 }
    g.tokens += e.tokens
    g.costUsd += e.costUsd
    return map.set(key, g)
  }, new Map<string, { name: string; tokens: number; costUsd: number }>()).values()].sort((a, b) => b.tokens - a.tokens)

  // One bar per day of the month, the CLIs stacked.
  const [y, m] = month.split('-').map(Number) as [number, number]
  const days = new Date(y, m, 0).getDate()
  const used = AGENT_CLIS.filter((cli) => list.some((e) => e.cli === cli))
  const perDay = Array.from({ length: days }, (_, i) => {
    const day = `${month}-${String(i + 1).padStart(2, '0')}`
    return { day: i + 1, by: used.map((cli) => ({ cli, tokens: list.filter((e) => e.day === day && e.cli === cli).reduce((s, e) => s + e.tokens, 0) })) }
  })
  const peak = Math.max(1, ...perDay.map((d) => d.by.reduce((s, x) => s + x.tokens, 0)))

  const budgets = missions.filter((x) => x.status === 'active' && x.budget)

  const copyCsv = async () => {
    const rows = [['dia', 'workspace', 'missão', 'cli', 'modelo', 'conta', 'tokens', 'custo_usd'], ...list.map((e) => [e.day, label.workspace(e), label.missao(e), e.cli, e.model ?? '', label.conta(e), String(e.tokens), e.costUsd.toFixed(4)])]
    const csv = rows.map((r) => r.map((v) => (/[",\n;]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v)).join(',')).join('\n')
    try {
      await navigator.clipboard.writeText(csv)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Não foi possível copiar para a área de transferência')
    }
  }

  return (
    <div className="dialog__body usage">
      <div className="usage__head">
        <button type="button" className="icon-btn" aria-label="Mês anterior" onClick={() => setMonth(shiftMonth(month, -1))}>‹</button>
        <h3 className="usage__month">{monthName(month)}</h3>
        <button type="button" className="icon-btn" aria-label="Próximo mês" disabled={month >= monthKey(new Date())} onClick={() => setMonth(shiftMonth(month, 1))}>›</button>
        <span className="spacer" />
        <button type="button" className="btn btn--ghost btn--sm" disabled={list.length === 0} onClick={copyCsv}>{copied ? 'Copiado' : 'Copiar CSV'}</button>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}
      {entries === null && !error ? (
        <p className="muted">Lendo o registro de uso…</p>
      ) : list.length === 0 ? (
        <p className="muted">Nenhum uso registrado neste mês. O registro começa nesta versão: o que os agentes usaram antes aparece só no total de cada missão.</p>
      ) : (
        <>
          <div className="usage__totals">
            <div><strong>{tokensText(total)}</strong><span className="muted">tokens</span></div>
            <div><strong>{costText(cost) ?? 'US$ 0,00'}</strong><span className="muted">em preço de API, só do Claude (na assinatura não é cobrado)</span></div>
          </div>

          <div className="usage__chart" role="img" aria-label={`Tokens por dia em ${monthName(month)}`}>
            {perDay.map((d) => (
              <div key={d.day} className="usage__day" title={`dia ${d.day}: ${d.by.map((x) => `${tokensText(x.tokens)} ${CLI_LABEL[x.cli]}`).join(', ')}`}>
                {d.by.map((x) => <span key={x.cli} className={`usage__bar usage__bar--${x.cli}`} style={{ height: `${(x.tokens / peak) * 100}%` }} />)}
              </div>
            ))}
          </div>
          <p className="usage__legend muted">{used.map((cli) => <span key={cli}><span className={`usage__swatch usage__bar--${cli}`} /> {CLI_LABEL[cli]} </span>)}</p>

          <div className="segmented" role="group" aria-label="Agrupar por">
            {GROUPS.map(([key, name]) => <button key={key} type="button" aria-pressed={groupBy === key} onClick={() => setGroupBy(key)}>{name}</button>)}
          </div>
          <table className="usage__table">
            <thead>
              <tr><th scope="col">{GROUPS.find(([k]) => k === groupBy)![1]}</th><th scope="col">Tokens</th><th scope="col"><span className="sr-only">Parte do mês</span></th><th scope="col">Custo (Claude)</th></tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.name}>
                  <td>{g.name}</td>
                  <td>{tokensText(g.tokens)}</td>
                  <td className="usage__share"><span style={{ width: `${(g.tokens / Math.max(1, total)) * 100}%` }} /></td>
                  <td>{costText(g.costUsd) ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <section className="usage__budgets" aria-labelledby="usage-budgets">
        <h3 id="usage-budgets" className="eyebrow">Orçamentos das missões em andamento</h3>
        {budgets.length === 0 ? (
          <p className="muted">Nenhuma missão com orçamento. Defina um ao criar a missão, ou pelo botão Orçamento no cabeçalho dela.</p>
        ) : (
          <ul className="plain-list">
            {budgets.map((x) => {
              const share = budgetShare(x)
              return (
                <li key={x.id} className="usage__budget" data-level={x.budget!.exceeded ? 'danger' : share >= 0.8 ? 'wait' : 'ok'}>
                  <span>{x.title}</span>
                  <span className="limit__bar" aria-hidden="true"><span style={{ width: `${Math.min(100, share * 100)}%` }} /></span>
                  <span className="muted">{x.budget!.exceeded ? 'esgotado' : `${Math.round(share * 100)}%`}</span>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
