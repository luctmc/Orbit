import type { ServerMessage } from '@orbit/protocol'
import type { WebSocket } from 'ws'

/** Per UI connection, never per PTY: a stalled view must not pause agents or other views. */
export const CLIENT_BUFFER_BYTES = 8 * 1024 * 1024
export const ATTACH_BUFFER_BYTES = 1024 * 1024
export const CLIENT_HEARTBEAT_MS = 30_000

export class ClientTransport {
  private readonly attaching = new Map<number, { messages: ServerMessage[]; bytes: number }>()
  private heldBytes = 0
  private inventoryAllowance = 0
  private alive = true
  private closed = false
  private readonly ws: WebSocket
  private readonly maxBuffered: number
  private readonly maxHeld: number

  constructor(ws: WebSocket, maxBuffered = CLIENT_BUFFER_BYTES, maxHeld = ATTACH_BUFFER_BYTES) {
    this.ws = ws
    this.maxBuffered = maxBuffered
    this.maxHeld = maxHeld
  }

  /** ws bytes are UTF-8 JSON, including escaping, rather than JS string code units. */
  send(message: ServerMessage): void {
    if (this.closed || this.ws.readyState !== this.ws.OPEN) return
    const raw = JSON.stringify(message)
    const bytes = Buffer.byteLength(raw)
    if (this.ws.bufferedAmount === 0) this.inventoryAllowance = 0
    // An inventory can legitimately exceed the streaming window. Permit one on an empty link;
    // otherwise large persisted workspaces could never reconnect. The allowance drains with it.
    if (message.type === 'snapshot' && this.ws.bufferedAmount === 0) this.inventoryAllowance = bytes
    if (this.ws.bufferedAmount + bytes > this.maxBuffered + this.inventoryAllowance) return this.stop()
    this.ws.send(raw, error => { if (error) this.stop() })
  }

  broadcast(message: ServerMessage): void {
    if (this.closed) return
    const held = message.type === 'pane.data' ? this.attaching.get(message.paneId) : undefined
    if (!held) return this.send(message)
    const bytes = Buffer.byteLength(JSON.stringify(message))
    if (this.heldBytes + bytes > this.maxHeld) return this.stop()
    held.messages.push(message)
    held.bytes += bytes
    this.heldBytes += bytes
  }

  beginAttach(paneId: number): boolean {
    if (this.closed || this.attaching.has(paneId)) return false
    this.attaching.set(paneId, { messages: [], bytes: 0 })
    return true
  }

  finishAttach(paneId: number, snapshot?: Extract<ServerMessage, { type: 'pane.snapshot' }>): void {
    const held = this.attaching.get(paneId)
    if (!held) return
    this.attaching.delete(paneId)
    this.heldBytes -= held.bytes
    if (snapshot) this.send(snapshot)
    for (const message of held.messages) this.send(message)
  }

  pong(): void { this.alive = true }
  heartbeat(): void {
    if (this.closed) return
    if (!this.alive) return this.stop()
    this.alive = false
    if (this.ws.readyState === this.ws.OPEN) this.ws.ping(undefined, undefined, error => { if (error) this.stop() })
  }

  /** Reconnect replaces the terminal from its authoritative mirror; never splice partial output. */
  stop(): void {
    if (this.closed) return
    this.closed = true
    this.attaching.clear()
    this.heldBytes = 0
    this.ws.terminate()
  }
}
