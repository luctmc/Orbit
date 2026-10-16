import { closeSync, openSync, readSync, statSync } from 'node:fs'
import type { TokenUsage } from '@orbit/protocol'

const KEYS = ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'] as const
type Counters = Record<typeof KEYS[number], number>
interface Cursor { inode: number; offset: number; partial: string; responses: Map<string, Counters>; pending: Set<string>; incomplete: boolean; nativeSubagents: boolean; models: Set<string> }
const valid = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0

/** Read only a resolved account transcript, incrementally. Deduplicate provider response IDs.
 * Current-context status fields are deliberately not a consumption source.
 */
export class ClaudeUsageReader {
  private readonly cursors = new Map<string, Cursor>()
  read(path: string): { usage: TokenUsage; complete: boolean; responses: number; models: string[] } | null {
    const stat = statSync(path)
    if (!stat.isFile() || stat.size > 64 * 1024 * 1024) return null
    let cursor = this.cursors.get(path)
    if (cursor && (cursor.inode !== stat.ino || stat.size < cursor.offset)) return null // do not certify a replaced/truncated history
    if (!cursor) {
      if (this.cursors.size >= 16) this.cursors.delete(this.cursors.keys().next().value!)
      cursor = { inode: stat.ino, offset: 0, partial: '', responses: new Map(), pending: new Set(), incomplete: false, nativeSubagents: false, models: new Set() }
      this.cursors.set(path, cursor)
    }
    const fd = openSync(path, 'r')
    try {
      const buffer = Buffer.alloc(64 * 1024)
      while (cursor.offset < stat.size) {
        const bytes = readSync(fd, buffer, 0, Math.min(buffer.length, stat.size - cursor.offset), cursor.offset)
        if (!bytes) break
        cursor.offset += bytes
        // JSON structural characters are ASCII. Buffer partial bytes until a newline so UTF-8
        // multibyte characters cannot be split across independent decodes.
        cursor.partial += buffer.subarray(0, bytes).toString('latin1')
        let newline
        while ((newline = cursor.partial.indexOf('\n')) !== -1) {
          const line = Buffer.from(cursor.partial.slice(0, newline), 'latin1').toString('utf8')
          cursor.partial = cursor.partial.slice(newline + 1)
          if (!line.trim()) continue
          let entry: any
          try { entry = JSON.parse(line) } catch { cursor.incomplete = true; continue }
          if (entry.type !== 'assistant' || entry.isSidechain || entry.parent_tool_use_id) continue
          const message = entry.message
          if (Array.isArray(message?.content) && message.content.some((p: any) => p?.type === 'tool_use' && ['Agent', 'Task'].includes(p.name))) cursor.nativeSubagents = true
          if (!message?.stop_reason) { if (typeof message?.id === 'string' && !cursor.responses.has(message.id)) cursor.pending.add(message.id); continue }
          if (typeof message.id !== 'string' || !KEYS.every(key => valid(message.usage?.[key]))) { cursor.incomplete = true; continue }
          if (cursor.responses.size >= 50000 && !cursor.responses.has(message.id)) return null
          const old = cursor.responses.get(message.id)
          const counts = Object.fromEntries(KEYS.map(key => [key, Math.max(old?.[key] ?? 0, message.usage[key])])) as Counters
          cursor.responses.set(message.id, counts)
          cursor.pending.delete(message.id)
          if (typeof message.model === 'string') cursor.models.add(message.model)
        }
        if (cursor.partial.length > 2 * 1024 * 1024) return null
      }
    } finally { closeSync(fd) }
    if (!cursor.responses.size) return null
    const sum = Object.fromEntries(KEYS.map(key => [key, [...cursor.responses.values()].reduce((n, u) => n + u[key], 0)])) as Counters
    const input = sum.input_tokens + sum.cache_read_input_tokens + sum.cache_creation_input_tokens, output = sum.output_tokens
    if (![...Object.values(sum), input, input + output].every(valid)) return null
    return { usage: { input, output, cacheRead: sum.cache_read_input_tokens, cacheWrite: sum.cache_creation_input_tokens, total: input + output, costUsd: null }, complete: !cursor.incomplete && !cursor.partial && !cursor.nativeSubagents && !cursor.pending.size, responses: cursor.responses.size, models: [...cursor.models].sort() }
  }
}
