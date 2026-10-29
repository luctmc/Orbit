import type { HarnessModule, ActivityRecord, MissionProgress as Progress, Pane } from '@orbit/protocol'
import { CLI_LABEL, EFFORT_LABEL } from '../orbit/labels.ts'

const STATE: Record<ActivityRecord['state'], string> = { reserved: 'Preparada', running: 'Em execução', stopped: 'Interrompida', blocked: 'Bloqueada', awaiting_validation: 'Aguardando revisão', accepted: 'Aceita', waived: 'Dispensada' }
const RECEIPT = { persisted: 'Resultado salvo; envio pendente', pty_accepted: 'Enviado ao terminal; confirmação pendente', agent_acknowledged: 'Recebimento confirmado pelo agente', superseded: 'Substituído por nova tentativa' }
const DECISION = { benchmark: 'Benchmark comparável', explicit: 'Escolha explícita', rule: 'Regra do maestro', classifier: 'Classificador', fallback: 'Alternativa do maestro' }
const MODULE: Record<HarnessModule, string> = { inspect: 'Inspecionar', recover: 'Retomar com evidências', reproduce: 'Reproduzir', implement: 'Implementar', review: 'Revisar', verify: 'Verificar', deliver: 'Entregar' }
const HARNESS = { measured: 'Escolha por benchmark', fallback: 'Amostra insuficiente; usando regra do maestro', explicit: 'Sua escolha preservada' }
const VERDICT = { accepted: 'Aceito', changes_required: 'Ajustes solicitados', unverified: 'Não verificado' }
const stamp = (at: number) => new Date(at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

/** Shows the durable activity ledger, including work whose terminal was closed. */
export function MissionProgress({ progress, panes, onSelectPane }: { progress: Progress | null; panes: Pane[]; onSelectPane: (id: number) => void }) {
  if (!progress) return <p className="mission-progress__empty muted">O histórico aparece após a primeira consulta ao motor.</p>
  const current = progress.integration
  const finalReview = progress.verifications.find(v => v.id === current.reviewId)
  return <section className="mission-progress" aria-label="Atividades e evidências da missão">
    <div className="mission-progress__intro">
      <span className="eyebrow">Atividades e evidências</span>
      <span className="muted">Observado às {stamp(progress.observedAt)}</span>
    </div>
    {finalReview && <details className="mission-progress__final">
      <summary>Revisão final · {current.state === 'current' ? 'corresponde ao código observado' : current.state === 'unknown' ? 'não foi possível conferir' : 'precisa de nova conferência'}</summary>
      <p>{finalReview.summary}</p>
      <p className="muted">Parecer de #{finalReview.reviewer.paneId} às {stamp(finalReview.createdAt)}. {current.reason}</p>
      {finalReview.checks.map((c, i) => <p key={i}><code>{c.command}</code> · saída informada {c.exitCode}</p>)}
    </details>}
    {!progress.activities.length && <p className="mission-progress__empty muted">Nenhuma atividade atribuída registrada. O quadro de planejamento e o terminal continuam disponíveis.</p>}
    <ol className="activity-list">
      {progress.activities.map(activity => {
        const attempts = progress.attempts.filter(a => a.activityId === activity.id)
        const attempt = attempts.find(a => a.id === activity.activeAttemptId)
        const results = progress.results.filter(r => r.activityId === activity.id)
        const latest = results.findLast(r => r.attemptId === activity.activeAttemptId)
        const valid = progress.validation.find(v => v.activityId === activity.id)
        const reviews = latest ? progress.verifications.filter(v => v.resultId === latest.id && v.scope === 'result') : []
        const review = reviews.at(-1)
        const label = activity.state === 'accepted' && activity.verificationRequired && !valid?.valid ? 'Revisão pendente' : STATE[activity.state]
        const tone = activity.state === 'waived' ? 'muted' : valid?.valid ? 'accepted' : ['blocked', 'stopped'].includes(activity.state) ? 'blocked' : 'pending'
        const decision = attempt?.decision
        return <li key={activity.id} className="activity-item" data-tone={tone}>
          <details>
            <summary>
              <span className="activity-item__node" aria-hidden="true" />
              <span className="activity-item__name">{activity.title}</span>
              <span className="activity-item__state">{label}</span>
            </summary>
            <div className="activity-item__detail">
              <div className="activity-item__assignment">
                <span>{attempt?.cli ? CLI_LABEL[attempt.cli] : 'Agente'}{attempt?.model ? ` · ${attempt.model}` : ''}{attempt?.decision?.effective.effort ? ` · esforço ${EFFORT_LABEL[attempt.decision.effective.effort]}` : ''}</span>
                {attempt && panes.some(p => p.id === attempt.paneId) && <button type="button" className="btn btn--ghost btn--sm" onClick={() => onSelectPane(attempt.paneId)}>Ver agente #{attempt.paneId}</button>}
              </div>
              {decision && <details><summary>Por que este modelo · {DECISION[decision.source]}</summary><ul>{decision.reasons.map((reason, i) => <li key={i}>{reason}</li>)}</ul>{decision.capabilityLimits.map((limit, i) => <p key={i}>{limit}</p>)}</details>}
              {decision?.harness && <details>
                <summary>Estratégia da atividade · {HARNESS[decision.harness.status]}</summary>
                <ol>{decision.harness.strategy.modules.map(module => <li key={module}>{MODULE[module]}</li>)}</ol>
                {decision.harness.reasons.map((reason, i) => <p key={i}>{reason}</p>)}
                {decision.harness.status === 'measured' && <p>{decision.harness.samples} tentativas comparáveis · limite inferior de qualidade {decision.harness.qualityLowerBound === null ? 'desconhecido' : `${(decision.harness.qualityLowerBound * 100).toFixed(1)}%`}. Isso não garante o resultado desta atividade.</p>}
                <p className="muted">Entrega e aceite independente continuam sendo etapas separadas.</p>
              </details>}
              {!!activity.dependencies?.length && <p>Depende de: {activity.dependencies.map(d => progress.activities.find(a => a.id === d.activityId)?.title || 'atividade anterior').join(', ')}</p>}
              <strong>Critérios de aceite</strong>
              {activity.acceptance.length ? <ol>{activity.acceptance.map((criterion, i) => <li key={i}>{criterion}</li>)}</ol> : <p className="muted">Sem critérios registrados.</p>}
              {!activity.verificationRequired && <p className="muted">Atividade legada ou sem revisão independente obrigatória.</p>}
              {latest && <><strong>Último retorno · {latest.status === 'done' ? 'entrega declarada' : latest.status === 'blocked' ? 'bloqueio' : latest.status === 'progress' ? 'progresso' : 'retorno automático'}</strong><p>{latest.summary}</p>{latest.evidence && <pre>{latest.evidence}</pre>}{latest.details && <details><summary>Detalhes do retorno</summary><pre>{latest.details}</pre></details>}</>}
              {latest && progress.deliveries.filter(n => n.resultId === latest.id).map(notice => <p className="activity-item__receipt" key={notice.id}>{RECEIPT[notice.state]}{notice.recipient.kind === 'lead' ? ' · líder' : ` · #${notice.recipient.paneId}`}. Recebimento não equivale a aceite.</p>)}
              {review ? <details><summary>Revisão · {VERDICT[review.verdict]} por #{review.reviewer.paneId}</summary><p>{review.summary}</p>{review.checks.map((c, i) => <p key={i}><code>{c.command}</code> · saída informada {c.exitCode}<br />{c.summary}</p>)}<p className="muted">Checks relatados pelo agente revisor.</p></details> : activity.verificationRequired && <p className="muted">Ainda não há parecer independente para esta entrega.</p>}
              {valid && !valid.valid && <p className="activity-item__reason">{valid.reason?.replaceAll(activity.id, activity.title)}</p>}
              {attempt?.error && <p className="activity-item__reason">{attempt.error}</p>}
              {(attempts.length > 1 || results.length > 1) && <details><summary>Histórico · {attempts.length} tentativas e {results.length} retornos</summary>{attempts.map((a, i) => <div key={a.id}><strong>Tentativa {i + 1} · {a.cli ? CLI_LABEL[a.cli] : 'agente'}</strong>{a.retryReason && <p>{a.retryReason}</p>}{results.filter(r => r.attemptId === a.id).map(r => <p key={r.id}>{r.summary}</p>)}</div>)}</details>}
            </div>
          </details>
        </li>
      })}
    </ol>
  </section>
}
