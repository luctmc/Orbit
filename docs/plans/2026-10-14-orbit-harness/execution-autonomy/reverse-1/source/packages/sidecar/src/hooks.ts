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

/** Gemini CLI's hook events, as the Claude Code events Orbit already handles. */
const FROM_GEMINI: Record<string, string> = {
  SessionStart: 'SessionStart',
  BeforeAgent: 'UserPromptSubmit',
  AfterAgent: 'Stop',
  BeforeTool: 'PreToolUse',
  AfterTool: 'PostToolUse',
  Notification: 'Notification',
}

/** A Gemini hook payload in Claude Code's terms (AfterAgent's answer is its last message). */
export function fromGeminiHook(payload: HookPayload & { prompt_response?: string }): HookPayload {
  const event = FROM_GEMINI[payload.hook_event_name ?? '']
  return { ...payload, hook_event_name: event ?? `gemini:${payload.hook_event_name ?? ''}`, last_assistant_message: payload.prompt_response ?? payload.last_assistant_message }
}

/**
 * Orbit's answer, in Claude Code's shape, as Gemini CLI expects it: a refused tool or a blocked
 * turn end is `decision: deny` with the reason (for AfterAgent the reason is the next prompt);
 * extra context goes to BeforeAgent.
 */
export function toGeminiHook(answer: object | null): object | null {
  if (!answer) return null
  const out = answer as { decision?: string; reason?: string; hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string; additionalContext?: string } }
  if (out.decision === 'block') return { decision: 'deny', reason: out.reason }
  if (out.hookSpecificOutput?.permissionDecision === 'deny') return { decision: 'deny', reason: out.hookSpecificOutput.permissionDecisionReason }
  if (out.hookSpecificOutput?.additionalContext) return { hookSpecificOutput: { hookEventName: 'BeforeAgent', additionalContext: out.hookSpecificOutput.additionalContext } }
  return null
}
