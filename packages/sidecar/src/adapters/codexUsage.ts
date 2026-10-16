import { closeSync, openSync, readSync, statSync } from 'node:fs'
import { EFFORTS, MODEL_ID, type Effort } from '@orbit/protocol'
import { fromCodexRollout, type UsageReport } from '../usage.ts'
export interface ExecutionIdentity {
  models: string[]
  efforts: Effort[]
  level: 'execution-context' | 'response' | 'unknown'
  complete: boolean
}
interface Cursor {
  inode: number; offset: number; partial: string; session: string | null; malformed: boolean; missingContext: boolean; subagents: boolean
  models: Set<string>; efforts: Set<Effort>; context: boolean; report: UsageReport | null
}
const count = (n: unknown): n is number => Number.isSafeInteger(n) && Number(n) >= 0
/** Reads the resolved owned rollout from its beginning. A tail is never a full-session certificate.
 * Context identity describes the CLI's configured execution, not the provider's internal routing.
 */
export class CodexUsageReader {
  private readonly cursors = new Map<string, Cursor>()
  read(path: string, sessionId: string): { report: UsageReport; complete: boolean; identity: ExecutionIdentity } | null {
    const stat = statSync(path)
    if (!stat.isFile() || stat.size > 64 * 1024 * 1024) return null
    let c = this.cursors.get(path)
    if (c && (c.inode !== stat.ino || stat.size < c.offset)) return null
    if (!c) {
      if (this.cursors.size >= 16) this.cursors.delete(this.cursors.keys().next().value!)
      c = { inode: stat.ino, offset: 0, partial: '', session: null, malformed: false, missingContext: false, subagents: false, models: new Set(), efforts: new Set(), context: false, report: null }
      this.cursors.set(path, c)
    }
    const fd = openSync(path, 'r')
    try {
      const buffer = Buffer.alloc(64 * 1024)
      while (c.offset < stat.size) {
        const bytes = readSync(fd, buffer, 0, Math.min(buffer.length, stat.size - c.offset), c.offset)
        if (!bytes) break
        c.offset += bytes; c.partial += buffer.subarray(0, bytes).toString('latin1')
        let at: number
        while ((at = c.partial.indexOf('\n')) >= 0) {
          const line = Buffer.from(c.partial.slice(0, at), 'latin1').toString('utf8'); c.partial = c.partial.slice(at + 1)
          if (!line.trim()) continue
          let event: any
          try { event = JSON.parse(line) } catch { c.malformed = true; continue }
          const p = event.payload
          if (event.type === 'session_meta') {
            if (c.session && c.session !== p?.id) c.malformed = true
            c.session = typeof p?.id === 'string' ? p.id : null
          }
          if (event.type === 'turn_context') {
            c.context = typeof p?.turn_id === 'string' && typeof p.model === 'string' && MODEL_ID.test(p.model) && EFFORTS.includes(p.effort)
            if (typeof p?.model === 'string' && MODEL_ID.test(p.model)) c.models.add(p.model)
            if (EFFORTS.includes(p?.effort)) c.efforts.add(p.effort)
            if (!c.context || c.models.size > 32 || c.efforts.size > EFFORTS.length) c.missingContext = true
          }
          if (event.type !== 'event_msg') continue
          if (typeof p?.type === 'string' && p.type.startsWith('collab_agent_spawn')) c.subagents = true
          if (p?.type !== 'token_count' || !p.info?.total_token_usage) continue
          const t = p.info.total_token_usage
          if (!c.context) c.missingContext = true
          if (!['input_tokens', 'output_tokens', 'total_tokens', 'cached_input_tokens'].every(k => count(t[k])) || t.input_tokens + t.output_tokens !== t.total_tokens || t.cached_input_tokens > t.input_tokens || t.cache_write_input_tokens !== undefined && !count(t.cache_write_input_tokens)) { c.malformed = true; continue }
          const report = fromCodexRollout(line)
          if (c.report?.usage && report.usage && (['input', 'output', 'total', 'cacheRead'] as const).some(k => report.usage![k] < c!.report!.usage![k])) c.malformed = true
          // cache_write_input_tokens has serde(default) in the native protocol.
          if (report.observed) report.observed.cacheWrite = true
          c.report = report
        }
        if (c.partial.length > 2 * 1024 * 1024 || c.models.size > 32) return null
      }
    } finally { closeSync(fd) }
    if (!c.report || c.session !== sessionId) return null
    const complete = !c.malformed && !c.partial && !c.subagents
    const report = structuredClone(c.report)
    if (!complete && report.observed) for (const key of ['input', 'output', 'total', 'cacheRead', 'cacheWrite'] as const) report.observed[key] = false
    return { report, complete, identity: { models: [...c.models].sort(), efforts: [...c.efforts].sort(), level: c.models.size ? 'execution-context' : 'unknown', complete: complete && !c.missingContext && c.models.size === 1 && c.efforts.size === 1 } }
  }
}
