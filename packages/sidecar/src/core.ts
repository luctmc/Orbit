import { statSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import type { AgentCli, ClientMessage, MissionMode, Pane, ServerMessage, SpawnPaneRequest } from '@orbit/protocol'
import { PaneManager } from './panes.ts'
import { Store } from './store.ts'

const CLIS: readonly AgentCli[] = ['claude', 'codex', 'shell']
const MODES: readonly MissionMode[] = ['livre', 'squad', 'agentica']
const CLI_LABEL: Record<AgentCli, string> = { claude: 'Claude', codex: 'Codex', shell: 'Terminal' }

export type Broadcast = (message: ServerMessage) => void

/** Orbit's domain logic: every client message goes through `handle`, every change is broadcast. */
export class OrbitCore {
  readonly store: Store
  private readonly panes: PaneManager
  private readonly broadcast: Broadcast

  constructor(dataDir: string, shell: string, broadcast: Broadcast) {
    this.broadcast = broadcast
    this.store = new Store(dataDir)
    this.panes = new PaneManager(shell)
    this.panes.on('data', (paneId, data) => this.broadcast({ type: 'pane.data', paneId, data }))
    this.panes.on('status', (pane) => this.syncPane(pane))
    this.panes.on('exit', (pane) => {
      if (!this.store.pane(pane.id)) return // closed by the user
      this.syncPane(pane)
      this.event(pane.missionId, 'pane.exited', `#${pane.id} encerrou`, `Processo terminou com código ${pane.exitCode ?? '?'}.`, pane.id)
    })
  }

  /** What a newly connected client needs: the snapshot, then each live pane's scrollback. */
  welcome(): ServerMessage[] {
    const snapshot = this.store.snapshot()
    const scrollbacks: ServerMessage[] = snapshot.panes
      .filter((p) => this.panes.isAlive(p.id))
      .map((p) => ({ type: 'pane.scrollback', paneId: p.id, data: this.panes.scrollback(p.id) }))
    return [{ type: 'snapshot', snapshot }, ...scrollbacks]
  }

  handle(message: ClientMessage): void {
    switch (message.type) {
      case 'workspace.open': {
        const path = resolve(message.path)
        if (!isAbsolute(message.path) || !isDirectory(path)) throw new Error(`Pasta não encontrada: ${message.path}`)
        this.broadcast({ type: 'workspace.updated', workspace: this.store.openWorkspace(path) })
        return
      }
      case 'mission.create': {
        if (!this.store.workspace(message.workspaceId)) throw new Error('Workspace desconhecido')
        if (!MODES.includes(message.mode)) throw new Error(`Modo inválido: ${message.mode}`)
        const title = requireText(message.title, 'título', 120)
        const mission = this.store.createMission({
          workspaceId: message.workspaceId,
          title,
          objective: message.objective.trim().slice(0, 2000),
          mode: message.mode,
        })
        this.broadcast({ type: 'mission.updated', mission })
        this.event(mission.id, 'mission.created', 'Missão iniciada', mission.objective || 'Sem objetivo descrito.', null)
        this.spawn({ ...message.lead, missionId: mission.id, role: 'lead' })
        return
      }
      case 'mission.archive': {
        for (const pane of this.store.snapshot().panes.filter((p) => p.missionId === message.missionId)) {
          this.closePane(pane.id)
        }
        const mission = this.store.updateMission(message.missionId, { status: 'archived' })
        if (mission) this.broadcast({ type: 'mission.updated', mission })
        return
      }
      case 'pane.spawn':
        this.spawn(message.request)
        return
      case 'pane.input':
        this.panes.write(message.paneId, message.data)
        return
      case 'pane.resize':
        this.panes.resize(message.paneId, message.cols, message.rows)
        return
      case 'pane.close':
        this.closePane(message.paneId)
        return
    }
  }

  shutdown(): void {
    this.panes.killAll()
    this.store.flush()
  }

  private spawn(request: SpawnPaneRequest): Pane {
    const mission = this.store.mission(request.missionId)
    if (!mission || mission.status !== 'active') throw new Error('Missão inexistente ou arquivada')
    if (!CLIS.includes(request.cli)) throw new Error(`Agente inválido: ${request.cli}`)
    const workspace = this.store.workspace(mission.workspaceId)
    if (!workspace) throw new Error('Workspace da missão sumiu')

    const id = this.store.allocatePaneId()
    const title = request.title.trim().slice(0, 120) || `${CLI_LABEL[request.cli]} #${id}`
    const pane = this.panes.spawn(id, { ...request, title }, workspace.path)
    this.syncPane(pane)
    const who = [CLI_LABEL[request.cli], request.model, request.role === 'lead' ? 'líder' : 'ajudante'].filter(Boolean).join(' · ')
    this.event(mission.id, 'pane.spawned', `Agente #${id} aberto`, `${title} — ${who}`, id)
    return pane
  }

  private closePane(id: number): void {
    if (!this.store.pane(id)) return
    this.panes.kill(id)
    this.store.removePane(id)
    this.broadcast({ type: 'pane.removed', paneId: id })
  }

  private syncPane(pane: Pane): void {
    if (!this.store.pane(pane.id) && pane.status !== 'starting') return // closed meanwhile
    this.store.upsertPane(pane)
    this.broadcast({ type: 'pane.updated', pane })
  }

  private event(missionId: string, kind: Parameters<Store['addEvent']>[0]['kind'], title: string, body: string, paneId: number | null): void {
    this.broadcast({ type: 'event.added', event: this.store.addEvent({ missionId, kind, title, body, paneId }) })
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function requireText(value: unknown, field: string, max: number): string {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) throw new Error(`Informe o ${field}`)
  return text.slice(0, max)
}
