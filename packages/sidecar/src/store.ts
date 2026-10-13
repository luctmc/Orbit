import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Mission, MissionEvent, MissionMode, Pane, Snapshot, Squad, Workspace } from '@orbit/protocol'
import { BUILTIN_SQUADS } from './squads.ts'

const EVENTS_PER_MISSION = 200

interface PersistedState extends Omit<Snapshot, 'squads'> {
  version: 1
  nextPaneId: number
  /** User squads; builtins live in code. */
  customSquads: Squad[]
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
    for (const mission of this.state.missions) mission.squadId ??= null
    // Processes do not survive a sidecar restart.
    for (const pane of this.state.panes) {
      pane.attention = null
      pane.deliveredAt ??= null
      pane.squadRole ??= null
      if (pane.status !== 'exited') Object.assign(pane, { status: 'exited', pid: null })
    }
  }

  snapshot(): Snapshot {
    const { workspaces, missions, panes, events } = this.state
    return structuredClone({ workspaces, missions, panes, events, squads: this.squads() })
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

  openWorkspace(path: string): Workspace {
    let workspace = this.state.workspaces.find((w) => w.path === path)
    if (!workspace) {
      workspace = { id: randomUUID(), path, name: basename(path) || path, lastOpenedAt: 0 }
      this.state.workspaces.push(workspace)
    }
    workspace.lastOpenedAt = Date.now()
    this.save()
    return { ...workspace }
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
    return { version: 1, nextPaneId: 1, workspaces: [], missions: [], panes: [], events: [], customSquads: [] }
  }
}
