import { statSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AgentCli, ClientMessage, Mission, MissionEvent, MissionEventKind, MissionMode, Pane, ServerMessage, SpawnPaneRequest } from '@orbit/protocol'
import { hookCommand, removeAgentFiles, writeAgentFiles } from './agentFiles.ts'
import { statusFromHook, type HookPayload } from './hooks.ts'
import { PaneManager } from './panes.ts'
import { crewRole, leadRole, objectiveTask } from './prompts.ts'
import { Store } from './store.ts'

const CLIS: readonly AgentCli[] = ['claude', 'codex', 'shell']
const MODES: readonly MissionMode[] = ['livre', 'squad', 'agentica']
const CLI_LABEL: Record<AgentCli, string> = { claude: 'Claude', codex: 'Codex', shell: 'Terminal' }
const HOOK_SCRIPT = process.env.ORBIT_HOOK_SCRIPT ?? fileURLToPath(new URL('../hooks/report.mjs', import.meta.url))

export type Broadcast = (message: ServerMessage) => void

export interface CoreOptions {
  dataDir: string
  shell: string
  broadcast: Broadcast
}

/** Orbit's domain logic: UI messages, MCP tool calls and hook reports all land here. */
export class OrbitCore {
  readonly store: Store
  private readonly panes: PaneManager
  private readonly broadcast: Broadcast
  private readonly dataDir: string
  /** Per-pane secret used by that agent's MCP client and hooks. Lives only in memory. */
  private readonly paneTokens = new Map<string, number>()
  private endpoint = ''

  constructor({ dataDir, shell, broadcast }: CoreOptions) {
    this.broadcast = broadcast
    this.dataDir = dataDir
    this.store = new Store(dataDir)
    removeAgentFiles(join(dataDir, 'panes'))
    this.panes = new PaneManager(shell)
    this.panes.on('data', (paneId, data) => this.broadcast({ type: 'pane.data', paneId, data }))
    this.panes.on('status', (pane, previous) => {
      this.syncPane(pane)
      if (pane.status === 'waiting' && previous !== 'waiting') {
        this.event(pane.missionId, 'pane.waiting', `#${pane.id} espera você`, pane.attention ?? 'O agente precisa de você.', pane.id)
      }
    })
    this.panes.on('exit', (pane) => {
      if (!this.store.pane(pane.id)) return // closed by the user
      this.syncPane(pane)
      this.event(pane.missionId, 'pane.exited', `#${pane.id} encerrou`, `Processo terminou com código ${pane.exitCode ?? '?'}.`, pane.id)
    })
  }

  /** Base URL agents use to reach this sidecar; known once the server listens. */
  setEndpoint(endpoint: string): void {
    this.endpoint = endpoint
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
          objective: message.objective.trim().slice(0, 4000),
          mode: message.mode,
        })
        this.broadcast({ type: 'mission.updated', mission })
        this.event(mission.id, 'mission.created', 'Missão iniciada', mission.objective || 'Sem objetivo descrito.', null)
        const task = mission.mode === 'agentica' && mission.objective ? objectiveTask(mission) : null
        this.spawn({ ...message.lead, missionId: mission.id, role: 'lead', task })
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

  // ---- Agent-facing API (MCP tools and hooks) ----

  /** The pane a bearer token belongs to, if it is still open. */
  identify(token: string | undefined): Pane | undefined {
    const id = token ? this.paneTokens.get(token) : undefined
    return id === undefined ? undefined : this.store.pane(id)
  }

  mission(id: string): Mission | undefined {
    return this.store.mission(id)
  }

  missionPanes(missionId: string): Pane[] {
    return this.store.snapshot().panes.filter((p) => p.missionId === missionId)
  }

  missionEvents(missionId: string, kind?: MissionEventKind): MissionEvent[] {
    return this.store.snapshot().events.filter((e) => e.missionId === missionId && (!kind || e.kind === kind))
  }

  spawnHelper(caller: Pane, input: { title: string; task: string; cli: AgentCli; model: string | null }): Pane {
    return this.spawn({ missionId: caller.missionId, role: 'crew', ...input })
  }

  /** Sends text to another agent of the same mission, as if typed by a person. */
  sendTo(caller: Pane, targetId: number, text: string): void {
    const target = this.sameMission(caller, targetId)
    if (!this.panes.submit(target.id, `[Orbit] Mensagem de #${caller.id}: ${text}`)) throw new Error(`#${targetId} não está rodando`)
  }

  /** The lead closes a helper of its own mission (kills the process, removes the pane). */
  closeHelper(caller: Pane, targetId: number): void {
    const target = this.sameMission(caller, targetId)
    if (target.role === 'lead') throw new Error('O líder não pode ser fechado por aqui')
    this.closePane(target.id)
  }

  readScreen(caller: Pane, targetId: number, lines: number): string {
    const target = this.sameMission(caller, targetId)
    return this.panes.screenText(target.id, lines)
  }

  /** A helper's result: recorded in the mission flow and typed into the lead's terminal. */
  handoff(caller: Pane, summary: string, details: string): { deliveredTo: number | null } {
    const text = summary.trim().slice(0, 2000)
    if (!text) throw new Error('O resumo do retorno está vazio')
    const body = details.trim() ? `${text}\n\n${details.trim().slice(0, 20000)}` : text
    this.event(caller.missionId, 'handoff', `Retorno de #${caller.id}`, body, caller.id)
    this.panes.markDelivered(caller.id)

    const lead = this.missionPanes(caller.missionId).find((p) => p.role === 'lead' && p.id !== caller.id && this.panes.isAlive(p.id))
    if (!lead) return { deliveredTo: null }
    const more = details.trim() ? ' (detalhes em handoff_list)' : ''
    this.panes.submit(lead.id, `[Orbit] Retorno de #${caller.id} (${caller.title}): ${text}${more}`)
    return { deliveredTo: lead.id }
  }

  hookReport(paneId: number, payload: HookPayload): void {
    const next = statusFromHook(payload)
    if (next) this.panes.report(paneId, next.status, next.attention)
  }

  shutdown(): void {
    this.panes.killAll()
    this.store.flush()
  }

  // ---- internals ----

  private spawn(request: SpawnPaneRequest): Pane {
    const mission = this.store.mission(request.missionId)
    if (!mission || mission.status !== 'active') throw new Error('Missão inexistente ou arquivada')
    if (!CLIS.includes(request.cli)) throw new Error(`Agente inválido: ${request.cli}`)
    const workspace = this.store.workspace(mission.workspaceId)
    if (!workspace) throw new Error('Workspace da missão sumiu')

    const id = this.store.allocatePaneId()
    const title = request.title.trim().slice(0, 120) || `${CLI_LABEL[request.cli]} #${id}`
    const token = randomBytes(24).toString('base64url')
    const lead = this.missionPanes(mission.id).find((p) => p.role === 'lead')
    const draft = { id, title, role: request.role } as Pane
    const launch = writeAgentFiles({
      paneDir: this.paneDir(id),
      cli: request.cli,
      model: request.model,
      endpoint: this.endpoint,
      token,
      hookCommand: hookCommand(process.execPath, HOOK_SCRIPT),
      rolePrompt: request.role === 'lead' ? leadRole(mission, draft) : crewRole(mission, draft, lead),
      task: request.task?.trim() ? request.task.trim().slice(0, 20000) : null,
    })

    let pane: Pane
    try {
      pane = this.panes.spawn({
        id,
        request: { ...request, title },
        cwd: workspace.path,
        launch,
        hookDriven: request.cli === 'claude',
        env: {
          ORBIT_PANE_ID: String(id),
          ORBIT_MISSION_ID: mission.id,
          ORBIT_PANE_TOKEN: token,
          ORBIT_HOOK_URL: `${this.endpoint}/hooks`,
          // Several agents updating the same CLI install at once can leave it broken.
          DISABLE_AUTOUPDATER: '1',
        },
      })
    } catch (error) {
      removeAgentFiles(this.paneDir(id))
      throw error
    }
    this.paneTokens.set(token, id)
    this.syncPane(pane)
    const who = [CLI_LABEL[request.cli], request.model, request.role === 'lead' ? 'líder' : 'ajudante'].filter(Boolean).join(' · ')
    this.event(mission.id, 'pane.spawned', `Agente #${id} aberto`, `${title} — ${who}`, id)
    return pane
  }

  private closePane(id: number): void {
    if (!this.store.pane(id)) return
    this.panes.kill(id)
    this.store.removePane(id)
    for (const [token, paneId] of this.paneTokens) if (paneId === id) this.paneTokens.delete(token)
    removeAgentFiles(this.paneDir(id))
    this.broadcast({ type: 'pane.removed', paneId: id })
  }

  private sameMission(caller: Pane, targetId: number): Pane {
    const target = this.store.pane(targetId)
    if (!target || target.missionId !== caller.missionId) throw new Error(`#${targetId} não faz parte desta missão`)
    if (target.id === caller.id) throw new Error('Esse agente é você')
    return target
  }

  private paneDir(id: number): string {
    return join(this.dataDir, 'panes', String(id))
  }

  private syncPane(pane: Pane): void {
    if (!this.store.pane(pane.id) && pane.status !== 'starting') return // closed meanwhile
    this.store.upsertPane(pane)
    this.broadcast({ type: 'pane.updated', pane })
  }

  private event(missionId: string, kind: MissionEventKind, title: string, body: string, paneId: number | null): void {
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
