import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AccountLimits, RateWindow, TokenUsage } from '@orbit/protocol'

/** Limits as a CLI reports them; the sidecar knows which account the agent runs as. */
export type ReportedLimits = Omit<AccountLimits, 'accountId'>

export interface UsageReport {
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
 * Claude Code's status line input: session token totals, cost, context use and — after the
 * first API call — the account's 5-hour and weekly limits.
 */
export function fromClaudeStatus(payload: unknown, now = Date.now()): UsageReport {
  const p = (payload ?? {}) as Record<string, any>
  const ctx = p.context_window ?? {}
  const input = num(ctx.total_input_tokens)
  const output = num(ctx.total_output_tokens)
  const hasTokens = typeof ctx.total_input_tokens === 'number' || typeof ctx.total_output_tokens === 'number'
  // Cache figures here are the last call's only, not the session's, so they are left out
  // (the session totals already include cached input).
  const usage: TokenUsage | null = hasTokens
    ? { input, output, cacheRead: 0, cacheWrite: 0, total: input + output, costUsd: typeof p.cost?.total_cost_usd === 'number' ? p.cost.total_cost_usd : null }
    : null
  const rate = p.rate_limits
  const limits: ReportedLimits | null = rate
    ? { cli: 'claude', fiveHour: window(rate.five_hour, 300, true), weekly: window(rate.seven_day, 10080, true), plan: null, updatedAt: now }
    : null
  return { usage, contextPercent: typeof ctx.used_percentage === 'number' ? ctx.used_percentage : null, limits }
}

/** The last `token_count` event of a Codex session file: session totals and account limits. */
export function fromCodexRollout(text: string, now = Date.now()): UsageReport {
  const lines = text.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!
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
      ? { input: num(total.input_tokens), output: num(total.output_tokens) + num(total.reasoning_output_tokens), cacheRead: num(total.cached_input_tokens), cacheWrite: num(total.cache_write_input_tokens), total: num(total.total_tokens), costUsd: null }
      : null
    const context = payload.info?.model_context_window
    const last = payload.info?.last_token_usage
    const contextPercent = context && last ? Math.min(100, Math.round((num(last.input_tokens) / context) * 100)) : null
    const rate = payload.rate_limits
    const limits: ReportedLimits | null = rate
      ? { cli: 'codex', fiveHour: window(rate.primary, 300, true), weekly: window(rate.secondary, 10080, true), plan: typeof rate.plan_type === 'string' ? rate.plan_type : null, updatedAt: now }
      : null
    return { usage, contextPercent, limits }
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

