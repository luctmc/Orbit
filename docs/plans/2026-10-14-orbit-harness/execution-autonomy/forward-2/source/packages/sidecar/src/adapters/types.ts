import type { AgentCli } from '@orbit/protocol'
import type { HookPayload, HookStatus } from '../hooks.ts'

export interface NormalizedHook {
  payload: HookPayload
  status: HookStatus | null
  sessionId: string | null
  kind: 'session.started' | 'turn.ended' | 'status.changed' | 'unknown'
  sourceId: string | null
}

/** Describes the adapter fixture contract, not an untested promise about every CLI release. */
export function adapterCapabilities(cli: AgentCli, detectedVersion: string | null = null) {
  const hooks = cli === 'claude' || cli === 'gemini'
  return { cli, detectedVersion, source: 'adapter-fixture' as const,
    formats: cli === 'claude' ? ['claude-hooks-v1', 'claude-status-v1', 'claude-transcript-v1'] : cli === 'codex' ? ['codex-event-msg-v1'] : cli === 'gemini' ? ['gemini-hooks-v1'] : [],
    supports: { sessionResume: hooks || cli === 'codex', turnEvents: hooks || cli === 'codex', usageEvents: cli === 'claude' || cli === 'codex', readOnlySandbox: cli === 'codex', providerConsumptionAck: false, orbitReceipt: cli !== 'shell', imageRead: null, skillVisibilityFilter: null },
  }
}

export const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
