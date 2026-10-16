import { EventEmitter } from 'node:events'
import type { Readable, Writable } from 'node:stream'

/** A Chrome DevTools Protocol event, possibly from an attached page session. */
export interface CdpEvent {
  method: string
  params: Record<string, any>
  sessionId?: string
}

interface Pending {
  resolve: (value: any) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

/**
 * DevTools Protocol over the pipe Chromium opens with `--remote-debugging-pipe` (fd 3 in, fd 4
 * out; messages end with a NUL byte). Unlike a debugging port, no other process can attach.
 */
export class CdpPipe extends EventEmitter<{ event: [CdpEvent]; close: [] }> {
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  private buffer = ''
  private closed = false
  private readonly output: Writable

  constructor(output: Writable, input: Readable) {
    super()
    this.output = output
    input.setEncoding('utf8')
    input.on('data', (chunk: string) => this.receive(chunk))
    input.on('close', () => this.close())
    output.on('error', () => this.close())
  }

  send<T = any>(method: string, params: Record<string, unknown> = {}, sessionId?: string, timeoutMs = 30_000): Promise<T> {
    if (this.closed) return Promise.reject(new Error('O navegador fechou'))
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`O navegador não respondeu a ${method}`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.output.write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`)
    })
  }

  private receive(chunk: string): void {
    this.buffer += chunk
    let end: number
    while ((end = this.buffer.indexOf('\0')) !== -1) {
      const raw = this.buffer.slice(0, end)
      this.buffer = this.buffer.slice(end + 1)
      let message: any
      try {
        message = JSON.parse(raw)
      } catch {
        continue
      }
      if (typeof message.id === 'number') {
        const waiting = this.pending.get(message.id)
        if (!waiting) continue
        this.pending.delete(message.id)
        clearTimeout(waiting.timer)
        if (message.error) waiting.reject(new Error(message.error.message ?? 'Erro do navegador'))
        else waiting.resolve(message.result ?? {})
      } else if (typeof message.method === 'string') {
        this.emit('event', { method: message.method, params: message.params ?? {}, sessionId: message.sessionId })
      }
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    for (const waiting of this.pending.values()) {
      clearTimeout(waiting.timer)
      waiting.reject(new Error('O navegador fechou'))
    }
    this.pending.clear()
    this.emit('close')
  }
}
