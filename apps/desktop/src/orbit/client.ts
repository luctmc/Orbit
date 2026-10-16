import type { Account, AccountLimits, AccountStatus, Card, Catalog, CatalogItem, MissionTemplate, Schedule, UpdateStatus, MissionBrowser, ClientMessage, CliStatus, Mission, MissionEvent, OrbitSettings, Pane, Routing, RoutingProposal, ServerMessage, Squad, UsageDay, Workspace } from '@orbit/protocol'

export interface OrbitState {
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
export class OrbitClient {
  private state: OrbitState = { connection: 'connecting', workspaces: [], missions: [], panes: [], events: [], squads: [], routing: null, settings: null, proposals: [], catalog: null, clis: [], usageDays: [], limits: [], accounts: [], accountStatuses: [], browserEngine: undefined, browsers: [], skillCatalog: { items: [], disabled: [], scannedAt: null }, updateStatus: null, cards: [], templates: [], schedules: [], lastError: null }
  private readonly listeners = new Set<() => void>()
  /** Views per pane; `ready` once the view applied its snapshot and can take live output. */
  private readonly views = new Map<number, Map<PaneView, { ready: boolean }>>()
  private readonly attaching = new Set<number>()
  private readonly frameViews = new Map<string, Set<BrowserFrameView>>()
  /** Live-message listeners (notifications); they see every message after the state is updated. */
  private readonly messageListeners = new Set<(message: ServerMessage) => void>()
  /** One-off answers (files.*) go to whoever asked, not into the shared state. */
  private readonly answers = new Set<(message: ServerMessage) => void>()
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
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message))
    else this.update({ lastError: 'Sem conexão com o motor do Orbit' })
  }

  dismissError(): void {
    this.update({ lastError: null })
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
      const timer = setTimeout(() => finish(() => reject(new Error('O motor não respondeu a tempo'))), timeoutMs)
      const listener = (m: ServerMessage) => {
        if (m.type === type && match(m as Extract<ServerMessage, { type: T }>)) finish(() => resolve(m as Extract<ServerMessage, { type: T }>))
        else if ((m.type === 'files.error' && message.type !== 'mission.progress') || ((m.type === 'workspace.error' || m.type === 'attachment.error' || m.type === 'pane.submit.error' || m.type === 'mission.progress.error') && 'requestId' in message && m.requestId === message.requestId)) finish(() => reject(new Error(m.message)))
      }
      const finish = (settle: () => void) => {
        clearTimeout(timer)
        this.answers.delete(listener)
        settle()
      }
      this.answers.add(listener)
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message))
      else finish(() => reject(new Error('Sem conexão com o motor do Orbit')))
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

  private async connect(): Promise<void> {
    this.update({ connection: 'connecting' })
    let url: string
    try {
      url = await this.resolveUrl()
    } catch (error) {
      this.update({ connection: 'closed', lastError: error instanceof Error ? error.message : String(error) })
      this.retryLater()
      return
    }
    const ws = new WebSocket(url)
    this.ws = ws
    ws.onopen = () => {
      this.retryMs = 500
      this.update({ connection: 'open', lastError: null })
    }
    ws.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as ServerMessage
      this.receive(message)
      for (const listener of this.messageListeners) listener(message)
    }
    ws.onclose = () => {
      this.update({ connection: 'closed' })
      this.retryLater()
    }
  }

  private retryLater(): void {
    setTimeout(() => void this.connect(), this.retryMs)
    this.retryMs = Math.min(this.retryMs * 2, 8000)
  }

  private receive(message: ServerMessage): void {
    if (message.type.startsWith('mission.progress') || message.type.startsWith('attachment.') || message.type === 'pane.submitted' || message.type === 'pane.submit.error' || message.type === 'pane.conversation' || message.type.startsWith('files.') || message.type.startsWith('git.') || message.type.startsWith('report') || message.type === 'ledger') {
      for (const answer of [...this.answers]) answer(message)
      return
    }
    switch (message.type) {
      case 'engine.startup':
        this.update({ startup: message.tasks })
        return
      case 'snapshot':
        // Open pages follow as browser.state messages.
        this.update({ ...message.snapshot, browsers: [] })
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
