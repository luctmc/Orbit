import type { RateWindow } from '@orbit/protocol'

/**
 * Claude Code's `/usage`, run headless (`claude -p "/usage"`), is a local command: no model call,
 * no cost. Its text tells a subscription's limits even when no Claude agent is open:
 *
 *   Current session: 75% used · resets Oct 14 at 5:39pm (America/Sao_Paulo)
 *   Current week (all models): 73% used · resets Oct 18 at 8:59pm (America/Sao_Paulo)
 */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** Minutes a time zone is ahead of UTC at a given moment. */
function zoneOffset(at: number, zone: string): number {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(new Date(at)).map((p) => [p.type, p.value]))
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute))
  return Math.round((asUtc - Math.floor(at / 60_000) * 60_000) / 60_000)
}

/** "Oct 14 at 5:39pm (America/Sao_Paulo)" as epoch ms: the next such moment from `now`. */
export function parseReset(text: string, now: number): number | null {
  const match = /([A-Za-z]{3})[a-z]*\s+(\d{1,2})(?:,?\s+(\d{4}))?\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s*\(([^)]+)\))?/i.exec(text)
  if (!match) return null
  const month = MONTHS.indexOf(match[1]!.toLowerCase())
  if (month < 0) return null
  let hour = Number(match[4]) % 12
  if (match[6]?.toLowerCase() === 'pm') hour += 12
  if (!match[6] && Number(match[4]) === 12) hour = 12
  const minute = Number(match[5] ?? 0)
  const zone = match[7]?.trim()
  const build = (year: number) => {
    const wall = Date.UTC(year, month, Number(match[2]), hour, minute)
    if (!zone) return new Date(year, month, Number(match[2]), hour, minute).getTime()
    try {
      return wall - zoneOffset(wall, zone) * 60_000
    } catch {
      return new Date(year, month, Number(match[2]), hour, minute).getTime()
    }
  }
  const year = match[3] ? Number(match[3]) : new Date(now).getFullYear()
  const at = build(year)
  // A reset is always ahead: "Jan 2" seen on Dec 30 is next year.
  return !match[3] && at < now - 86_400_000 ? build(year + 1) : at
}

export interface ClaudeUsage {
  fiveHour: RateWindow | null
  weekly: RateWindow | null
}

/** The session (5-hour) and weekly windows in `/usage`'s text; null when it shows no plan limits. */
export function parseClaudeUsage(text: string, now = Date.now()): ClaudeUsage | null {
  const window = (pattern: RegExp, minutes: number): RateWindow | null => {
    const line = text.split('\n').find((l) => pattern.test(l))
    const used = line && /(\d+(?:\.\d+)?)%\s*used/i.exec(line)
    if (!line || !used) return null
    const resetsAt = parseReset(line.slice(line.toLowerCase().indexOf('resets')), now)
    const percent = Number(used[1])
    return resetsAt !== null && Number.isFinite(percent) && percent >= 0 && percent <= 100 ? { usedPercent: percent, resetsAt, windowMinutes: minutes } : null
  }
  const fiveHour = window(/current session/i, 300)
  const weekly = window(/current week \(all models\)|current week:/i, 10_080)
  return fiveHour || weekly ? { fiveHour, weekly } : null
}

/** The command that prints `/usage` without hooks, MCP servers or a saved session. */
export const CLAUDE_USAGE_COMMAND = `claude -p "/usage" --settings '{"disableAllHooks":true}' --strict-mcp-config --no-session-persistence --output-format json < /dev/null`

/** `/usage`'s text from the command's JSON output. */
export function usageText(stdout: string): string | null {
  try {
    const out = JSON.parse(stdout) as { result?: unknown; is_error?: boolean }
    return !out.is_error && typeof out.result === 'string' ? out.result : null
  } catch {
    return null
  }
}
