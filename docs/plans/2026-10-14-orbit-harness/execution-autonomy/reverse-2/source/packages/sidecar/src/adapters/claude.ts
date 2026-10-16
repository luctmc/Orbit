import { SESSION_ID } from '@orbit/protocol'
import { statusFromHook, type HookPayload } from '../hooks.ts'
import { fromClaudeStatus } from '../usage.ts'
import { record, type NormalizedHook } from './types.ts'

export function claudeHook(value: unknown): NormalizedHook {
  const raw = record(value)
  const payload: HookPayload = {}
  for (const key of ['hook_event_name', 'message', 'notification_type', 'tool_name', 'session_id', 'last_assistant_message'] as const) {
    if (raw?.[key] !== undefined && typeof raw[key] !== 'string') throw new Error(`Formato de hook incompatível: ${key}`)
    if (typeof raw?.[key] === 'string') payload[key] = raw[key]
  }
  if (typeof raw?.stop_hook_active === 'boolean') payload.stop_hook_active = raw.stop_hook_active
  if (raw?.tool_input !== undefined) payload.tool_input = raw.tool_input
  const event = payload.hook_event_name
  return { payload, status: statusFromHook(payload), sessionId: payload.session_id && SESSION_ID.test(payload.session_id) ? payload.session_id : null,
    kind: event === 'SessionStart' ? 'session.started' : event === 'Stop' ? 'turn.ended' : statusFromHook(payload) ? 'status.changed' : 'unknown',
    sourceId: typeof raw?.event_id === 'string' ? raw.event_id : null }
}

export function claudeStatus(value: unknown) {
  const raw = record(value)
  const context = record(raw?.context_window)
  for (const key of ['total_input_tokens', 'total_output_tokens']) {
    const count = context?.[key]
    if (count !== undefined && (typeof count !== 'number' || !Number.isFinite(count) || count < 0)) throw new Error(`Formato de uso incompatível: ${key}`)
  }
  return { sessionId: typeof raw?.session_id === 'string' && SESSION_ID.test(raw.session_id) ? raw.session_id : null, report: fromClaudeStatus(raw) }
}
