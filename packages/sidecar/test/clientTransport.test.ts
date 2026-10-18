import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ClientTransport } from '../src/clientTransport.ts'

function fixture(buffer = 1000, held = 500) {
  const sent: any[] = []
  const ws = { OPEN: 1, readyState: 1, bufferedAmount: 0, stopped: false, pings: 0,
    send: (raw: string, cb: (e?: Error) => void) => { sent.push(JSON.parse(raw)); cb() },
    terminate() { this.stopped = true }, ping() { this.pings++ } }
  return { ws, sent, transport: new ClientTransport(ws as any, buffer, held) }
}
const data = (paneId: number, text: string) => ({ type: 'pane.data' as const, paneId, data: text })

test('slow client output is bounded in UTF-8 bytes, terminates only that client and ignores subsequent output', () => {
  const slow = fixture(100), fast = fixture(1000)
  slow.ws.bufferedAmount = 50
  const message = data(1, '界'.repeat(15))
  slow.transport.broadcast(message); fast.transport.broadcast(message)
  assert(slow.ws.stopped); assert(!fast.ws.stopped)
  assert.equal(fast.sent.length, 1); assert.equal(slow.sent.length, 0)
  slow.transport.broadcast(data(1, 'later'))
  assert.equal(slow.sent.length, 0)
})

test('snapshot output is bounded across panes, preserves order and releases held bytes', () => {
  const { transport, ws, sent } = fixture(2000, 130)
  assert(transport.beginAttach(1)); assert(!transport.beginAttach(1))
  transport.broadcast(data(1, 'first'))
  assert.equal(sent.length, 0)
  transport.finishAttach(1, { type: 'pane.snapshot', paneId: 1, data: 'screen', cols: 80, rows: 24 })
  assert.deepEqual(sent.map(m => m.data), ['screen', 'first'])
  transport.beginAttach(2); transport.broadcast(data(2, 'second'))
  assert(!ws.stopped)
  transport.beginAttach(3); transport.broadcast(data(3, 'x'.repeat(70)))
  assert(ws.stopped)
  transport.finishAttach(2)
  assert.equal(sent.length, 2)
})

test('a missing heartbeat response releases a dead client, while pongs keep it alive', () => {
  const { ws, transport } = fixture()
  transport.heartbeat(); assert.equal(ws.pings, 1)
  transport.pong(); transport.heartbeat(); assert.equal(ws.pings, 2)
  assert(!ws.stopped)
  transport.heartbeat(); assert(ws.stopped)
})

test('a large authoritative inventory can reconnect on an empty link without an infinite size rejection', () => {
  const { transport, ws, sent } = fixture(100)
  transport.send({ type: 'snapshot', snapshot: { events: [{ body: 'x'.repeat(200) }] } } as any)
  assert(!ws.stopped)
  assert.equal(sent.length, 1)
  ws.bufferedAmount = 400
  transport.broadcast(data(1, 'later'))
  assert(ws.stopped)
})
