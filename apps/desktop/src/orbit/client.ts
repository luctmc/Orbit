import type { ClientMessage, Mission, MissionEvent, Pane, Routing, ServerMessage, Squad, Workspace } from '@orbit/protocol'

export interface OrbitState {
  connection: 'connecting' | 'open' | 'closed'
  workspaces: Workspace[]
  missions: Mission[]
  panes: Pane[]
  events: MissionEvent[]
  squads: Squad[]
  /** null until the first snapshot arrives. */
  routing: Routing | null
  lastError: string | null
}

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
  private state: OrbitState = { connection: 'connecting', workspaces: [], missions: [], panes: [], events: [], squads: [], routing: null, lastError: null }
  private readonly listeners = new Set<() => void>()
  /** Views per pane; `ready` once the view applied its snapshot and can take live output. */
  private readonly views = new Map<number, Map<PaneView, { ready: boolean }>>()
  private readonly attaching = new Set<number>()
  private ws: WebSocket | null = null
  private retryMs = 500
  private readonly resolveUrl: () => Promise<string>

  /** `resolveUrl` runs before every (re)connection: the sidecar's port can change when it restarts. */
  constructor(resolveUrl: () => Promise<string>) {
    this.resolveUrl = resolveUrl
    void this.connect()
  }

  getState = (): OrbitState => this.state

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
    ws.onmessage = (event) => this.receive(JSON.parse(String(event.data)) as ServerMessage)
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
    switch (message.type) {
      case 'snapshot':
        this.update({ ...message.snapshot })
        // (Re)connected: every mounted view starts over from a fresh snapshot.
        this.attaching.clear()
        for (const [paneId, views] of this.views) {
          for (const state of views.values()) state.ready = false
          this.requestSnapshot(paneId)
        }
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
