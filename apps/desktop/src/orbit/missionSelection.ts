// Adapted from Orca workspace-terminal-active-tabs.ts, commit 100b6b1efe1508d6a2c70945417e4fd8e4a26d23.
// Copyright (c) 2026 Lovecast Inc. MIT; see THIRD_PARTY_NOTICES.md.
import type { Pane } from '@orbit/protocol'

/** Selection belongs to a mission, while the pane ID belongs to the runtime. Never spawn on focus. */
export function restoreMissionSelection(saved: unknown, missionIds: readonly string[], panes: readonly Pick<Pane, 'id' | 'missionId' | 'role'>[]): Record<string, number | null> {
  const selection: Record<string, number | null> = {}
  const remembered = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved as Record<string, unknown> : {}
  for (const missionId of missionIds) {
    const crew = panes.filter(pane => pane.missionId === missionId)
    const id = remembered[missionId]
    selection[missionId] = typeof id === 'number' && crew.some(pane => pane.id === id)
      ? id : (crew.find(pane => pane.role === 'lead') ?? crew[0])?.id ?? null
  }
  return selection
}
