import { SCHEDULE_LIMITS, type Schedule, type ScheduleWhen } from '@orbit/protocol'

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/

/** Validates when a schedule runs; `now` refuses a single run already in the past. */
export function normalizeWhen(input: unknown, now = Date.now()): ScheduleWhen {
  const when = (input ?? {}) as Record<string, unknown>
  if (when.kind === 'once') {
    const at = Number(when.at)
    if (!Number.isFinite(at)) throw new Error('Escolha a data e a hora')
    if (at <= now) throw new Error('Escolha um horário no futuro')
    return { kind: 'once', at }
  }
  if (when.kind === 'daily') {
    if (typeof when.time !== 'string' || !HHMM.test(when.time)) throw new Error('Escolha a hora (HH:MM)')
    const days = [...new Set((Array.isArray(when.days) ? when.days : []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
    return { kind: 'daily', time: when.time, days }
  }
  if (when.kind === 'interval') {
    const hours = Number(when.hours)
    if (!Number.isInteger(hours) || hours < 1 || hours > SCHEDULE_LIMITS.maxHours) throw new Error(`A cada quantas horas? De 1 a ${SCHEDULE_LIMITS.maxHours}`)
    return { kind: 'interval', hours }
  }
  throw new Error('Escolha quando a missão roda')
}

/**
 * The next moment a schedule runs after `after` (local time), or null when it is done.
 * Daily schedules skip the days not chosen (none chosen = every day).
 */
export function nextRun(when: ScheduleWhen, after: number): number | null {
  if (when.kind === 'once') return when.at > after ? when.at : null
  if (when.kind === 'interval') return after + when.hours * 3_600_000
  const [hours, minutes] = when.time.split(':').map(Number) as [number, number]
  const day = new Date(after)
  for (let i = 0; i < 8; i++) {
    const at = new Date(day.getFullYear(), day.getMonth(), day.getDate() + i, hours, minutes, 0, 0)
    if (at.getTime() > after && (when.days.length === 0 || when.days.includes(at.getDay()))) return at.getTime()
  }
  return null
}

/** The schedules due at `now`, oldest first. */
export function dueSchedules(schedules: Schedule[], now: number): Schedule[] {
  return schedules.filter((s) => s.enabled && s.nextRunAt !== null && s.nextRunAt <= now).sort((a, b) => a.nextRunAt! - b.nextRunAt!)
}
