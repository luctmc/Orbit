import { claudeContext, codexContext, unavailableContext } from './structuredContext.ts'
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AccountLimits, RateWindow, TokenUsage } from '@orbit/protocol'

/** Limits as a CLI reports them; the sidecar knows which account the agent runs as. */
export type ReportedLimits = Omit<AccountLimits, 'accountId'>

export interface UsageReport {
  context?: import('@orbit/protocol').ContextUsage
  origin?: 'claude-transcript-v1' | 'claude-context-only' | 'codex-session-total-v1'
  observed?: Partial<Record<keyof TokenUsage, boolean>>
  usage: TokenUsage | null
  contextPercent: number | null
  limits: ReportedLimits | null
}

const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

function window(raw: unknown, minutes: number, resetsInSeconds: boolean): RateWindow | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const used = r.used_percentage ?? r.used_percent
  const resets = r.resets_at
  if (typeof used !== 'number' || typeof resets !== 'number') return null
  return { usedPercent: used, resetsAt: resetsInSeconds ? resets * 1000 : resets, windowMinutes: typeof r.window_minutes === 'number' ? r.window_minutes : minutes }
}

/**
 * Claude status supplies current context and cumulative estimated cost. Consumption comes
 * only from Orbit's normalized transcript snapshot, never context_window.total_*.
 */
export function fromClaudeStatus(payload: unknown, now = Date.now()): UsageReport {
  const p = (payload ?? {}) as Record<string, any>
  const ctx = p.context_window ?? {}
  const normalized = p.orbit_session_usage
  const keys = ['input', 'output', 'cacheRead', 'cacheWrite', 'total'] as const
  const hasTokens = normalized?.format === 'claude-transcript-v1' && keys.every(key => Number.isSafeInteger(normalized[key]) && normalized[key] >= 0) && normalized.input + normalized.output === normalized.total
  const cost = typeof p.cost?.total_cost_usd === 'number' && Number.isFinite(p.cost.total_cost_usd) && p.cost.total_cost_usd >= 0 ? p.cost.total_cost_usd : null
  const usage: TokenUsage | null = hasTokens ? { input: normalized.input, output: normalized.output, cacheRead: normalized.cacheRead, cacheWrite: normalized.cacheWrite, total: normalized.total, costUsd: cost } : cost !== null ? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, costUsd: cost } : null
  const rate = p.rate_limits
  const limits: ReportedLimits | null = rate
    ? { cli: 'claude', fiveHour: window(rate.five_hour, 300, true), weekly: window(rate.seven_day, 10080, true), plan: null, updatedAt: now }
    : null
  const complete = hasTokens && normalized.complete !== false
  return { ...(p.context_window !== undefined ? {context:claudeContext(ctx,now)} : {}), usage, origin: hasTokens ? 'claude-transcript-v1' : 'claude-context-only', observed: { input: complete, output: complete, total: complete, cacheRead: complete, cacheWrite: complete, costUsd: cost !== null }, contextPercent: p.context_window !== undefined ? claudeContext(ctx,now).percent : null, limits }
}

/** The last `token_count` event of a Codex session file: session totals and account limits. */
export function fromCodexRollout(text: string, now = Date.now()): UsageReport {
  const lines = text.split('\n')
  let awaitingTurn=false
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!
    if(line.includes('"turn_context"'))try{if(JSON.parse(line)?.type==='turn_context')awaitingTurn=true}catch{}
    if (!line.includes('"token_count"')) continue
    let event: any
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    const payload = event.payload ?? event
    if (payload?.type !== 'token_count') continue
    const total = payload.info?.total_token_usage
    const usage: TokenUsage | null = total
      // reasoning_output_tokens is a breakdown of output_tokens, not additional output.
      ? { input: num(total.input_tokens), output: num(total.output_tokens), cacheRead: num(total.cached_input_tokens), cacheWrite: num(total.cache_write_input_tokens), total: num(total.total_tokens), costUsd: null }
      : null
    const context = payload.info?.model_context_window
    const last = payload.info?.last_token_usage
    const eventTime = typeof event.timestamp === 'string' ? Date.parse(event.timestamp) : NaN
    const contextUsage = awaitingTurn ? unavailableContext('codex:awaiting-turn-usage',now) : codexContext(payload.info,Number.isFinite(eventTime) && eventTime <= now + 1000 ? eventTime : now)
    const contextPercent = contextUsage.percent
    const rate = payload.rate_limits
    const observedAt = typeof event.timestamp === 'string' ? Date.parse(event.timestamp) : NaN
    const limits: ReportedLimits | null = rate
      ? { cli: 'codex', fiveHour: window(rate.primary, 300, true), weekly: window(rate.secondary, 10080, true), plan: typeof rate.plan_type === 'string' ? rate.plan_type : null, updatedAt: Number.isFinite(observedAt) && observedAt <= now + 1000 ? observedAt : now }
      : null
    const observed: UsageReport['observed'] = { input: typeof total?.input_tokens === 'number', output: typeof total?.output_tokens === 'number', cacheRead: typeof total?.cached_input_tokens === 'number', cacheWrite: typeof total?.cache_write_input_tokens === 'number', total: typeof total?.total_tokens === 'number', costUsd: false }
    return { usage, observed, origin: 'codex-session-total-v1', context:contextUsage, contextPercent, limits }
  }
  return { usage: null, contextPercent: null, limits: null }
}

/** What an agent used since its previous report (CLIs report session totals). */
export function usageDelta(previous: TokenUsage | null, next: TokenUsage): TokenUsage {
  const p = previous ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, costUsd: null }
  const d = (a: number, b: number) => Math.max(0, a - b)
  return {
    input: d(next.input, p.input),
    output: d(next.output, p.output),
    cacheRead: d(next.cacheRead, p.cacheRead),
    cacheWrite: d(next.cacheWrite, p.cacheWrite),
    total: d(next.total, p.total),
    // micro-dollars, so float noise (0.03 - 0.01) does not pile up in the totals
    costUsd: next.costUsd === null ? null : Math.max(0, Math.round((next.costUsd - (p.costUsd ?? 0)) * 1e6) / 1e6),
  }
}

export function codexHome(): string {
  return process.env.CODEX_HOME ?? join(homedir(), '.codex')
}

const safeRealpath = (path: string) => {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

/** First line of a file, without reading the whole session. */
function firstLine(path: string): string {
  const fd = openSync(path, 'r')
  try {
    const buffer = Buffer.alloc(64 * 1024)
    const read = readSync(fd, buffer, 0, buffer.length, 0)
    return buffer.subarray(0, read).toString('utf8').split('\n')[0] ?? ''
  } finally {
    closeSync(fd)
  }
}

/**
 * The Codex session file an agent writes to: started in its folder no earlier than the agent,
 * and not already claimed by another agent. Codex keeps them under sessions/YYYY/MM/DD.
 */
export function findCodexRollout(home: string, cwd: string, since: number, taken: ReadonlySet<string>): string | null {
  const root = join(home, 'sessions')
  if (!existsSync(root)) return null
  const want = safeRealpath(cwd)
  const days = [since, Date.now()].map((t) => {
    const d = new Date(t)
    return join(root, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'))
  })
  const candidates: Array<{ path: string; started: number }> = []
  for (const dir of new Set(days)) {
    if (!existsSync(dir)) continue
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.jsonl')) continue
      const path = join(dir, name)
      if (taken.has(path) || statSync(path).mtimeMs < since - 5000) continue
      try {
        const meta = JSON.parse(firstLine(path))
        const payload = meta.payload ?? meta
        const started = Date.parse(payload.timestamp ?? '')
        if (meta.type === 'session_meta' && safeRealpath(String(payload.cwd ?? '')) === want && started >= since - 5000) candidates.push({ path, started })
      } catch {
        // not a session file we understand
      }
    }
  }
  candidates.sort((a, b) => a.started - b.started)
  return candidates[0]?.path ?? null
}

/** The tail of a growing file, enough to hold the last token_count event. */
/** A Codex turn as its session file tells it: started, or complete with its last message. */
export interface CodexTurn {
  id: string
  done: boolean
  /** When the event was written (epoch ms; 0 when unknown). */
  at: number
  lastMessage: string | null
}

/**
 * The latest turn in the tail of a Codex session file. Codex has no hooks; `task_started` and
 * `task_complete` events are how Orbit learns that a Codex agent ended its turn.
 */
export function codexLastTurn(text: string): CodexTurn | null {
  const lines = text.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!
    if (!line.includes('"task_complete"') && !line.includes('"task_started"')) continue
    let event: any
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    const payload = event.payload ?? event
    if (payload?.type !== 'task_complete' && payload?.type !== 'task_started') continue
    const at = Date.parse(event.timestamp ?? '') || 0
    return {
      id: typeof payload.turn_id === 'string' ? payload.turn_id : `${payload.type}@${at}`,
      done: payload.type === 'task_complete',
      at,
      lastMessage: typeof payload.last_agent_message === 'string' ? payload.last_agent_message : null,
    }
  }
  return null
}

/** The session file of a known Codex conversation (its name ends with the session id). */
export function findCodexRolloutById(home: string, sessionId: string): string | null {
  const root = join(home, 'sessions')
  if (!existsSync(root) || !/^[\w-]{8,}$/.test(sessionId)) return null
  const name = (readdirSync(root, { recursive: true }) as string[]).find((f) => f.endsWith(`${sessionId}.jsonl`))
  return name ? join(root, name) : null
}

/** The Codex session file written last in a Codex home (looking back a week), with when. */
export function latestCodexRollout(home: string, now = Date.now()): { path: string; mtime: number } | null {
  const root = join(home, 'sessions')
  if (!existsSync(root)) return null
  let best: { path: string; mtime: number } | null = null
  for (let back = 0; back < 7 && !best; back++) {
    const d = new Date(now - back * 86_400_000)
    const dir = join(root, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'))
    if (!existsSync(dir)) continue
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.jsonl')) continue
      const path = join(dir, name)
      const mtime = statSync(path).mtimeMs
      if (!best || mtime > best.mtime) best = { path, mtime }
    }
  }
  return best
}

export function readTail(path: string, bytes = 256 * 1024): string {
  const size = statSync(path).size
  if (size <= bytes) return readFileSync(path, 'utf8')
  const fd = openSync(path, 'r')
  try {
    const buffer = Buffer.alloc(bytes)
    const read = readSync(fd, buffer, 0, bytes, size - bytes)
    return buffer.subarray(0, read).toString('utf8')
  } finally {
    closeSync(fd)
  }
}


/** The conversation id in a Codex session file's first line (`session_meta`). */
export function codexSessionId(path: string): string | null {
  try {
    const meta = JSON.parse(firstLine(path)) as { type?: string; payload?: { id?: unknown } }
    return meta.type === 'session_meta' && typeof meta.payload?.id === 'string' ? meta.payload.id : null
  } catch {
    return null
  }
}
