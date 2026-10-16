import { test } from 'node:test'
import assert from 'node:assert/strict'
import { OrbitClient, OrbitRequestTimeout } from './client.ts'

test('retry after lost spawn ACK keeps operation identity and deadline, then a new explicit spawn gets a new ID', async () => {
  const real = globalThis.WebSocket
  const sent: any[] = []
  class Socket { static OPEN = 1; readyState = 1; send(raw: string) { sent.push(JSON.parse(raw)) } }
  globalThis.WebSocket = Socket as any
  try {
    const client = new OrbitClient(async () => 'ws://synthetic')
    await Promise.resolve()
    const ask = client.ask.bind(client)
    client.ask = ((message: any, type: any, match: any) => ask(message, type, match, 10)) as any
    const request = { missionId: 'm', role: 'crew' as const, cli: 'shell' as const, model: null, title: 'One pane' }
    await assert.rejects(client.spawn(request), OrbitRequestTimeout)
    const retry = client.spawn(request)
    while (sent.length < 2) await new Promise(r => setImmediate(r))
    assert.equal(sent[0].requestId, sent[1].requestId)
    assert.equal(sent[0].expiresAt, sent[1].expiresAt)
    ;(client as any).receive({ type: 'pane.spawned', requestId: sent[1].requestId, pane: { id: 42 } })
    assert.equal((await retry).pane.id, 42)
    const next = client.spawn(request)
    while (sent.length < 3) await new Promise(r => setImmediate(r))
    assert.notEqual(sent[2].requestId, sent[0].requestId)
    ;(client as any).receive({ type: 'pane.spawn.error', requestId: sent[2].requestId, message: 'Rejected' })
    await assert.rejects(next, /Rejected/)
  } finally { globalThis.WebSocket = real }
})
