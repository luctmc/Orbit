import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ATTACHMENT_LIMITS, type Attachment } from '@orbit/protocol'

/** Uploaded content is stored locally, outside project code, never interpreted as a command. */
export class Attachments {
  private readonly root: string
  constructor(root: string) { this.root = root }

  directory(missionId: string): string {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(missionId)) throw new Error('Missão inválida')
    const dir = join(this.root, 'attachments', missionId)
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    return dir
  }

  add(missionId: string, input: { name: string; mime: string; data: string }): Attachment {
    if (typeof input.data !== 'string' || input.data.length > Math.ceil(ATTACHMENT_LIMITS.bytes / 3) * 4) throw new Error('Cada anexo pode ter até 4 MB')
    if (input.data.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(input.data) || /=/.test(input.data.slice(0, -2))) throw new Error('Conteúdo do anexo inválido')
    const bytes = Buffer.from(input.data, 'base64')
    if (bytes.length > ATTACHMENT_LIMITS.bytes) throw new Error('Cada anexo pode ter até 4 MB')
    if (bytes.toString('base64') !== input.data) throw new Error('Conteúdo do anexo inválido')
    const name = basename(String(input.name).replaceAll('\\', '/')).replace(/[\x00-\x1f\x7f]/g, '').slice(0, 180)
    if (!name || name === '.' || name === '..') throw new Error('Nome do anexo inválido')
    const dir = this.directory(missionId)
    if (readdirSync(dir).length >= 256) throw new Error('Esta missão chegou ao limite de anexos armazenados')
    const id = randomUUID()
    const fileDir = join(dir, id)
    mkdirSync(fileDir, { mode: 0o700 })
    const item: Attachment = { id, name, mime: String(input.mime).slice(0, 100), size: bytes.length, path: join(fileDir, name === 'metadata.json' ? 'content-metadata.json' : name) }
    try {
      writeFileSync(item.path, bytes, { mode: 0o600, flag: 'wx' })
      writeFileSync(join(fileDir, 'metadata.json'), JSON.stringify(item), { mode: 0o600, flag: 'wx' })
      return item
    } catch (error) {
      rmSync(fileDir, { recursive: true, force: true })
      throw error
    }
  }

  get(missionId: string, id: string): Attachment {
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('Anexo inválido')
    try {
      return JSON.parse(readFileSync(join(this.directory(missionId), id, 'metadata.json'), 'utf8')) as Attachment
    } catch { throw new Error('Anexo não encontrado nesta missão') }
  }

  remove(missionId: string): void {
    rmSync(this.directory(missionId), { recursive: true, force: true })
  }
}
