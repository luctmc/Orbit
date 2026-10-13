import type { ClientMessage, Mission, MissionEvent, Pane, ServerMessage, Workspace } from '@orbit/protocol'

const SCROLLBACK_LIMIT = 512 * 1024

export interface OrbitState {
  connection: 'connecting' | 'open' | 'closed'
  workspaces: Workspace[]
  missions: Mission[]
  panes: Pane[]
  events: MissionEvent[]
  lastError: string | null
}

type DataListener = (data: string) => void

/**
 * Single WebSocket to the sidecar. Structured state goes through `subscribe`/`getState`
 * (for useSyncExternalStore); terminal bytes bypass React through `onPaneData`.
 */
export class OrbitClient {
  private state: OrbitState = { connection: 'connecting', workspaces: [], missions: [], panes: [], events: [], lastError: null }
  private readonly listeners = new Set<() => void>()
  private readonly dataListeners = new Map<number, Set<DataListener>>()
  private readonly buffers = new Map<number, string>()
  private ws: WebSocket | null = null
  private retryMs = 500
  private readonly url: string

  constructor(url: string) {
    this.url = url
    this.connect()
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

  /** Replays what the pane printed so far, then streams new output. */
  onPaneData(paneId: number, listener: DataListener): () => void {
    const buffered = this.buffers.get(paneId)
    if (buffered) listener(buffered)
    let set = this.dataListeners.get(paneId)
    if (!set) this.dataListeners.set(paneId, (set = new Set()))
    set.add(listener)
    return () => set.delete(listener)
  }

  private connect(): void {
    const ws = new WebSocket(this.url)
    this.ws = ws
    this.update({ connection: 'connecting' })
    ws.onopen = () => {
      this.retryMs = 500
      this.update({ connection: 'open', lastError: null })
    }
    ws.onmessage = (event) => this.receive(JSON.parse(String(event.data)) as ServerMessage)
    ws.onclose = () => {
      this.update({ connection: 'closed' })
      setTimeout(() => this.connect(), this.retryMs)
      this.retryMs = Math.min(this.retryMs * 2, 8000)
    }
  }

  private receive(message: ServerMessage): void {
    switch (message.type) {
      case 'snapshot':
        this.buffers.clear()
        this.update({ ...message.snapshot })
        return
      case 'pane.scrollback':
        this.buffers.set(message.paneId, message.data)
        this.emitData(message.paneId, message.data, true)
        return
      case 'pane.data':
        this.buffers.set(message.paneId, ((this.buffers.get(message.paneId) ?? '') + message.data).slice(-SCROLLBACK_LIMIT))
        this.emitData(message.paneId, message.data, false)
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
        this.buffers.delete(message.paneId)
        this.update({ panes: this.state.panes.filter((p) => p.id !== message.paneId) })
        return
      case 'event.added':
        this.update({ events: [...this.state.events, message.event] })
        return
      case 'error':
        this.update({ lastError: message.message })
        return
    }
  }

  private emitData(paneId: number, data: string, replace: boolean): void {
    for (const listener of this.dataListeners.get(paneId) ?? []) listener(replace ? `\x1bc${data}` : data)
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
