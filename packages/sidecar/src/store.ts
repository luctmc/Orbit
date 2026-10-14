import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { EMPTY_USAGE, type Account, type AccountLimits, type AgentCliForRole, type Mission, type MissionEvent, type MissionMode, type Pane, type Routing, type Snapshot, type Squad, type TokenUsage, type UsageDay, type Workspace } from '@orbit/protocol'
import { BUILTIN_ACCOUNTS, migrateLimits } from './accounts.ts'
import { DEFAULT_ROUTING } from './routing.ts'
import { BUILTIN_SQUADS } from './squads.ts'

const EVENTS_PER_MISSION = 200

interface PersistedState extends Omit<Snapshot, 'squads' | 'routing' | 'accounts'> {
  // usageDays and limits are persisted as they are sent.
  version: 1
  nextPaneId: number
  /** User squads; builtins live in code. */
  customSquads: Squad[]
  /** The user's task table; null = Orbit's default. */
  routing: Routing | null
  /** Accounts the person added; the built-in ones live in code. */
  customAccounts: Account[]
  /** Whether Orbit may pick each built-in account by itself (default: yes). */
  builtinAuto: Record<string, boolean>
  /** Catalog items (skills, agents, MCP servers) Orbit's agents may not use. */
  disabledCatalog: string[]
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
    for (const squad of this.state.customSquads) for (const role of squad.roles) Object.assign(role, { skills: role.skills ?? [], onlySkills: role.onlySkills ?? false })
    for (const row of this.state.routing?.taskTypes ?? []) row.onlySkills ??= false
    this.state.disabledCatalog ??= []
    this.state.usageDays ??= []
    this.state.limits = migrateLimits(this.state.limits ?? [])
    this.state.customAccounts ??= []
    this.state.builtinAuto ??= {}
    for (const workspace of this.state.workspaces) workspace.folders ??= [workspace.path]
    for (const mission of this.state.missions) {
      mission.squadId ??= null
      mission.usage ??= { ...EMPTY_USAGE }
    }
    // Processes do not survive a sidecar restart.
    for (const pane of this.state.panes) {
      pane.attention = null
      pane.deliveredAt ??= null
      pane.squadRole ??= null
      pane.taskType ??= null
      pane.effort ??= null
      pane.accountId ??= null
      pane.usage ??= null
      pane.contextPercent = null
      if (pane.status !== 'exited') Object.assign(pane, { status: 'exited', pid: null })
    }
  }

  snapshot(): Snapshot {
    const { workspaces, missions, panes, events, usageDays, limits } = this.state
    return structuredClone({ workspaces, missions, panes, events, squads: this.squads(), routing: this.routing(), usageDays, limits, accounts: this.accounts() })
  }

  /**
   * Adds what an agent used since its last report to its mission and to today's total.
   * Returns the updated mission and day, or nothing when there was nothing new.
   */
  addUsage(missionId: string, cli: AgentCliForRole, delta: TokenUsage, at = Date.now()): { mission: Mission; day: UsageDay } | undefined {
    if (delta.total <= 0 && !delta.costUsd) return undefined
    const mission = this.mission(missionId)
    if (!mission) return undefined
    mission.usage = addUsage(mission.usage, delta)
    const key = dayKey(at)
    let day = this.state.usageDays.find((d) => d.day === key)
    if (!day) {
      day = { day: key, claude: 0, codex: 0 }
      this.state.usageDays.push(day)
      // A year and a bit is all the activity map shows.
      this.state.usageDays = this.state.usageDays.slice(-400)
    }
    day[cli] += delta.total
    this.save()
    return { mission: structuredClone(mission), day: { ...day } }
  }

  setLimits(limits: AccountLimits): AccountLimits[] {
    this.state.limits = [...this.state.limits.filter((l) => l.accountId !== limits.accountId), limits]
    this.save()
    return this.limits()
  }

  disabledCatalog(): string[] {
    return [...this.state.disabledCatalog]
  }

  setCatalogItem(id: string, enabled: boolean): string[] {
    const set = new Set(this.state.disabledCatalog)
    if (enabled) set.delete(id)
    else set.add(id)
    this.state.disabledCatalog = [...set].sort()
    this.save()
    return this.disabledCatalog()
  }

  limits(): AccountLimits[] {
    return structuredClone(this.state.limits)
  }

  accounts(): Account[] {
    return [...this.builtinAccounts(), ...this.state.customAccounts.map((a) => structuredClone(a))]
  }

  account(id: string): Account | undefined {
    return this.accounts().find((a) => a.id === id)
  }

  private builtinAccounts(): Account[] {
    return BUILTIN_ACCOUNTS.map((a) => ({ ...a, auto: this.state.builtinAuto[a.id] ?? true }))
  }

  saveAccount(account: Account): void {
    const index = this.state.customAccounts.findIndex((a) => a.id === account.id)
    if (index === -1) this.state.customAccounts.push(account)
    else this.state.customAccounts[index] = account
    this.save()
  }

  /** Built-in accounts only change whether Orbit may pick them by itself. */
  setBuiltinAuto(id: string, auto: boolean): void {
    this.state.builtinAuto = { ...this.state.builtinAuto, [id]: auto }
    this.save()
  }

  deleteAccount(id: string): void {
    this.state.customAccounts = this.state.customAccounts.filter((a) => a.id !== id)
    this.state.limits = this.state.limits.filter((l) => l.accountId !== id)
    this.save()
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
    const mission: Mission = { id: randomUUID(), status: 'active', createdAt: now, updatedAt: now, usage: { ...EMPTY_USAGE }, ...input }
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
    return { version: 1, nextPaneId: 1, workspaces: [], missions: [], panes: [], events: [], customSquads: [], routing: null, usageDays: [], limits: [], customAccounts: [], builtinAuto: {}, disabledCatalog: [] }
  }
}

/** "app" for one folder, "app + 2" for three. */
function defaultName(folders: string[]): string {
  const first = basename(folders[0] ?? '') || folders[0] || 'workspace'
  return folders.length > 1 ? `${first} + ${folders.length - 1}` : first
}

function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    total: a.total + b.total,
    costUsd: a.costUsd === null && b.costUsd === null ? null : Math.round(((a.costUsd ?? 0) + (b.costUsd ?? 0)) * 1e6) / 1e6,
  }
}

/** Local calendar day, YYYY-MM-DD. */
export function dayKey(at: number): string {
  const d = new Date(at)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
