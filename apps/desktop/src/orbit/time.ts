const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** "agora", "há 5 min", "há 2 h", "ontem", "há 4 d", or a date for older moments. */
export function relativeTime(at: number, now = Date.now()): string {
  const diff = Math.max(0, now - at)
  if (diff < MINUTE) return 'agora'
  if (diff < HOUR) return `há ${Math.floor(diff / MINUTE)} min`
  if (diff < DAY) return `há ${Math.floor(diff / HOUR)} h`
  if (diff < 2 * DAY) return 'ontem'
  if (diff < 7 * DAY) return `há ${Math.floor(diff / DAY)} d`
  return new Date(at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

/** Local midnight of the day containing `at`. */
export function startOfDay(at: number): number {
  const d = new Date(at)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** YYYY-MM-DD in local time, the same key the sidecar files usage under. */
export function dayKey(at: number): string {
  const d = new Date(at)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** "em 40 min", "em 3 h 10 min", "em 2 d" — how long until a limit resets. */
export function untilTime(at: number, now = Date.now()): string {
  const diff = Math.max(0, at - now)
  if (diff < HOUR) return `em ${Math.max(1, Math.round(diff / MINUTE))} min`
  if (diff < DAY) {
    const minutes = Math.round((diff % HOUR) / MINUTE)
    return `em ${Math.floor(diff / HOUR)} h${minutes ? ` ${minutes} min` : ''}`
  }
  return `em ${Math.round(diff / DAY)} d`
}
