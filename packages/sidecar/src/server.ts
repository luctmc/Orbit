import { createServer, type Server } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { WebSocketServer, type WebSocket } from 'ws'
import type { ClientMessage, ServerMessage } from '@orbit/protocol'
import { OrbitCore } from './core.ts'

export interface ServerOptions {
  port: number
  token: string
  allowedOrigins: string[]
  dataDir: string
  shell: string
}

export interface RunningServer {
  port: number
  core: OrbitCore
  close(): Promise<void>
}

/**
 * Loopback-only WebSocket server. Panes run arbitrary commands as the user, so every connection
 * must present the per-run token and come from an allowed origin.
 */
export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const clients = new Set<WebSocket>()
  const send = (ws: WebSocket, message: ServerMessage) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message))
  }
  const core = new OrbitCore(options.dataDir, options.shell, (message) => {
    for (const ws of clients) send(ws, message)
  })

  const http: Server = createServer((_req, res) => {
    res.writeHead(404).end()
  })
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 })

  http.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const origin = req.headers.origin ?? ''
    if (url.pathname !== '/ws' || !tokenMatches(url.searchParams.get('token'), options.token) || !options.allowedOrigins.includes(origin)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws))
  })

  wss.on('connection', (ws: WebSocket) => {
    clients.add(ws)
    for (const message of core.welcome()) send(ws, message)
    ws.on('message', (raw) => {
      try {
        core.handle(JSON.parse(String(raw)) as ClientMessage)
      } catch (error) {
        send(ws, { type: 'error', message: error instanceof Error ? error.message : String(error) })
      }
    })
    ws.on('close', () => clients.delete(ws))
  })

  await new Promise<void>((resolve) => http.listen(options.port, '127.0.0.1', resolve))
  const address = http.address()
  const port = typeof address === 'object' && address ? address.port : options.port

  return {
    port,
    core,
    async close() {
      core.shutdown()
      for (const ws of clients) ws.terminate()
      await new Promise<void>((resolve) => wss.close(() => http.close(() => resolve())))
    },
  }
}

function tokenMatches(given: string | null, expected: string): boolean {
  if (!given) return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
