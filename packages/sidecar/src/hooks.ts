import type { PaneStatus } from '@orbit/protocol'

export interface HookPayload {
  hook_event_name?: string
  message?: string
  notification_type?: string
  tool_name?: string
  tool_input?: unknown
  session_id?: string
  /** Stop: Claude is already continuing because a Stop hook blocked it once. */
  stop_hook_active?: boolean
  /** Stop: the text of the turn's last answer (recent Claude Code versions). */
  last_assistant_message?: string
}

export interface HookStatus {
  status: PaneStatus
  attention: string | null
}

/**
 * Maps a Claude Code hook event to the pane status it implies, or null when it says nothing new.
 * A Notification means the agent is blocked on the human, except the plain "waiting for your
 * input" reminder, which only says the turn is over.
 */
export function statusFromHook(payload: HookPayload): HookStatus | null {
  switch (payload.hook_event_name) {
    case 'SessionStart':
    case 'Stop':
      return { status: 'idle', attention: null }
    case 'UserPromptSubmit':
    case 'PreToolUse':
    case 'PostToolUse':
      return { status: 'running', attention: null }
    case 'Notification': {
      if (payload.notification_type === 'idle_prompt') return { status: 'idle', attention: null }
      const message = (payload.message ?? '').trim().slice(0, 300) || 'O agente precisa de você'
      return { status: 'waiting', attention: message }
    }
    default:
      return null
  }
}
