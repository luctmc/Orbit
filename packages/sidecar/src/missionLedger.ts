import type { VerificationRecord } from '@orbit/protocol'
import type { ActivityLedger } from './activityLedger.ts'
import type { DeliveryObligation } from './deliveryLedger.ts'

type History = Omit<ActivityLedger, 'version'> & {
  verifications?: ReadonlyArray<Pick<VerificationRecord, 'resultId' | 'scope' | 'verdict' | 'checks'>>
  deliveries?: ReadonlyArray<Pick<DeliveryObligation, 'id' | 'status'>>
}

const compact = (text: string | null | undefined, max: number): string => {
  const value = text?.replace(/[\s|]+/g, ' ').trim() || '-'
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

/** Visão derivada: preserva a identidade da atividade e mostra somente a tentativa atual. */
export function delegationLines(history: History): string[] {
  const lines = history.activities.slice(-30).map(activity => {
    const attempt = history.attempts.find(a => a.id === activity.activeAttemptId && a.activityId === activity.id)
    const attempts = history.attempts.filter(a => a.activityId === activity.id)
    const results = history.results.filter(r => r.activityId === activity.id && r.attemptId === attempt?.id && r.activityRevision === activity.revision)
    const result = results.at(-1)
    const reviews = (history.verifications ?? []).filter(v => v.scope === 'result' && v.resultId === result?.id)
    const verdict = reviews.some(v => v.verdict === 'changes_required') ? 'changes_required' : reviews.at(-1)?.verdict
    const delivery = history.deliveries?.find(d => d.id === activity.deliveryId)
    const failures = attempts.filter(a =>
      !!a.error && a.error !== 'Orbit reiniciou; confira a tentativa antes de retomar ou repetir.' && !a.error.includes('rescue_duplicate')
      || a.pane?.status === 'exited' && a.pane.exitCode !== null && a.pane.exitCode !== 0
      || history.verifications?.some(v => v.scope === 'result' && v.verdict === 'changes_required' && history.results.some(r => r.id === v.resultId && r.attemptId === a.id)),
    ).length
    let status: string
    if (delivery?.status === 'superseded' || activity.state === 'waived') status = 'substituído'
    else if (activity.state === 'accepted' || verdict === 'accepted') status = 'aceito'
    else if (failures >= 3) status = 'resgate esgotado'
    else if (activity.state === 'blocked' || result?.status === 'blocked') status = 'bloqueado'
    else if (verdict === 'changes_required') status = 'ajustes solicitados'
    else if (verdict === 'unverified' || result?.state === 'unverified' || result?.status === 'auto') status = 'não verificado'
    else if (activity.state === 'awaiting_validation' || result?.status === 'done') status = 'entregue'
    else if (activity.state === 'running' || result?.status === 'progress') status = 'em andamento'
    else if (activity.state === 'stopped') status = 'bloqueado'
    else status = 'aguardando'
    const decision = attempt?.decision ?? attempt?.pane?.executionConfig?.decision
    const score = decision?.reasons.join('\n').match(/brief: [^\n]*? · nota (10|[0-9])\/10\b/)?.[1]
    const check = reviews.flatMap(v => v.checks)[0]
    const evidence = results.find(r => r.evidence.trim())?.evidence ?? (check ? `${check.command}: exit ${check.exitCode}; ${check.summary}` : '')
    return `#${attempt?.paneId ?? '-'} | ${compact(attempt?.pane?.taskType ?? attempt?.pane?.squadRole, 30)} | ${compact(decision?.effective.model ?? attempt?.model, 40)}/${compact(decision?.effective.effort ?? attempt?.pane?.effort, 8)} | brief ${score ? `${score}/10` : '-'} | ${status} | ${compact(evidence, 80)}`
  })
  if (history.activities.length > 30) lines.push(`+${history.activities.length - 30} anteriores`)
  return lines
}
