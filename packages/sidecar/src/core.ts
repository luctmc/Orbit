import { statSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EFFORTS, WORKSPACE_LIMITS, type AgentCli, type ClientMessage, type Effort, type Mission, type MissionEvent, type MissionEventKind, type MissionMode, type Pane, type ServerMessage, type SpawnPaneRequest, type Squad, type TaskType } from '@orbit/protocol'
import { normalizeRouting } from './routing.ts'
import { hookCommand, removeAgentFiles, writeAgentFiles } from './agentFiles.ts'
import type { AgentLaunch, PaneCommand } from './command.ts'
import { statusFromHook, type HookPayload } from './hooks.ts'
import { PaneManager, type PaneSnapshot } from './panes.ts'
import { crewRole, leadRole, objectiveTask, workspaceNote } from './prompts.ts'
import { normalizeSquad } from './squads.ts'
import { Store } from './store.ts'

const CLIS: readonly AgentCli[] = ['claude', 'codex', 'shell']
const MODES: readonly MissionMode[] = ['livre', 'squad', 'agentica']
const CLI_LABEL: Record<AgentCli, string> = { claude: 'Claude', codex: 'Codex', shell: 'Terminal' }
const EFFORT_LABEL: Record<Effort, string> = { low: 'baixo', medium: 'médio', high: 'alto' }
const HOOK_SCRIPT = process.env.ORBIT_HOOK_SCRIPT ?? fileURLToPath(new URL('../hooks/report.mjs', import.meta.url))

export type Broadcast = (message: ServerMessage) => void

export interface CoreOptions {
  dataDir: string
  shell: string
  broadcast: Broadcast
  /** Tests replace the real agent CLIs with a stand-in command. */
  agentCommand?: (launch: AgentLaunch, shell: string) => PaneCommand
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

  constructor({ dataDir, shell, broadcast, agentCommand }: CoreOptions) {
    this.broadcast = broadcast
    this.dataDir = dataDir
    this.store = new Store(dataDir)
    removeAgentFiles(join(dataDir, 'panes'))
    this.panes = new PaneManager(shell, agentCommand)
    this.panes.on('data', (paneId, data) => this.broadcast({ type: 'pane.data', paneId, data }))
    this.panes.on('resized', (paneId, cols, rows) => this.broadcast({ type: 'pane.resized', paneId, cols, rows }))
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

  /** What a newly connected client needs; terminal contents come per view via `pane.attach`. */
  welcome(): ServerMessage[] {
    return [{ type: 'snapshot', snapshot: this.store.snapshot() }]
  }

  /** A pane's screen for a view that just mounted (see the server's attach handling). */
  paneSnapshot(paneId: number): Promise<PaneSnapshot | null> {
    return this.panes.snapshot(paneId)
  }

  handle(message: ClientMessage): void {
    switch (message.type) {
      case 'workspace.open': {
        const [path] = validFolders([message.path])
        this.broadcast({ type: 'workspace.updated', workspace: this.store.openWorkspace(path!) })
        return
      }
      case 'workspace.create': {
        const folders = validFolders(message.folders)
        this.broadcast({ type: 'workspace.updated', workspace: this.store.createWorkspace(workspaceName(message.name), folders) })
        return
      }
      case 'workspace.update': {
        if (!this.store.workspace(message.workspaceId)) throw new Error('Workspace desconhecido')
        const workspace = this.store.updateWorkspace(message.workspaceId, {
          name: message.name === undefined ? undefined : workspaceName(message.name),
          folders: message.folders === undefined ? undefined : validFolders(message.folders),
        })
        if (workspace) this.broadcast({ type: 'workspace.updated', workspace })
        return
      }
      case 'mission.create': {
        if (!this.store.workspace(message.workspaceId)) throw new Error('Workspace desconhecido')
        if (!MODES.includes(message.mode)) throw new Error(`Modo inválido: ${message.mode}`)
        const title = requireText(message.title, 'título', 120)
        const squad = message.mode === 'squad' ? this.store.squad(message.squadId ?? '') : undefined
        if (message.mode === 'squad' && !squad) throw new Error('Escolha um squad para a missão')
        const mission = this.store.createMission({
          workspaceId: message.workspaceId,
          title,
          objective: message.objective.trim().slice(0, 4000),
          mode: message.mode,
          squadId: squad?.id ?? null,
        })
        this.broadcast({ type: 'mission.updated', mission })
        const opening = squad ? `Squad ${squad.name}. ${mission.objective || 'Sem objetivo descrito.'}` : mission.objective || 'Sem objetivo descrito.'
        this.event(mission.id, 'mission.created', 'Missão iniciada', opening, null)
        // Agentic and squad leads start working on the objective right away.
        const task = mission.mode !== 'livre' && mission.objective ? objectiveTask(mission) : null
        this.spawn({ ...message.lead, missionId: mission.id, role: 'lead', task })
        return
      }
      case 'squad.save': {
        const squad = normalizeSquad(message.squad, this.store.customSquadIds())
        this.store.saveSquad(squad)
        this.broadcast({ type: 'squad.updated', squad })
        return
      }
      case 'squad.delete': {
        if (this.store.squad(message.squadId)?.builtin) throw new Error('Squads que vêm com o Orbit não podem ser apagados')
        if (this.store.deleteSquad(message.squadId)) this.broadcast({ type: 'squad.removed', squadId: message.squadId })
        return
      }
      case 'routing.save': {
        this.store.saveRouting(normalizeRouting(message.routing))
        this.broadcast({ type: 'routing.updated', routing: this.store.routing() })
        return
      }
      case 'routing.reset':
        this.store.saveRouting(null)
        this.broadcast({ type: 'routing.updated', routing: this.store.routing() })
        return
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
      case 'pane.attach':
        return // per-connection: handled by the server
      case 'pane.input':
        this.panes.write(message.paneId, message.data)
        return
      case 'pane.submit':
        // Text and Enter in one write look like a paste to TUIs, which then keep the Enter as a newline.
        if (!this.panes.submit(message.paneId, message.text)) throw new Error(`#${message.paneId} não está rodando`)
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

  routing() {
    return this.store.routing()
  }

  /** The workspace a mission runs in. */
  missionWorkspace(missionId: string) {
    const workspaceId = this.store.mission(missionId)?.workspaceId
    return workspaceId ? this.store.workspace(workspaceId) : undefined
  }

  /** The squad a mission follows, if any. */
  missionSquad(missionId: string): Squad | undefined {
    const squadId = this.store.mission(missionId)?.squadId
    return squadId ? this.store.squad(squadId) : undefined
  }

  spawnHelper(caller: Pane, input: { title: string; task: string; cli: AgentCli; model: string | null; effort?: Effort | null; squadRoleId?: string | null; taskTypeId?: string | null }): Pane {
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

  private spawn(input: SpawnPaneRequest): Pane {
    const mission = this.store.mission(input.missionId)
    if (!mission || mission.status !== 'active') throw new Error('Missão inexistente ou arquivada')
    const workspace = this.store.workspace(mission.workspaceId)
    if (!workspace) throw new Error('Workspace da missão sumiu')

    // A squad role, or a row of the task table, decides who fills the seat: CLI, model, effort.
    const squad = this.missionSquad(mission.id)
    const routing = this.store.routing()
    let squadRole: Squad['roles'][number] | undefined
    let taskType: TaskType | undefined
    if (input.squadRoleId) {
      squadRole = squad?.roles.find((r) => r.id === input.squadRoleId)
      if (!squadRole) throw new Error(`Papel "${input.squadRoleId}" não existe no squad desta missão`)
    } else if (input.taskTypeId) {
      taskType = routing.taskTypes.find((t) => t.id === input.taskTypeId)
      if (!taskType) throw new Error(`Tipo de tarefa "${input.taskTypeId}" não existe na tabela`)
    }
    const request: SpawnPaneRequest = squadRole
      ? { ...input, role: 'crew', cli: squadRole.cli, model: squadRole.model, effort: null }
      : taskType
        ? { ...input, role: 'crew', cli: taskType.cli, model: taskType.model, effort: taskType.effort }
        : input
    if (!CLIS.includes(request.cli)) throw new Error(`Agente inválido: ${request.cli}`)
    if (request.effort && !EFFORTS.includes(request.effort)) throw new Error(`Esforço inválido: ${request.effort}`)

    const id = this.store.allocatePaneId()
    const title = request.title.trim().slice(0, 120) || squadRole?.name || taskType?.name || `${CLI_LABEL[request.cli]} #${id}`
    const token = randomBytes(24).toString('base64url')
    const lead = this.missionPanes(mission.id).find((p) => p.role === 'lead')
    const launch = writeAgentFiles({
      paneDir: this.paneDir(id),
      cli: request.cli,
      model: request.model,
      effort: request.cli === 'shell' ? null : request.effort ?? null,
      endpoint: this.endpoint,
      token,
      hookCommand: hookCommand(process.execPath, HOOK_SCRIPT),
      addDirs: workspace.folders.slice(1),
      rolePrompt: workspaceNote(workspace.folders) + (request.role === 'lead' ? leadRole(mission, { id }, squad, routing) : crewRole(mission, { id }, lead, squadRole, taskType)),
      task: request.task?.trim() ? request.task.trim().slice(0, 20000) : null,
    })

    let pane: Pane
    try {
      pane = this.panes.spawn({
        id,
        request: { ...request, title },
        squadRole: squadRole?.name ?? null,
        taskType: taskType?.name ?? null,
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
    const seat = request.role === 'lead' ? 'líder' : squadRole?.name.toLowerCase() ?? taskType?.name.toLowerCase() ?? 'ajudante'
    const who = [CLI_LABEL[request.cli], request.model, request.effort && `esforço ${EFFORT_LABEL[request.effort]}`, seat].filter(Boolean).join(' · ')
    this.event(mission.id, 'pane.spawned', `Agente #${id} aberto`, `${title} — ${who}`, id)
    return pane
  }

  private closePane(id: number): void {
    if (!this.store.pane(id)) return
    this.panes.forget(id)
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

/** Absolute, existing, distinct folders; at least one, at most WORKSPACE_LIMITS.folders. */
function validFolders(input: unknown): string[] {
  if (!Array.isArray(input) || input.length === 0) throw new Error('Inclua pelo menos uma pasta')
  if (input.length > WORKSPACE_LIMITS.folders) throw new Error(`No máximo ${WORKSPACE_LIMITS.folders} pastas por workspace`)
  const folders: string[] = []
  for (const raw of input) {
    const given = typeof raw === 'string' ? raw.trim() : ''
    if (!isAbsolute(given) || !isDirectory(resolve(given))) throw new Error(`Pasta não encontrada: ${given || '(vazia)'}`)
    const path = resolve(given)
    if (!folders.includes(path)) folders.push(path)
  }
  return folders
}

function workspaceName(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, WORKSPACE_LIMITS.name) : ''
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
