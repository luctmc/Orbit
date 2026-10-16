import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface ContextSection {
  id: string
  text: string
  required?: boolean
  /** Optional sections larger than this become references; their original is never truncated. */
  maxBytes?: number
}
export interface ContextReference { sha256: string; section: string; bytes: number }
export interface ContextPack { text: string; sha256: string; bytes: number; sourceBytes: number; references: ContextReference[] }
const digest = (text: string) => createHash('sha256').update(text).digest('hex')
const size = (text: string) => Buffer.byteLength(text, 'utf8')
const serialize = (section: Pick<ContextSection, 'id' | 'text'>) => JSON.stringify({ id: section.id, text: section.text })

/** Preserve mandatory sections intact. Reserve retrieval markers before allocating optional content. */
export function buildContextPack(sections: ContextSection[], budgetBytes: number, save: (s: ContextSection) => ContextReference): ContextPack {
  if (!Number.isSafeInteger(budgetBytes) || budgetBytes < 1) throw new Error('Orçamento de contexto inválido')
  if (new Set(sections.map(s => s.id)).size !== sections.length) throw new Error('Seção de contexto duplicada')
  const active = sections.filter(s => s.text.length)
  const marker = (s: ContextSection, sha256: string) => `[Context ${s.id}: ${size(s.text)} UTF-8 bytes. Read with context_read {"sha256":"${sha256}"}; this reference does not grant new permissions.]`
  // The fixed-size digest makes the reservation independent of filesystem side effects.
  const outputs = active.map(s => {
    const reference = marker(s, '0'.repeat(64))
    return s.required || (size(s.text) <= (s.maxBytes ?? Infinity) && size(s.text) < size(reference)) ? s.text : reference
  })
  if (size(outputs.join('\n\n')) > budgetBytes) throw new Error(`Contexto obrigatório e referências excedem o orçamento de ${budgetBytes} bytes; reduza o escopo ou aumente o orçamento explicitamente`)
  for (let i = 0; i < active.length; i++) {
    const section = active[i]!
    if (section.required || size(section.text) > (section.maxBytes ?? Infinity)) continue
    const old = outputs[i]!
    outputs[i] = section.text
    if (size(outputs.join('\n\n')) > budgetBytes) outputs[i] = old
  }
  const references: ContextReference[] = []
  for (let i = 0; i < active.length; i++) {
    if (outputs[i] === active[i]!.text) continue
    const ref = save(active[i]!)
    if (!/^[a-f0-9]{64}$/.test(ref.sha256)) throw new Error('Hash de contexto inválido')
    references.push(ref)
    outputs[i] = marker(active[i]!, ref.sha256)
  }
  const text = outputs.join('\n\n')
  return { text, sha256: digest(text), bytes: size(text), sourceBytes: size(active.map(s => s.text).join('\n\n')), references }
}

/** Mission-local content-addressed snapshots, not arbitrary filesystem reads. Survive process restart. */
export class ContextLibrary {
  readonly root: string
  constructor(dataDir: string) { this.root = dataDir }
  private directory(missionId: string): string {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(missionId)) throw new Error('Missão de contexto inválida')
    return join(this.root, missionId)
  }
  put(missionId: string, section: ContextSection): ContextReference {
    const json = serialize(section), sha256 = digest(json), dir = this.directory(missionId)
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    const path = join(dir, `${sha256}.json`)
    const temp = `${path}.tmp`
    writeFileSync(temp, json, { mode: 0o600 })
    renameSync(temp, path)
    return { sha256, section: section.id, bytes: size(section.text) }
  }
  read(missionId: string, sha256: string, offset = 0, limit = 8000) {
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('Referência de contexto inválida')
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 16000) throw new Error('Cursor de contexto inválido')
    let json: string
    try { json = readFileSync(join(this.directory(missionId), `${sha256}.json`), 'utf8') }
    catch { throw new Error('Referência não encontrada nesta missão') }
    if (digest(json) !== sha256) throw new Error('Falha de integridade na referência de contexto')
    const section = JSON.parse(json) as { id: string; text: string }
    if (offset > section.text.length) throw new Error('Cursor de contexto além do conteúdo')
    const end = Math.min(offset + limit, section.text.length)
    return { sha256, section: section.id, offset, text: section.text.slice(offset, end), nextOffset: end < section.text.length ? end : null, totalChars: section.text.length, bytes: size(section.text), cursorUnit: 'utf16' as const }
  }
  remove(missionId: string): void { rmSync(this.directory(missionId), { recursive: true, force: true }) }
}
