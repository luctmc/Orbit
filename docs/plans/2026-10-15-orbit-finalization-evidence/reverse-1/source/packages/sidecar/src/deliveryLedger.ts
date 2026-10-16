import { randomUUID } from 'node:crypto'
import type { Pane, PaneHandoff } from '@orbit/protocol'

/** Required work outlives its terminal. A new assignment after completion gets a new id. */
export interface DeliveryObligation {
  id: string
  missionId: string
  paneId: number
  assignedBy: number
  title: string
  acceptance: string[]
  status: 'pending' | 'progress' | 'done' | 'blocked' | 'unverified' | 'waived' | 'superseded'
  summary: string
  createdAt: number
  updatedAt: number
  waiver: { by: number; reason: string; at: number } | null
  replacementId: string | null
}

export const deliveryPending = (record: DeliveryObligation): boolean => !['done', 'waived', 'superseded'].includes(record.status)

export function deliveryStatus(status: PaneHandoff | null): DeliveryObligation['status'] {
  return status === 'auto' ? 'unverified' : status ?? 'pending'
}

export function newDelivery(pane: Pane, acceptance: string[] = []): DeliveryObligation | null {
  if (pane.role !== 'crew' || pane.cli === 'shell' || pane.assignedBy === null) return null
  return { id: randomUUID(), missionId: pane.missionId, paneId: pane.id, assignedBy: pane.assignedBy,
    title: pane.title, acceptance: [...acceptance], status: deliveryStatus(pane.handoffStatus), summary: '',
    createdAt: pane.createdAt, updatedAt: Date.now(), waiver: null, replacementId: null }
}
