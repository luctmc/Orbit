import { createReadStream } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { WebSocketServer, type WebSocket } from 'ws'
import type { ClientMessage, ServerMessage } from '@orbit/protocol'
import { OrbitCore, type CoreOptions } from './core.ts'
import type { HookPayload } from './hooks.ts'
import { handleMcp } from './mcp.ts'

const MAX_BODY = 1024 * 1024

export interface ServerOptions {
  port: number
  token: string
  allowedOrigins: string[]
  dataDir: string
  shell: string
  agentCommand?: CoreOptions['agentCommand']
  run?: CoreOptions['run']
  browser?: CoreOptions['browser']
  /** Tests drive the schedules with their own clock. */
  scheduler?: boolean
}

export interface RunningServer {
  port: number
  core: OrbitCore
  close(): Promise<void>
}

/**
 * Loopback-only server with two audiences:
 * - the UI, over WebSocket `/ws`, with the per-run token and an allowed Origin;
 * - agents, over HTTP `/mcp` and `/hooks`, each with its own pane token and no browser Origin.
 */
export async function startServer(options: ServerOptions): Promise<RunningServer> {
  /**
   * Per connection: panes whose snapshot is being prepared (with the output held back meanwhile)
   * and the missions whose browser it is watching (frames only go there).
   */
  const clients = new Map<WebSocket, { id: string; attaching: Map<number, ServerMessage[]>; watching: Set<string> }>()
  const send = (ws: WebSocket, message: ServerMessage) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message))
  }
  const core = new OrbitCore({
    dataDir: options.dataDir,
    shell: options.shell,
    agentCommand: options.agentCommand,
    run: options.run,
    browser: options.browser,
    broadcast: (message) => {
      for (const [ws, { attaching, watching }] of clients) {
        if (message.type === 'browser.frame' && !watching.has(message.missionId)) continue
        const held = message.type === 'pane.data' ? attaching.get(message.paneId) : undefined
        if (held) held.push(message)
        else send(ws, message)
      }
    },
  })

  /**
   * Output that reached the mirror before the snapshot is inside it; output after it is held and
   * sent right behind the snapshot. The view ignores `pane.data` until its snapshot arrives.
   */
  const attach = async (ws: WebSocket, paneId: number) => {
    const attaching = clients.get(ws)?.attaching
    if (!attaching || attaching.has(paneId)) return
    attaching.set(paneId, [])
    try {
      const snapshot = await core.paneSnapshot(paneId)
      if (snapshot) send(ws, { type: 'pane.snapshot', paneId, ...snapshot })
      for (const message of attaching.get(paneId) ?? []) send(ws, message)
    } finally {
      attaching.delete(paneId)
    }
  }

  let port = options.port
  const http: Server = createServer((req, res) => {
    const handler = (req.url ?? '').startsWith('/update/') ? handleUpdateRequest(core, port, options.token, req, res) : handleAgentRequest(core, port, req, res)
    handler.catch((error) => {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' })
      res.end(error instanceof Error ? error.message : 'erro')
    })
  })
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_BODY })

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
    const client = { id: randomUUID(), attaching: new Map<number, ServerMessage[]>(), watching: new Set<string>() }
    clients.set(ws, client)
    for (const message of core.welcome()) send(ws, message)
    ws.on('message', (raw) => {
      try {
        const message = JSON.parse(String(raw)) as ClientMessage
        if (message.type === 'pane.attach') void attach(ws, message.paneId)
        else if (message.type === 'browser.watch') {
          if (message.on) client.watching.add(message.missionId)
          else client.watching.delete(message.missionId)
          core.browser.watch(message.missionId, client.id, message.on)
        } else core.handle(message, (answer) => send(ws, answer))
      } catch (error) {
        send(ws, { type: 'error', message: error instanceof Error ? error.message : String(error) })
      }
    })
    ws.on('close', () => {
      clients.delete(ws)
      core.browser.unwatchAll(client.id)
    })
  })

  await new Promise<void>((resolve) => http.listen(options.port, '127.0.0.1', resolve))
  const address = http.address()
  port = typeof address === 'object' && address ? address.port : options.port
  core.setEndpoint(`http://127.0.0.1:${port}`)
  core.resumeCrews()
  void core.refreshCatalog()
  void core.checkAccounts()
  void core.scanSkills().catch(() => {})
  if (options.scheduler !== false) core.startScheduler()

  return {
    port,
    core,
    async close() {
      core.shutdown()
      for (const ws of clients.keys()) ws.terminate()
      await new Promise<void>((resolve) => wss.close(() => http.close(() => resolve())))
    },
  }
}

/**
 * GET /update/latest.json and /update/files/<tag>/<name>, for the app's updater plugin. It sends
 * the per-run UI token in a header; browsers (any Origin) are refused like on the agent routes.
 */
async function handleUpdateRequest(core: OrbitCore, port: number, token: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const host = req.headers.host ?? ''
  if (req.headers.origin || (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`)) return void res.writeHead(403).end()
  const given = req.headers['x-orbit-token']
  if (!tokenMatches(typeof given === 'string' ? given : null, token)) return void res.writeHead(401).end()
  if (req.method !== 'GET') return void res.writeHead(405, { allow: 'GET' }).end()
  const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
  try {
    if (path === '/update/latest.json') {
      const manifest = await core.updateManifest(`http://127.0.0.1:${port}`)
      if (!manifest) return void res.writeHead(204).end()
      return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(manifest))
    }
    const file = /^\/update\/files\/([^/]+)\/([^/]+)$/.exec(path)
    if (!file) return void res.writeHead(404).end()
    const { path: local, size } = await core.updates.file(decodeURIComponent(file[1]!), decodeURIComponent(file[2]!))
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': size })
    createReadStream(local).pipe(res)
  } catch (error) {
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' }).end(error instanceof Error ? error.message : String(error))
  }
}

async function handleAgentRequest(core: OrbitCore, port: number, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
  if (path !== '/mcp' && path !== '/hooks' && path !== '/status') return void res.writeHead(404).end()

  // Agents are CLIs: a browser Origin or a foreign Host means a web page is trying to reach us.
  const host = req.headers.host ?? ''
  if (req.headers.origin || (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`)) return void res.writeHead(403).end()

  const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1]
  const caller = core.identify(bearer)
  if (!caller) return void res.writeHead(401).end()

  if (req.method !== 'POST') return void res.writeHead(405, { allow: 'POST' }).end()
  const body = await readJson(req)

  if (path === '/hooks') {
    const decision = core.hookReport(caller.id, (body ?? {}) as HookPayload)
    if (!decision) return void res.writeHead(204).end()
    return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(decision))
  }
  if (path === '/status') {
    core.statusReport(caller.id, body)
    return void res.writeHead(204).end()
  }
  await handleMcp(core, caller, req, res, body)
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY) throw new Error('Corpo grande demais')
    chunks.push(chunk as Buffer)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : undefined
}

function tokenMatches(given: string | null, expected: string): boolean {
  if (!given) return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
