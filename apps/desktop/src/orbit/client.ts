import type { Account, AccountLimits, AccountStatus, Card, Catalog, CatalogItem, MissionTemplate, Schedule, UpdateStatus, MissionBrowser, ClientMessage, CliStatus, Mission, MissionEvent, OrbitSettings, Pane, Routing, RoutingProposal, ServerMessage, Squad, UsageDay, Workspace } from '@orbit/protocol'

export interface OrbitState {
  /** Transport open alone does not make an empty inventory authoritative. */
  snapshotReady?: boolean
  startup?: import('@orbit/protocol').StartupTask[]
  connection: 'connecting' | 'open' | 'closed'
  workspaces: Workspace[]
  missions: Mission[]
  panes: Pane[]
  events: MissionEvent[]
  squads: Squad[]
  /** null until the first snapshot arrives. */
  routing: Routing | null
  settings: OrbitSettings | null
  /** Leads' suggestions for the task table, pending and decided. */
  proposals: RoutingProposal[]
  /** Models and effort levels per CLI; null until the sidecar has read them. */
  catalog: Catalog | null
  clis: CliStatus[]
  /** Tokens per day and CLI, as the agents reported them. */
  usageDays: UsageDay[]
  /** Each account's 5-hour and weekly limits, from its latest report. */
  limits: AccountLimits[]
  /** Claude and Codex accounts agents can run as; the built-in ones come first. */
  accounts: Account[]
  accountStatuses: AccountStatus[]
  /** Chromium browser driving the missions' pages; undefined until the sidecar says, null = none. */
  browserEngine: string | null | undefined
  /** Missions whose browser has a page open. */
  browsers: MissionBrowser[]
  /** Installed skills, subagents and MCP servers, and the ids Orbit's agents may not use. */
  skillCatalog: { items: CatalogItem[]; disabled: string[]; scannedAt: number | null }
  /** The sidecar's last look for a new Orbit release (gh). */
  updateStatus: UpdateStatus | null
  /** Every mission's board cards. */
  cards: Card[]
  templates: MissionTemplate[]
  schedules: Schedule[]
  lastError: string | null
}

/** Draws the page's frames; they bypass React like terminal output. */
export type BrowserFrameView = (frame: { data: string; width: number; height: number }) => void

export interface PaneSnapshot {
  data: string
  cols: number
  rows: number
}

/** A mounted terminal view of a pane. */
export interface PaneView {
  snapshot(snapshot: PaneSnapshot): void
  data(data: string): void
  /** The PTY's size changed; the view must match it. */
  resized(cols: number, rows: number): void
}

/**
 * Single WebSocket to the sidecar. Structured state goes through `subscribe`/`getState`
 * (for useSyncExternalStore); terminal bytes bypass React through `attachPane`.
 */
export class OrbitRequestTimeout extends Error {}
export class OrbitPendingInput extends Error {}

/** App-origin storage: drafts and operation IDs survive renderer/app restarts. No credentials. */
class DurableMap<V> extends Map<string, V> {
  private readonly storageKey: string
  constructor(storageKey: string, decode: (value: V) => V = value => value) {
    super()
    this.storageKey = storageKey
    try {
      const entries = JSON.parse(localStorage.getItem(storageKey) ?? '[]')
      if (Array.isArray(entries)) for (const entry of entries) {
        if (Array.isArray(entry) && typeof entry[0] === 'string') super.set(entry[0], decode(entry[1]))
      }
    } catch { /* unavailable or corrupt storage never prevents opening the app */ }
  }
  private persist() { try { localStorage.setItem(this.storageKey, JSON.stringify([...this])) } catch { /* retain in memory if storage is unavailable */ } }
  override set(key: string, value: V): this { super.set(key, value); this.persist(); return this }
  override delete(key: string): boolean { const removed = super.delete(key); this.persist(); return removed }
  override clear(): void { super.clear(); this.persist() }
}

export class OrbitClient {
  readonly inputReceipts = new DurableMap<Extract<ServerMessage, { type: 'pane.submitted' }>>('orbit.input.receipts.v1')
  private readonly inputFlights = new Map<string, Promise<unknown>>()
  readonly inputAttachments = new DurableMap<Array<import('@orbit/protocol').Attachment & { preview: string | null }>>('orbit.input.attachments.v1', files => files.map(file => ({ ...file, preview: null })))
  readonly missionDrafts = new DurableMap<Omit<Extract<ClientMessage, { type: 'mission.create' }>, 'type' | 'requestId'>>('orbit.input.missions.v1')
  readonly inputDrafts = new DurableMap<{ text: string; accountId: string; allowOriginal: boolean }>('orbit.input.drafts.v1')
  private readonly inputAttempts = new DurableMap<{ fingerprint: string; requestId: string }>('orbit.input.attempts.v1')
  inputPending(key: string): boolean { return this.inputAttempts.has(key) }

  async submitInput(input: Omit<Extract<ClientMessage, { type: 'pane.submit' }>, 'type' | 'requestId'>) {
    return this.identifiedInput(`pane-${input.paneId}`, { type: 'pane.submit', ...input }, 'pane.submitted')
  }

  async createMission(input: Omit<Extract<ClientMessage, { type: 'mission.create' }>, 'type' | 'requestId'>) {
    return this.identifiedInput(`mission-${input.workspaceId}`, { type: 'mission.create', ...input }, 'mission.created')
  }

  /** Query the immutable operation, never replay it with the current editable draft. */
  async checkPendingMission(workspaceId: string) {
    const key = `mission-${workspaceId}`
    const attempt = this.inputAttempts.get(key)
    if (!attempt) throw new Error('Não há pedido pendente para conferir.')
    const result = await this.ask({ type: 'mission.check', workspaceId, requestId: attempt.requestId }, 'mission.checked', m => m.requestId === attempt.requestId)
    if ((result.state === 'failed' || result.state === 'acked') && this.inputAttempts.get(key)?.requestId === attempt.requestId) this.inputAttempts.delete(key)
    // The draft may have changed while the receipt was in flight. Preserve it in every state.
    return result
  }

  /** Consult the exact durable request, including original field normalization and attachment IDs. */
  async checkPendingInput(key: string) {
    const attempt = this.inputAttempts.get(key)
    if (!attempt) throw new Error('Não há pedido pendente para conferir.')
    const message = JSON.parse(attempt.fingerprint) as ClientMessage
    if (message.type !== 'pane.submit' && message.type !== 'mission.create') throw new Error('Pedido salvo inválido.')
    return this.identifiedInput(key, message, message.type === 'pane.submit' ? 'pane.submitted' : 'mission.created')
  }

  private identifiedInput<T extends 'pane.submitted' | 'mission.created'>(key: string, message: ClientMessage, type: T): Promise<Extract<ServerMessage, { type: T }>> {
    const prior = this.inputAttempts.get(key)
    if (prior && prior.fingerprint !== JSON.stringify(message)) return Promise.reject(new OrbitPendingInput('Há um pedido pendente com outros dados. Confira o mesmo pedido antes de editar ou enviar outro.'))
    const flight = this.inputFlights.get(key)
    if (flight) return flight as Promise<Extract<ServerMessage, { type: T }>>
    const promise = this.performIdentifiedInput(key, message, type)
    this.inputFlights.set(key, promise)
    void promise.finally(() => { if (this.inputFlights.get(key) === promise) this.inputFlights.delete(key) }).catch(() => {})
    return promise
  }

  private async performIdentifiedInput<T extends 'pane.submitted' | 'mission.created'>(key: string, message: ClientMessage, type: T) {
    const fingerprint = JSON.stringify(message)
    const prior = this.inputAttempts.get(key)
    if (prior && prior.fingerprint !== fingerprint) throw new OrbitPendingInput('Há um pedido pendente com outros dados. Confira o mesmo pedido antes de editar ou enviar outro.')
    const attempt = prior ?? { fingerprint, requestId: crypto.randomUUID() }
    this.inputAttempts.set(key, attempt)
    try {
      const result = await this.ask({ ...message, requestId: attempt.requestId } as ClientMessage, type, m => 'requestId' in m && m.requestId === attempt.requestId, 75_000)
      // Clear the draft before the receipt: a restart in between still queries this same ID.
      if (message.type === 'pane.submit') { this.inputDrafts.delete(key); this.inputAttachments.delete(key) }
      if (message.type === 'mission.create') this.missionDrafts.delete(message.workspaceId)
      const receipt = result as Extract<ServerMessage, { type: 'pane.submitted' | 'mission.created' }>
      if (receipt.type === 'pane.submitted') this.inputReceipts.set(key, receipt)
      this.inputAttempts.delete(key)
      return result
    } catch (error) {
      if (!(error instanceof OrbitRequestTimeout) && !(error instanceof OrbitPendingInput)) this.inputAttempts.delete(key)
      throw error
    }
  }

  private readonly spawnAttempts = new Map<string, { requestId: string; expiresAt: number }>()
  private state: OrbitState = { snapshotReady: false, connection: 'connecting', workspaces: [], missions: [], panes: [], events: [], squads: [], routing: null, settings: null, proposals: [], catalog: null, clis: [], usageDays: [], limits: [], accounts: [], accountStatuses: [], browserEngine: undefined, browsers: [], skillCatalog: { items: [], disabled: [], scannedAt: null }, updateStatus: null, cards: [], templates: [], schedules: [], lastError: null }
  private readonly listeners = new Set<() => void>()
  /** Views per pane; `ready` once the view applied its snapshot and can take live output. */
  private readonly views = new Map<number, Map<PaneView, { ready: boolean }>>()
  private readonly attaching = new Set<number>()
  private readonly frameViews = new Map<string, Set<BrowserFrameView>>()
  /** Live-message listeners (notifications); they see every message after the state is updated. */
  private readonly messageListeners = new Set<(message: ServerMessage) => void>()
  /** One-off answers (files.*) go to whoever asked, not into the shared state. */
  private readonly answers = new Set<(message: ServerMessage) => void>()
  private readonly interrupted = new Set<() => void>()
  private stopped = false
  private retryTimer: ReturnType<typeof setTimeout> | undefined
  private connectionGeneration = 0
  private ws: WebSocket | null = null
  private retryMs = 500
  private readonly resolveUrl: () => Promise<string>

  /** `resolveUrl` runs before every (re)connection: the sidecar's port can change when it restarts. */
  constructor(resolveUrl: () => Promise<string>) {
    this.resolveUrl = resolveUrl
    void this.connect()
  }

  getState = (): OrbitState => this.state

  /** Every message the sidecar sends, as it arrives (after the state took it in). */
  listen(listener: (message: ServerMessage) => void): () => void {
    this.messageListeners.add(listener)
    return () => this.messageListeners.delete(listener)
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  send(message: ClientMessage): void {
    if (this.state.snapshotReady && this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message))
    else this.update({ lastError: 'Sem conexão com o motor do Orbit' })
  }

  dismissError(): void {
    this.update({ lastError: null })
  }

  /** Keep the operation identity after a lost ACK, including dialog close/reopen. */
  async spawn(request: import('@orbit/protocol').SpawnPaneRequest) {
    const fingerprint = JSON.stringify(request)
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprint))
    const storageKey = `orbit.spawn.${Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('')}`
    let attempt = this.spawnAttempts.get(fingerprint)
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null')
      if (!attempt && saved && typeof saved.requestId === 'string' && Number.isFinite(saved.expiresAt)) attempt = saved
    } catch { /* private storage may be unavailable */ }
    if (!attempt) {
      attempt = { requestId: crypto.randomUUID(), expiresAt: Date.now() + 20_000 }
    }
    this.spawnAttempts.set(fingerprint, attempt)
    try { localStorage.setItem(storageKey, JSON.stringify(attempt)) } catch { /* retain operation in memory */ }
    try {
      const receipt = await this.ask({ type: 'pane.spawn', request, ...attempt }, 'pane.spawned', m => m.requestId === attempt.requestId)
      this.spawnAttempts.delete(fingerprint)
      try { localStorage.removeItem(storageKey) } catch { /* optional persistence */ }
      return receipt
    } catch (error) {
      if (!(error instanceof OrbitRequestTimeout)) {
        this.spawnAttempts.delete(fingerprint)
        try { localStorage.removeItem(storageKey) } catch { /* optional persistence */ }
      }
      throw error
    }
  }

  /**
   * Mounts a view: the sidecar answers with the pane's screen serialized at the PTY's size, then
   * live output. Raw history is never replayed, since redrawing a TUI at another width scrambles it.
   */
  attachPane(paneId: number, view: PaneView): () => void {
    let views = this.views.get(paneId)
    if (!views) this.views.set(paneId, (views = new Map()))
    views.set(view, { ready: false })
    this.requestSnapshot(paneId)
    return () => {
      views.delete(view)
      if (views.size === 0) this.views.delete(paneId)
    }
  }

  /**
   * Sends a files.* or git.* question and resolves with the first answer that matches; a files.error
   * rejects it.
   */
  ask<T extends ServerMessage['type']>(message: ClientMessage, type: T, match: (m: Extract<ServerMessage, { type: T }>) => boolean = () => true, timeoutMs = 20_000): Promise<Extract<ServerMessage, { type: T }>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(() => reject(new OrbitRequestTimeout(message.type === 'pane.spawn' ? 'A abertura ainda não foi confirmada. Tente novamente para conferir o mesmo pedido.' : 'O motor não respondeu a tempo'))), timeoutMs)
      const listener = (m: ServerMessage) => {
        if (m.type === type && match(m as Extract<ServerMessage, { type: T }>)) finish(() => resolve(m as Extract<ServerMessage, { type: T }>))
        else if ((m.type === 'files.error' && !['mission.progress', 'pane.submit', 'mission.create'].includes(message.type)) || ((m.type === 'mission.create.error' || m.type === 'account.reset.error' || m.type === 'workspace.error' || m.type === 'attachment.error' || m.type === 'pane.submit.error' || m.type === 'pane.spawn.error' || m.type === 'mission.progress.error') && 'requestId' in message && m.requestId === message.requestId)) finish(() => reject('pending' in m && m.pending ? new OrbitPendingInput(m.message) : new Error(m.message)))
      }
      const interrupt = () => finish(() => reject(new OrbitRequestTimeout('A conexão com o motor caiu antes da confirmação. Confira o mesmo pedido quando reconectar.')))
      const finish = (settle: () => void) => {
        clearTimeout(timer)
        this.answers.delete(listener)
        this.interrupted.delete(interrupt)
        settle()
      }
      this.answers.add(listener)
      this.interrupted.add(interrupt)
      if (this.ws?.readyState === WebSocket.OPEN) {
        try { this.ws.send(JSON.stringify(message)) }
        catch { interrupt() } // The transport may have accepted bytes before reporting failure.
      } else finish(() => reject(new Error('Sem conexão com o motor do Orbit')))
    })
  }

  /** Receives the mission page's frames while mounted (the sidecar only streams while watched). */
  watchBrowser(missionId: string, view: BrowserFrameView): () => void {
    let views = this.frameViews.get(missionId)
    if (!views) this.frameViews.set(missionId, (views = new Set()))
    views.add(view)
    if (views.size === 1) this.sendQuietly({ type: 'browser.watch', missionId, on: true })
    return () => {
      views.delete(view)
      if (views.size === 0) {
        this.frameViews.delete(missionId)
        this.sendQuietly({ type: 'browser.watch', missionId, on: false })
      }
    }
  }

  private sendQuietly(message: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message))
  }

  private requestSnapshot(paneId: number): void {
    if (this.attaching.has(paneId) || this.ws?.readyState !== WebSocket.OPEN) return
    this.attaching.add(paneId)
    this.ws.send(JSON.stringify({ type: 'pane.attach', paneId } satisfies ClientMessage))
  }

  /** Release transport resources without deleting drafts, receipts or uncertain operation IDs. */
  dispose(): void {
    this.stopped = true
    this.connectionGeneration++
    clearTimeout(this.retryTimer)
    const ws = this.ws
    this.ws = null
    ws?.close()
    this.invalidateConnection()
  }

  private invalidateConnection(): void {
    this.attaching.clear()
    for (const views of this.views.values()) for (const state of views.values()) state.ready = false
    for (const interrupt of [...this.interrupted]) interrupt()
    this.update({ connection: 'closed', snapshotReady: false })
  }

  private async connect(): Promise<void> {
    if (this.stopped) return
    const generation = ++this.connectionGeneration
    this.update({ connection: 'connecting', snapshotReady: false })
    let ws: WebSocket
    try {
      const url = await this.resolveUrl()
      if (this.stopped || generation !== this.connectionGeneration) return
      ws = new WebSocket(url)
    } catch (error) {
      if (this.stopped || generation !== this.connectionGeneration) return
      this.update({ connection: 'closed', lastError: error instanceof Error ? error.message : String(error) })
      this.retryLater()
      return
    }
    this.ws = ws
    const current = () => !this.stopped && generation === this.connectionGeneration && this.ws === ws
    ws.onopen = () => {
      if (!current()) return
      // Only a fresh inventory makes actions safe after a sidecar restart.
      this.update({ lastError: null })
    }
    ws.onmessage = (event) => {
      if (!current()) return
      const message = JSON.parse(String(event.data)) as ServerMessage
      this.receive(message)
      for (const listener of this.messageListeners) listener(message)
    }
    ws.onclose = () => {
      if (!current()) return
      this.ws = null
      this.invalidateConnection()
      this.retryLater()
    }
  }

  private retryLater(): void {
    if (this.stopped) return
    clearTimeout(this.retryTimer)
    this.retryTimer = setTimeout(() => void this.connect(), this.retryMs)
    this.retryMs = Math.min(this.retryMs * 2, 8000)
  }

  private receive(message: ServerMessage): void {
    if (message.type === 'mission.checked' || message.type === 'workspace.saved' || message.type === 'workspace.error') {
      for (const answer of [...this.answers]) answer(message)
      return
    }
    if (message.type === 'mission.created' || message.type === 'mission.create.error' || message.type.startsWith('account.reset.') || message.type === 'pane.spawned' || message.type === 'pane.spawn.error' || message.type.startsWith('mission.progress') || message.type.startsWith('attachment.') || message.type === 'pane.submitted' || message.type === 'pane.submit.error' || message.type === 'pane.conversation' || message.type.startsWith('files.') || message.type.startsWith('git.') || message.type.startsWith('report') || message.type === 'ledger') {
      for (const answer of [...this.answers]) answer(message)
      return
    }
    switch (message.type) {
      case 'engine.startup':
        this.update({ startup: message.tasks })
        return
      case 'snapshot':
        // Open pages follow as browser.state messages.
        this.retryMs = 500
        this.update({ ...message.snapshot, connection: 'open', snapshotReady: true, browsers: [] })
        // (Re)connected: every mounted view starts over from a fresh snapshot.
        this.attaching.clear()
        for (const [paneId, views] of this.views) {
          for (const state of views.values()) state.ready = false
          this.requestSnapshot(paneId)
        }
        // Pages being watched start streaming again on the new connection.
        for (const missionId of this.frameViews.keys()) this.sendQuietly({ type: 'browser.watch', missionId, on: true })
        return
      case 'pane.snapshot': {
        this.attaching.delete(message.paneId)
        for (const [view, state] of this.views.get(message.paneId) ?? []) {
          if (state.ready) continue
          state.ready = true
          view.snapshot(message)
        }
        return
      }
      case 'pane.data':
        for (const [view, state] of this.views.get(message.paneId) ?? []) if (state.ready) view.data(message.data)
        return
      case 'pane.resized':
        for (const [view, state] of this.views.get(message.paneId) ?? []) if (state.ready) view.resized(message.cols, message.rows)
        return
      case 'workspace.updated':
        this.update({ workspaces: upsert(this.state.workspaces, message.workspace, (w) => w.id) })
        return
      case 'mission.updated':
        this.update({ missions: upsert(this.state.missions, message.mission, (m) => m.id) })
        return
      case 'pane.updated':
        this.update({ panes: upsert(this.state.panes, message.pane, (p) => p.id) })
        return
      case 'pane.removed':
        this.update({ panes: this.state.panes.filter((p) => p.id !== message.paneId) })
        return
      case 'event.added':
        this.update({ events: [...this.state.events, message.event] })
        return
      case 'squad.updated':
        this.update({ squads: upsert(this.state.squads, message.squad, (s) => s.id) })
        return
      case 'squad.removed':
        this.update({ squads: this.state.squads.filter((s) => s.id !== message.squadId) })
        return
      case 'routing.updated':
        this.update({ routing: message.routing })
        return
      case 'proposals':
        this.update({ proposals: message.proposals })
        return
      case 'settings.updated':
        this.update({ settings: message.settings })
        return
      case 'catalog':
        this.update({ catalog: message.catalog })
        return
      case 'cli.status':
        this.update({ clis: message.clis })
        return
      case 'usage.day':
        this.update({ usageDays: upsert(this.state.usageDays, message.day, (d) => d.day) })
        return
      case 'limits':
        this.update({ limits: message.limits })
        return
      case 'accounts':
        this.update({ accounts: message.accounts })
        return
      case 'account.status':
        this.update({ accountStatuses: message.statuses })
        return
      case 'schedule.updated':
        this.update({ schedules: upsert(this.state.schedules, message.schedule, (x) => x.id) })
        return
      case 'schedule.removed':
        this.update({ schedules: this.state.schedules.filter((x) => x.id !== message.scheduleId) })
        return
      case 'template.updated':
        this.update({ templates: upsert(this.state.templates, message.template, (t) => t.id) })
        return
      case 'template.removed':
        this.update({ templates: this.state.templates.filter((t) => t.id !== message.templateId) })
        return
      case 'card.updated':
        this.update({ cards: upsert(this.state.cards, message.card, (c) => c.id) })
        return
      case 'card.removed':
        this.update({ cards: this.state.cards.filter((c) => c.id !== message.cardId) })
        return
      case 'update.status':
        this.update({ updateStatus: message.status })
        return
      case 'skills':
        this.update({ skillCatalog: { items: message.items, disabled: message.disabled, scannedAt: message.scannedAt } })
        return
      case 'browser.engine':
        this.update({ browserEngine: message.name })
        return
      case 'browser.state':
        this.update({ browsers: upsert(this.state.browsers, message.browser, (b) => b.missionId) })
        return
      case 'browser.closed':
        this.update({ browsers: this.state.browsers.filter((b) => b.missionId !== message.missionId) })
        return
      case 'browser.frame':
        for (const view of this.frameViews.get(message.missionId) ?? []) view(message)
        return
      case 'error':
        this.update({ lastError: message.message })
        return
    }
  }

  private update(patch: Partial<OrbitState>): void {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener()
  }
}

function upsert<T>(list: T[], item: T, key: (item: T) => string | number): T[] {
  const index = list.findIndex((x) => key(x) === key(item))
  if (index === -1) return [...list, item]
  const next = list.slice()
  next[index] = item
  return next
}
