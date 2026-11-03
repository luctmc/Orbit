import { useEffect, useId, useRef, useState } from 'react'
import type { GitSummary, Mission, PrStatus } from '@orbit/protocol'
import { useOrbit, useOrbitClient } from '../orbit/context.tsx'
import { openExternal } from '../orbit/open.ts'
import { CloseIcon } from './icons.tsx'

const WORKTREE_LABEL = { working: 'trabalhando', blocked: 'bloqueada', review: 'em revisão', done: 'concluída' } as const

const CHECK_LABEL: Record<PrStatus['checks'][number]['state'], string> = { ok: 'passou', fail: 'falhou', pending: 'rodando', skip: 'pulado' }

/** The PR text Orbit suggests: the objective, what the board says is done, the helpers' deliveries. */
function suggestedBody(mission: Mission, done: string[], deliveries: string[]): string {
  return [
    mission.objective && `## Objetivo\n\n${mission.objective}`,
    done.length > 0 && `## Feito\n\n${done.map((t) => `- ${t}`).join('\n')}`,
    deliveries.length > 0 && `## Retornos dos agentes\n\n${deliveries.map((d) => `- ${d}`).join('\n')}`,
    '---\nAberto pelo Orbit.',
  ].filter(Boolean).join('\n\n')
}

/** A mission's branch: what it has against the base, and its PR (opening it, and the CI). */
export function PrDialog({ mission, onClose }: { mission: Mission; onClose: () => void }) {
  const client = useOrbitClient()
  const { cards, events } = useOrbit()
  const ref = useRef<HTMLDialogElement>(null)
  const uid = useId()
  const git = mission.git!
  const [summary, setSummary] = useState<GitSummary | null>(null)
  const [status, setStatus] = useState<PrStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [title, setTitle] = useState(mission.title)
  const [draft, setDraft] = useState(true)
  const [body, setBody] = useState(() => suggestedBody(
    mission,
    cards.filter((c) => c.missionId === mission.id && c.column === 'feito').map((c) => c.title),
    events.filter((e) => e.missionId === mission.id && e.kind === 'handoff' && e.paneId !== null).map((e) => `${e.title}: ${e.body.split('\n')[0]}`),
  ))

  useEffect(() => {
    const dialog = ref.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])

  useEffect(() => {
    client.ask({ type: 'git.summary', missionId: mission.id }, 'git.summary', (m) => m.missionId === mission.id).then((m) => setSummary(m.summary), (e: Error) => setError(e.message))
    if (git.pr) client.ask({ type: 'git.pr.status', missionId: mission.id }, 'git.pr', (m) => m.missionId === mission.id).then((m) => setStatus(m.status), (e: Error) => setError(e.message))
  }, [client, mission.id, git.pr])

  const create = () => {
    setBusy(true)
    setError(null)
    client.ask({ type: 'git.pr.create', missionId: mission.id, title, body, draft }, 'git.pr', (m) => m.missionId === mission.id, 180_000)
      .then((m) => setStatus(m.status), (e: Error) => setError(e.message))
      .finally(() => setBusy(false))
  }

  const pending = summary?.agents.filter((a) => a.ahead > 0) ?? []
  const dirty = summary?.agents.filter((a) => a.dirty.length > 0) ?? []

  return (
    <dialog ref={ref} className="dialog dialog--wide" aria-labelledby={`${uid}-title`} onCancel={(e) => { e.preventDefault(); onClose() }}>
      <header className="dialog__head">
        <div>
          <div className="eyebrow">Branch da missão</div>
          <h2 id={`${uid}-title`}>{git.pr ? `PR #${git.pr.number}` : 'Abrir PR'}</h2>
        </div>
        <button type="button" className="icon-btn" aria-label="Fechar" onClick={onClose}><CloseIcon /></button>
      </header>
      <div className="dialog__body pr">
        <p className="pr__branches"><code>{git.branch}</code> <span className="muted">→</span> <code>{git.base}</code></p>
        {error && <p className="form-error" role="alert">{error}</p>}

        {git.pr && (
          <section className="pr__status" aria-label="Situação do PR">
            <div className="pr__status-head">
              <strong>#{git.pr.number}</strong>
              {status && <span className={`chip${status.state === 'MERGED' ? ' chip--main' : ''}`}>{status.state === 'OPEN' ? (status.draft ? 'rascunho' : 'aberto') : status.state === 'MERGED' ? 'mergeado' : 'fechado'}</span>}
              <span className="spacer" />
              <button className="btn btn--ghost btn--sm" onClick={() => client.ask({ type: 'git.pr.status', missionId: mission.id }, 'git.pr', (m) => m.missionId === mission.id).then((m) => setStatus(m.status), (e: Error) => setError(e.message))}>Atualizar</button>
              <button className="btn btn--primary btn--sm" onClick={() => void openExternal(git.pr!.url)}>Abrir no GitHub</button>
            </div>
            {!status ? <p className="muted">Consultando o GitHub…</p> : status.checks.length === 0 ? <p className="muted">Sem verificações de CI neste PR.</p> : (
              <ul className="plain-list pr__checks">
                {status.checks.map((c) => <li key={c.name}><span className={`pr__check pr__check--${c.state}`}>{CHECK_LABEL[c.state]}</span>{c.name}</li>)}
              </ul>
            )}
          </section>
        )}

        {!summary ? <p className="muted">Lendo o branch…</p> : (
          <>
            {summary.agents.length > 0 && <ul className="plain-list pr__list" aria-label="Cópias dos agentes">{summary.agents.map(a => <li key={a.paneId}>#{a.paneId} {a.title}{a.status && <span className="chip">{WORKTREE_LABEL[a.status]}</span>}</li>)}</ul>}
            {pending.length > 0 && <p className="note pr__warn">Ainda não integrado: {pending.map((a) => `#${a.paneId} (${a.ahead} commit${a.ahead > 1 ? 's' : ''} em ${a.branch})`).join(', ')}. O líder integra com git merge.</p>}
            {dirty.length > 0 && <p className="note pr__warn">Sem commit: {dirty.map((a) => `#${a.paneId} (${a.dirty.length} arquivo${a.dirty.length > 1 ? 's' : ''})`).join(', ')}.</p>}
            <div className="pr__cols">
              <section aria-label="Commits">
                <h3 className="eyebrow">Commits · {summary.commits.length}</h3>
                {summary.commits.length === 0 ? <p className="muted">Nenhum commit além de {summary.base} ainda.</p> : (
                  <ul className="plain-list pr__list">{summary.commits.map((c) => <li key={c.sha}><code>{c.sha}</code> {c.subject}</li>)}</ul>
                )}
              </section>
              <section aria-label="Arquivos">
                <h3 className="eyebrow">Arquivos · {summary.files.length}</h3>
                <ul className="plain-list pr__list">
                  {summary.files.map((f) => <li key={f.path}><code>{f.path}</code> {f.added !== null && <span className="plus">+{f.added}</span>} {f.removed !== null && f.removed > 0 && <span className="minus">−{f.removed}</span>}</li>)}
                </ul>
              </section>
            </div>
            {!git.pr && (
              <form className="pr__form" onSubmit={(e) => { e.preventDefault(); create() }}>
                <div className="field">
                  <label htmlFor={`${uid}-t`}>Título</label>
                  <input id={`${uid}-t`} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor={`${uid}-b`} className="legend-row">
                    <span>Descrição</span>
                    <button type="button" className="link-btn" onClick={() => client.ask({ type: 'report.get', missionId: mission.id }, 'report', (m) => m.missionId === mission.id, 60_000).then((m) => setBody(m.markdown), (e: Error) => setError(e.message))}>Usar o relatório da missão</button>
                  </label>
                  <textarea id={`${uid}-b`} rows={8} value={body} onChange={(e) => setBody(e.target.value)} />
                </div>
                <label className="check"><input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} /><span>Abrir como rascunho</span></label>
                {!summary.remote && <p className="form-error">O repositório não tem um remoto "origin".</p>}
                <div className="pr__actions">
                  <span className="muted">Envia <code>{git.branch}</code> para o origin e abre o PR com o seu gh.</span>
                  <button type="submit" className="btn btn--primary" disabled={busy || !title.trim() || summary.commits.length === 0 || !summary.remote}>{busy ? 'Enviando…' : 'Enviar branch e abrir PR'}</button>
                </div>
              </form>
            )}
          </>
        )}
      </div>
    </dialog>
  )
}
