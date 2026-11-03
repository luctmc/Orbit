import type { PaneHandoff, WorktreeStatus } from '@orbit/protocol'

/** Derives a copy's state from the current attempt, never from terminal exit alone. */
export function worktreeStatus(input: { alive: boolean; waiting: boolean; dirty: boolean; result: PaneHandoff | null; reviewRequired: boolean; accepted: boolean }): WorktreeStatus {
  if (input.waiting || input.result === 'blocked') return 'blocked'
  if (input.dirty || input.result !== 'done') return 'working'
  return input.reviewRequired && !input.accepted ? 'review' : 'done'
}
