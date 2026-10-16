import { test } from 'node:test'
import assert from 'node:assert/strict'
import { OrbitClient } from './client.ts'

test('progress requests ignore unrelated errors and match the response request id', async () => {
  const real = globalThis.WebSocket
  class Socket {
    static OPEN = 1
    readyState = 1
    send() {}
  }
  globalThis.WebSocket = Socket as any
  try {
    const client = new OrbitClient(async () => 'ws://synthetic')
    await Promise.resolve()
    const receive = (m: any) => (client as any).receive(m)
    let settled = false
    const first = client.ask({ type: 'mission.progress', missionId: 'm', requestId: 'a' }, 'mission.progress', m => m.requestId === 'a')
    void first.then(() => { settled = true })
    receive({ type: 'files.error', message: 'Unrelated file read' })
    receive({ type: 'mission.progress.error', requestId: 'b', missionId: 'm', message: 'Other progress request' })
    await Promise.resolve()
    assert.equal(settled, false)
    receive({ type: 'mission.progress', requestId: 'a', progress: { missionId: 'm' } })
    assert.equal((await first).requestId, 'a')
    const second = client.ask({ type: 'mission.progress', missionId: 'm', requestId: 'b' }, 'mission.progress', m => m.requestId === 'b')
    receive({ type: 'mission.progress.error', requestId: 'b', missionId: 'm', message: 'Mission removed' })
    await assert.rejects(second, /Mission removed/)
  } finally { globalThis.WebSocket = real }
})
