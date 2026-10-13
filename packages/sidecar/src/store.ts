import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Mission, MissionEvent, MissionMode, Pane, Routing, Snapshot, Squad, Workspace } from '@orbit/protocol'
import { DEFAULT_ROUTING } from './routing.ts'
import { BUILTIN_SQUADS } from './squads.ts'

const EVENTS_PER_MISSION = 200

interface PersistedState extends Omit<Snapshot, 'squads' | 'routing'> {
  version: 1
  nextPaneId: number
  /** User squads; builtins live in code. */
  customSquads: Squad[]
  /** The user's task table; null = Orbit's default. */
  routing: Routing | null
}

/** Durable state in `<dataDir>/state.json`. Writes are debounced and atomic (tmp + rename). */
export class Store {
  private state: PersistedState
  private readonly file: string
  private saveTimer: NodeJS.Timeout | null = null

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true })
    this.file = join(dataDir, 'state.json')
    this.state = this.load()
    // Older state files predate some fields.
    this.state.customSquads ??= []
    this.state.routing ??= null
    for (const workspace of this.state.workspaces) workspace.folders ??= [workspace.path]
    for (const mission of this.state.missions) mission.squadId ??= null
    // Processes do not survive a sidecar restart.
    for (const pane of this.state.panes) {
      pane.attention = null
      pane.deliveredAt ??= null
      pane.squadRole ??= null
      pane.taskType ??= null
      pane.effort ??= null
      if (pane.status !== 'exited') Object.assign(pane, { status: 'exited', pid: null })
    }
  }

  snapshot(): Snapshot {
    const { workspaces, missions, panes, events } = this.state
    return structuredClone({ workspaces, missions, panes, events, squads: this.squads(), routing: this.routing() })
  }

  routing(): Routing {
    return structuredClone(this.state.routing ?? DEFAULT_ROUTING)
  }

  /** null restores the default table. */
  saveRouting(routing: Routing | null): void {
    this.state.routing = routing
    this.save()
  }

  squads(): Squad[] {
    return [...BUILTIN_SQUADS, ...this.state.customSquads].map((s) => structuredClone(s))
  }

  squad(id: string): Squad | undefined {
    const squad = BUILTIN_SQUADS.find((s) => s.id === id) ?? this.state.customSquads.find((s) => s.id === id)
    return squad && structuredClone(squad)
  }

  customSquadIds(): Set<string> {
    return new Set(this.state.customSquads.map((s) => s.id))
  }

  saveSquad(squad: Squad): void {
    const index = this.state.customSquads.findIndex((s) => s.id === squad.id)
    if (index === -1) this.state.customSquads.push(squad)
    else this.state.customSquads[index] = squad
    this.save()
  }

  deleteSquad(id: string): boolean {
    const before = this.state.customSquads.length
    this.state.customSquads = this.state.customSquads.filter((s) => s.id !== id)
    this.save()
    return this.state.customSquads.length !== before
  }

  /** A single-folder workspace: reuses the one whose only folder is `path`. */
  openWorkspace(path: string): Workspace {
    const existing = this.state.workspaces.find((w) => w.folders.length === 1 && w.path === path)
    if (existing) {
      existing.lastOpenedAt = Date.now()
      this.save()
      return structuredClone(existing)
    }
    return this.createWorkspace('', [path])
  }

  /** `folders` are validated by the caller; the first one is the main folder. */
  createWorkspace(name: string, folders: string[]): Workspace {
    const workspace: Workspace = { id: randomUUID(), path: folders[0]!, folders: [...folders], name: name || defaultName(folders), lastOpenedAt: Date.now() }
    this.state.workspaces.push(workspace)
    this.save()
    return structuredClone(workspace)
  }

  updateWorkspace(id: string, patch: { name?: string; folders?: string[] }): Workspace | undefined {
    const workspace = this.workspace(id)
    if (!workspace) return undefined
    if (patch.folders) Object.assign(workspace, { folders: [...patch.folders], path: patch.folders[0] })
    if (patch.name !== undefined) workspace.name = patch.name || defaultName(workspace.folders)
    this.save()
    return structuredClone(workspace)
  }

  workspace(id: string): Workspace | undefined {
    return this.state.workspaces.find((w) => w.id === id)
  }

  createMission(input: { workspaceId: string; title: string; objective: string; mode: MissionMode; squadId: string | null }): Mission {
    const now = Date.now()
    const mission: Mission = { id: randomUUID(), status: 'active', createdAt: now, updatedAt: now, ...input }
    this.state.missions.push(mission)
    this.save()
    return { ...mission }
  }

  mission(id: string): Mission | undefined {
    return this.state.missions.find((m) => m.id === id)
  }

  updateMission(id: string, patch: Partial<Pick<Mission, 'status' | 'title' | 'objective'>>): Mission | undefined {
    const mission = this.mission(id)
    if (!mission) return undefined
    Object.assign(mission, patch, { updatedAt: Date.now() })
    this.save()
    return { ...mission }
  }

  allocatePaneId(): number {
    const id = this.state.nextPaneId++
    this.save()
    return id
  }

  pane(id: number): Pane | undefined {
    return this.state.panes.find((p) => p.id === id)
  }

  upsertPane(pane: Pane): void {
    const index = this.state.panes.findIndex((p) => p.id === pane.id)
    if (index === -1) this.state.panes.push({ ...pane })
    else this.state.panes[index] = { ...pane }
    this.save()
  }

  removePane(id: number): void {
    this.state.panes = this.state.panes.filter((p) => p.id !== id)
    this.save()
  }

  addEvent(input: Omit<MissionEvent, 'id' | 'at'>): MissionEvent {
    const event: MissionEvent = { id: randomUUID(), at: Date.now(), ...input }
    this.state.events.push(event)
    const forMission = this.state.events.filter((e) => e.missionId === event.missionId)
    if (forMission.length > EVENTS_PER_MISSION) {
      const drop = new Set(forMission.slice(0, forMission.length - EVENTS_PER_MISSION).map((e) => e.id))
      this.state.events = this.state.events.filter((e) => !drop.has(e.id))
    }
    this.save()
    return { ...event }
  }

  /** Writes pending changes now; call on shutdown. */
  flush(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(this.state, null, 2), { mode: 0o600 })
    renameSync(tmp, this.file)
  }

  private save(): void {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => this.flush(), 250)
  }

  private load(): PersistedState {
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as PersistedState
      if (parsed.version === 1) return parsed
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    return { version: 1, nextPaneId: 1, workspaces: [], missions: [], panes: [], events: [], customSquads: [], routing: null }
  }
}

/** "app" for one folder, "app + 2" for three. */
function defaultName(folders: string[]): string {
  const first = basename(folders[0] ?? '') || folders[0] || 'workspace'
  return folders.length > 1 ? `${first} + ${folders.length - 1}` : first
}
