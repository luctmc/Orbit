import { randomUUID } from 'node:crypto'
import type { ActivityResult, DeliveryNotice, Pane } from '@orbit/protocol'

export function makeNotice(result: ActivityResult, pane: Pane, recipient: DeliveryNotice['recipient'], text?: string): DeliveryNotice {
  const label = { done: 'concluído', blocked: 'bloqueado', progress: 'em andamento', auto: 'automático' }[result.status]
  return { id: randomUUID(), missionId: pane.missionId, resultId: result.id, recipient,
    text: text ?? `[Orbit] Retorno de #${pane.id} (${pane.title})${recipient.kind === 'pane' ? ' para você' : ''}, ${label}: ${result.summary.replace(/\s*\n\s*/g, ' / ')}${result.evidence ? ` · evidência: ${result.evidence.replace(/\s*\n\s*/g, ' / ').slice(0, 600)}` : ''} (detalhes em handoff_list)`,
    state: 'persisted', deliveries: [], acknowledgedBy: null, createdAt: result.createdAt }
}

export function needsDelivery(notice: DeliveryNotice, pane: Pane): boolean {
  return notice.state !== 'agent_acknowledged' && !!pane.executionEpoch && !notice.deliveries.some(d => d.paneId === pane.id && d.executionEpoch === pane.executionEpoch)
}

export function noticeText(notice: DeliveryNotice): string {
  return `${notice.text}\n[Orbit] Recibo ${notice.id}; resultado ${notice.resultId}. Após ler, confirme com delivery_ack(deliveryId: "${notice.id}").`
}
