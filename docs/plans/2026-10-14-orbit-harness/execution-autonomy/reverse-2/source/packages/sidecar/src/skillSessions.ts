import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** "Loaded" means text served by Orbit, not observed consumption or verified compliance. */
interface SkillSession {
  selectedNames: string[]
  loaded: Record<string, { sha256: string; servedAt: number }>
}
export class SkillSessions {
  private readonly root: string
  constructor(root: string) { this.root = root }
  private path(paneId: number, epoch: string): string {
    if (!Number.isSafeInteger(paneId) || paneId < 1 || !/^[A-Za-z0-9_-]{1,100}$/.test(epoch)) throw new Error('Execução de skill inválida')
    return join(this.root, `${paneId}-${epoch}.json`)
  }
  get(paneId: number, epoch: string): SkillSession {
    try { return JSON.parse(readFileSync(this.path(paneId, epoch), 'utf8')) as SkillSession }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      return { selectedNames: [], loaded: {} }
    }
  }
  private save(paneId: number, epoch: string, state: SkillSession): void {
    const path = this.path(paneId, epoch)
    mkdirSync(this.root, { recursive: true, mode: 0o700 })
    writeFileSync(`${path}.tmp`, JSON.stringify(state), { mode: 0o600 })
    renameSync(`${path}.tmp`, path)
  }
  start(paneId: number, epoch: string, selectedNames: string[]): void {
    this.save(paneId, epoch, { selectedNames: [...new Set(selectedNames)], loaded: {} })
  }
  loaded(paneId: number, epoch: string, id: string, name: string, sha256: string): void {
    const state = this.get(paneId, epoch)
    if (!state.selectedNames.includes(name)) state.selectedNames.push(name)
    state.loaded[id] = { sha256, servedAt: Date.now() }
    this.save(paneId, epoch, state)
  }
  removePane(paneId: number): void {
    if (!Number.isSafeInteger(paneId) || paneId < 1) throw new Error('Agente de skill inválido')
    if (!existsSync(this.root)) return
    for (const entry of readdirSync(this.root)) if (entry.startsWith(`${paneId}-`) && /\.json(?:\.tmp)?$/.test(entry)) rmSync(join(this.root, entry), { force: true })
  }
}
