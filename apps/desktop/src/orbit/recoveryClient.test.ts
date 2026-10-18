import { test } from 'node:test'
import assert from 'node:assert/strict'
import { OrbitClient, OrbitRequestTimeout } from './client.ts'

class Socket {
  static OPEN = 1
  static instances: Socket[] = []
  readyState = 1
  onopen?: () => void
  onclose?: () => void
  onmessage?: (event: { data: string }) => void
  sent: any[] = []
  constructor(_url: string) { Socket.instances.push(this) }
  send(raw: string) { this.sent.push(JSON.parse(raw)) }
  close() { this.readyState = 3 }
  message(message: unknown) { this.onmessage?.({ data: JSON.stringify(message) }) }
}

async function fixture(run: (client: OrbitClient, socket: Socket) => Promise<void>) {
  const real = globalThis.WebSocket
  globalThis.WebSocket = Socket as any
  Socket.instances = []
  const client = new OrbitClient(async () => 'ws://test')
  ;(client as any).retryLater = () => {}
  try { await Promise.resolve(); await run(client, Socket.instances[0]!) }
  finally { (client as any).dispose?.(); globalThis.WebSocket = real }
}
const snapshot = { type: 'snapshot', snapshot: { panes: [], missions: [], workspaces: [] } }

test('transport open waits for authoritative inventory and disconnection invalidates readiness', () => fixture(async (client, socket) => {
  socket.onopen?.()
  assert.equal(client.getState().connection, 'connecting')
  socket.message(snapshot)
  assert.equal(client.getState().connection, 'open')
  assert.equal(client.getState().snapshotReady, true)
  socket.onclose?.()
  assert.equal(client.getState().snapshotReady, false)
  assert.equal(client.getState().connection, 'closed')
}))

test('disconnect promptly settles in-flight input as uncertain, retaining its exact ID and draft', () => fixture(async (client, socket) => {
  client.inputDrafts.set('pane-9', { text: 'ação única', accountId: '', allowOriginal: true })
  const pending = client.submitInput({ paneId: 9, text: 'ação única' })
  const rejected = assert.rejects(pending, OrbitRequestTimeout)
  socket.onclose?.()
  await Promise.race([rejected, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('did not settle on disconnect')), 100); timer.unref() })])
  assert.equal((client as any).answers.size, 0)
  assert(client.inputPending('pane-9'))
  assert.equal(client.inputDrafts.get('pane-9')?.text, 'ação única')
  await (client as any).connect()
  const next = Socket.instances.at(-1)!
  next.message(snapshot)
  const check = client.checkPendingInput('pane-9')
  assert.equal(next.sent.at(-1).requestId, socket.sent[0].requestId)
  next.message({ type: 'pane.submitted', paneId: 9, requestId: socket.sent[0].requestId })
  await check
  assert.equal(client.inputPending('pane-9'), false)
}))

test('late callbacks of the previous socket cannot overwrite inventory or close the new transport', () => fixture(async (client, socket) => {
  socket.message(snapshot)
  socket.onclose?.()
  await (client as any).connect()
  const current = Socket.instances.at(-1)!
  current.message(snapshot)
  socket.message({ type: 'pane.updated', pane: { id: 999 } })
  socket.onclose?.()
  assert.equal(client.getState().panes.length, 0)
  assert.equal(client.getState().connection, 'open')
}))

test('reconnection reattaches each terminal once and suppresses live bytes until its replacement snapshot', () => fixture(async (client, socket) => {
  const received: string[] = []
  client.attachPane(4, { snapshot: m => received.push(m.data), data: m => received.push(m), resized: () => {} })
  socket.message(snapshot)
  socket.message({ type: 'pane.snapshot', paneId: 4, data: 'before', cols: 80, rows: 24 })
  socket.onclose?.()
  await (client as any).connect()
  const next = Socket.instances.at(-1)!
  next.message(snapshot)
  next.message({ type: 'pane.data', paneId: 4, data: 'premature' })
  next.message({ type: 'pane.snapshot', paneId: 4, data: 'restored 界 🙂', cols: 80, rows: 24 })
  next.message({ type: 'pane.data', paneId: 4, data: 'live' })
  assert.deepEqual(received, ['before', 'restored 界 🙂', 'live'])
  assert.equal(next.sent.filter(m => m.type === 'pane.attach').length, 1)
}))


test('raw terminal input is refused during reconnect and is never replayed into a replacement process', () => fixture(async (client, socket) => {
  socket.onopen?.()
  client.send({ type: 'pane.input', paneId: 4, data: 'rm draft\r' })
  assert.equal(socket.sent.length, 0)
  socket.message(snapshot)
  assert.equal(socket.sent.length, 0)
  client.send({ type: 'pane.input', paneId: 4, data: 'echo ready\r' })
  assert.deepEqual(socket.sent, [{ type: 'pane.input', paneId: 4, data: 'echo ready\r' }])
}))

test('disposing while the endpoint resolves prevents a late socket and keeps durable drafts', async () => {
  const real = globalThis.WebSocket
  globalThis.WebSocket = Socket as any
  Socket.instances = []
  let resolve!: (url: string) => void
  const client = new OrbitClient(() => new Promise(r => { resolve = r }))
  client.inputDrafts.set('pane-1', { text: 'preserve', accountId: '', allowOriginal: true })
  client.dispose()
  resolve('ws://obsolete')
  await Promise.resolve()
  assert.equal(Socket.instances.length, 0)
  assert.equal(client.inputDrafts.get('pane-1')?.text, 'preserve')
  globalThis.WebSocket = real
})

test('a synchronous send failure retains the uncertain input identity and releases request listeners', () => fixture(async (client, socket) => {
  socket.send = () => { throw new Error('socket closed during send') }
  await assert.rejects(client.submitInput({ paneId: 12, text: 'preserve identity' }), OrbitRequestTimeout)
  assert(client.inputPending('pane-12'))
  assert.equal((client as any).answers.size, 0)
  assert.equal((client as any).interrupted.size, 0)
}))
