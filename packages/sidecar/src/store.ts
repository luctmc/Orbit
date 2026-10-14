import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { EMPTY_USAGE, type Account, type Card, type CardColumn, type MissionTemplate, type Schedule, type AccountLimits, type AgentCliForRole, type Mission, type MissionEvent, type OrbitSettings, type MissionMode, type Pane, type Routing, type Snapshot, type SpawnPaneRequest, type Squad, type TokenUsage, type UsageDay, type Workspace } from '@orbit/protocol'
import { BUILTIN_ACCOUNTS, migrateLimits } from './accounts.ts'
import { DEFAULT_ROUTING, FACTORY_METHODS } from './routing.ts'
import { BUILTIN_SQUADS } from './squads.ts'

const EVENTS_PER_MISSION = 200
const DEFAULT_SETTINGS: OrbitSettings = { resumeOnStart: true }

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
  /** How each pane was opened (without its first task), to restart or resume it later. */
  paneSpecs: Record<string, SpawnPaneRequest>
}

/** Durable state in `<dataDir>/state.json`. Writes are debounced and atomic (tmp + rename). */
export class Store {
  private state: PersistedState
  private readonly file: string
  /** Agents that were running when Orbit last stopped (they can be brought back). */
  readonly wasRunning: number[] = []
  private saveTimer: NodeJS.Timeout | null = null

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true })
    this.file = join(dataDir, 'state.json')
    this.state = this.load()
    // Older state files predate some fields.
    this.state.customSquads ??= []
    this.state.routing ??= null
    for (const squad of this.state.customSquads) for (const role of squad.roles) Object.assign(role, { skills: role.skills ?? [], onlySkills: role.onlySkills ?? false })
    for (const row of this.state.routing?.taskTypes ?? []) {
      row.onlySkills ??= false
      row.method ??= FACTORY_METHODS[row.id]?.method ?? ''
      row.readOnly ??= FACTORY_METHODS[row.id]?.readOnly ?? false
    }
    this.state.settings ??= { ...DEFAULT_SETTINGS }
    this.state.disabledCatalog ??= []
    this.state.paneSpecs ??= {}
    this.state.cards ??= []
    this.state.templates ??= []
    this.state.schedules ??= []
    this.state.usageDays ??= []
    this.state.limits = migrateLimits(this.state.limits ?? [])
    this.state.customAccounts ??= []
    this.state.builtinAuto ??= {}
    for (const workspace of this.state.workspaces) {
      workspace.folders ??= [workspace.path]
      workspace.instructions ??= ''
    }
    for (const mission of this.state.missions) {
      mission.squadId ??= null
      mission.usage ??= { ...EMPTY_USAGE }
      mission.git ??= null
      mission.scheduleId ??= null
      mission.allowedClis ??= ['claude', 'codex']
      mission.readyAt ??= null
      mission.readySummary ??= null
    }
    // Processes do not survive a sidecar restart.
    for (const pane of this.state.panes) {
      pane.attention = null
      pane.choices = null
      pane.deliveredAt ??= null
      pane.handoffStatus ??= pane.deliveredAt === null ? null : 'done'
      pane.assignedBy ??= null
      pane.squadRole ??= null
      pane.taskType ??= null
      pane.effort ??= null
      pane.accountId ??= null
      pane.sessionId ??= null
      pane.branch ??= null
      pane.usage ??= null
      pane.contextPercent = null
      if (pane.status !== 'exited') {
        this.wasRunning.push(pane.id)
        Object.assign(pane, { status: 'exited', pid: null })
      }
    }
  }

  snapshot(): Snapshot {
    const { workspaces, missions, panes, events, usageDays, limits, cards, templates, schedules } = this.state
    return structuredClone({ workspaces, missions, panes, events, squads: this.squads(), routing: this.routing(), usageDays, limits, accounts: this.accounts(), cards, templates, schedules, settings: this.settings() })
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
  settings(): OrbitSettings {
    return { ...this.state.settings }
  }

  saveSettings(settings: OrbitSettings): OrbitSettings {
    this.state.settings = { resumeOnStart: settings?.resumeOnStart === true }
    this.save()
    return this.settings()
  }

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
    const workspace: Workspace = { id: randomUUID(), path: folders[0]!, folders: [...folders], name: name || defaultName(folders), lastOpenedAt: Date.now(), instructions: '' }
    this.state.workspaces.push(workspace)
    this.save()
    return structuredClone(workspace)
  }

  updateWorkspace(id: string, patch: { name?: string; folders?: string[]; instructions?: string }): Workspace | undefined {
    const workspace = this.workspace(id)
    if (!workspace) return undefined
    if (patch.instructions !== undefined) workspace.instructions = patch.instructions
    if (patch.folders) Object.assign(workspace, { folders: [...patch.folders], path: patch.folders[0] })
    if (patch.name !== undefined) workspace.name = patch.name || defaultName(workspace.folders)
    this.save()
    return structuredClone(workspace)
  }

  workspace(id: string): Workspace | undefined {
    return this.state.workspaces.find((w) => w.id === id)
  }

  createMission(input: { workspaceId: string; title: string; objective: string; mode: MissionMode; squadId: string | null; allowedClis?: Mission['allowedClis'] }, git: (id: string) => Mission['git'] = () => null, scheduleId: string | null = null): Mission {
    const now = Date.now()
    const id = randomUUID()
    const mission: Mission = { id, status: 'active', createdAt: now, updatedAt: now, usage: { ...EMPTY_USAGE }, git: git(id), scheduleId, readyAt: null, readySummary: null, ...input, allowedClis: input.allowedClis?.length ? input.allowedClis : ['claude', 'codex'] }
    this.state.missions.push(mission)
    this.save()
    return { ...mission }
  }

  mission(id: string): Mission | undefined {
    return this.state.missions.find((m) => m.id === id)
  }

  updateMission(id: string, patch: Partial<Pick<Mission, 'status' | 'title' | 'objective' | 'git' | 'readyAt' | 'readySummary'>>): Mission | undefined {
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
    delete this.state.paneSpecs[String(id)]
    this.save()
  }

  /** A mission's cards, column by column in their order. */
  cards(missionId: string): Card[] {
    const rank = { afazer: 0, fazendo: 1, feito: 2 } as const
    return this.state.cards.filter((c) => c.missionId === missionId).sort((a, b) => rank[a.column] - rank[b.column] || a.order - b.order).map((c) => ({ ...c }))
  }

  card(id: string): Card | undefined {
    const card = this.state.cards.find((c) => c.id === id)
    return card && { ...card }
  }

  cardByNumber(missionId: string, number: number): Card | undefined {
    const card = this.state.cards.find((c) => c.missionId === missionId && c.number === number)
    return card && { ...card }
  }

  addCard(input: Pick<Card, 'missionId' | 'title' | 'notes' | 'column' | 'assignee' | 'createdBy'>): Card {
    const mine = this.state.cards.filter((c) => c.missionId === input.missionId)
    const now = Date.now()
    const card: Card = {
      ...input,
      id: randomUUID(),
      number: Math.max(0, ...mine.map((c) => c.number)) + 1,
      order: Math.max(-1, ...mine.filter((c) => c.column === input.column).map((c) => c.order)) + 1,
      createdAt: now,
      updatedAt: now,
    }
    this.state.cards.push(card)
    this.save()
    return { ...card }
  }

  updateCard(id: string, patch: Partial<Pick<Card, 'title' | 'notes' | 'assignee'>>): Card | undefined {
    const card = this.state.cards.find((c) => c.id === id)
    if (!card) return undefined
    Object.assign(card, patch, { updatedAt: Date.now() })
    this.save()
    return { ...card }
  }

  /** Puts a card at `index` of `column` and renumbers that column; returns every card that moved. */
  moveCard(id: string, column: CardColumn, index?: number): Card[] {
    const card = this.state.cards.find((c) => c.id === id)
    if (!card) return []
    const others = this.state.cards.filter((c) => c.missionId === card.missionId && c.column === column && c.id !== id).sort((a, b) => a.order - b.order)
    const at = index === undefined ? others.length : Math.max(0, Math.min(others.length, Math.floor(index)))
    others.splice(at, 0, card)
    card.column = column
    card.updatedAt = Date.now()
    const changed: Card[] = []
    others.forEach((c, i) => {
      if (c.order !== i || c === card) changed.push(c)
      c.order = i
    })
    this.save()
    return changed.map((c) => ({ ...c }))
  }

  deleteCard(id: string): boolean {
    const before = this.state.cards.length
    this.state.cards = this.state.cards.filter((c) => c.id !== id)
    this.save()
    return this.state.cards.length !== before
  }

  schedules(): Schedule[] {
    return structuredClone(this.state.schedules)
  }

  schedule(id: string): Schedule | undefined {
    const schedule = this.state.schedules.find((s) => s.id === id)
    return schedule && structuredClone(schedule)
  }

  saveSchedule(schedule: Schedule): void {
    const index = this.state.schedules.findIndex((s) => s.id === schedule.id)
    if (index === -1) this.state.schedules.push(structuredClone(schedule))
    else this.state.schedules[index] = structuredClone(schedule)
    this.save()
  }

  deleteSchedule(id: string): boolean {
    const before = this.state.schedules.length
    this.state.schedules = this.state.schedules.filter((s) => s.id !== id)
    this.save()
    return this.state.schedules.length !== before
  }

  template(id: string): MissionTemplate | undefined {
    const template = this.state.templates.find((t) => t.id === id)
    return template && structuredClone(template)
  }

  templateCount(): number {
    return this.state.templates.length
  }

  saveTemplate(template: MissionTemplate): void {
    const index = this.state.templates.findIndex((t) => t.id === template.id)
    if (index === -1) this.state.templates.push(template)
    else this.state.templates[index] = template
    this.save()
  }

  deleteTemplate(id: string): boolean {
    const before = this.state.templates.length
    this.state.templates = this.state.templates.filter((t) => t.id !== id)
    this.save()
    return this.state.templates.length !== before
  }

  setPaneSpec(id: number, spec: SpawnPaneRequest): void {
    this.state.paneSpecs[String(id)] = structuredClone(spec)
    this.save()
  }

  paneSpec(id: number): SpawnPaneRequest | undefined {
    const spec = this.state.paneSpecs[String(id)]
    return spec && structuredClone(spec)
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
    return { version: 1, nextPaneId: 1, workspaces: [], missions: [], panes: [], events: [], customSquads: [], routing: null, usageDays: [], limits: [], customAccounts: [], builtinAuto: {}, disabledCatalog: [], paneSpecs: {}, cards: [], templates: [], schedules: [], settings: { ...DEFAULT_SETTINGS } }
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
