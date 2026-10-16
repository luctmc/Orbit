import { test } from 'node:test'
import assert from 'node:assert/strict'
import { OrbitClient, OrbitRequestTimeout, OrbitPendingInput } from './client.ts'

test('lost input ACK retains request identity, blocks changed input, and pending never starts a fresh operation', async () => {
  const real = globalThis.WebSocket
  const sent: any[] = []
  class Socket { static OPEN = 1; readyState = 1; send(raw: string) { sent.push(JSON.parse(raw)) } }
  globalThis.WebSocket = Socket as any
  try {
    const client = new OrbitClient(async () => 'ws://synthetic')
    await Promise.resolve()
    const ask = client.ask.bind(client)
    client.ask = ((m: any, t: any, match: any) => ask(m, t, match, 10)) as any
    const input = { paneId: 1, text: 'Corrija o botão', translationAccountId: 'explicit-codex' }
    await assert.rejects(client.submitInput(input), OrbitRequestTimeout)
    assert(client.inputPending('pane-1'))
    await assert.rejects(client.submitInput({ ...input, text: 'Changed' }), OrbitPendingInput)
    assert.equal(sent.length, 1)
    const retry = client.submitInput(input)
    assert.equal(sent[1].requestId, sent[0].requestId)
    ;(client as any).receive({ type: 'pane.submit.error', requestId: sent[1].requestId, pending: true, message: 'ACK pending' })
    await assert.rejects(retry, OrbitPendingInput)
    const confirmed = client.submitInput(input)
    assert.equal(sent[2].requestId, sent[0].requestId)
    ;(client as any).receive({ type: 'pane.submitted', requestId: sent[2].requestId, paneId: 1 })
    await confirmed
    assert(!client.inputPending('pane-1'))
  } finally { globalThis.WebSocket = real }
})

test('renderer restart recovers drafts, attachment IDs and the exact pending operation without duplicate submission', async () => {
  const oldSocket = globalThis.WebSocket, oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const values = new Map<string, string>(), sent: any[] = []
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v), removeItem: (k: string) => values.delete(k) } })
  class Socket { static OPEN = 1; readyState = 1; send(raw: string) { sent.push(JSON.parse(raw)) } }
  globalThis.WebSocket = Socket as any
  try {
    const first = new OrbitClient(async () => 'ws://synthetic'); await Promise.resolve()
    first.inputDrafts.set('pane-1', { text: 'Confira o estado', accountId: 'codex-acc-2', allowOriginal: false })
    first.inputAttachments.set('pane-1', [{ id: 'attachment-1', name: 'draft.txt', mime: 'text/plain', size: 12, path: '/private/draft.txt', preview: 'blob:expired' } as any])
    first.ask = (async () => { throw new OrbitRequestTimeout('synthetic ACK loss') }) as any
    const input = { paneId: 1, text: 'Confira o estado', attachments: ['attachment-1'], translationAccountId: 'codex-acc-2', allowOriginal: false }
    await assert.rejects(first.submitInput(input), OrbitRequestTimeout)
    const requestId = (first as any).inputAttempts.get('pane-1').requestId
    const restarted = new OrbitClient(async () => 'ws://synthetic'); await Promise.resolve()
    assert.equal(restarted.inputDrafts.get('pane-1')?.text, input.text)
    assert.equal(restarted.inputAttachments.get('pane-1')?.[0]?.id, 'attachment-1')
    assert.equal(restarted.inputAttachments.get('pane-1')?.[0]?.preview, null)
    assert(restarted.inputPending('pane-1'))
    const pending = restarted.checkPendingInput('pane-1')
    assert.equal(sent.at(-1).requestId, requestId)
    ;(restarted as any).receive({ type: 'pane.submitted', paneId: 1, requestId })
    await pending
    const afterAck = new OrbitClient(async () => 'ws://synthetic'); await Promise.resolve()
    assert(!afterAck.inputPending('pane-1')); assert(!afterAck.inputDrafts.has('pane-1')); assert(!afterAck.inputAttachments.has('pane-1'))
  } finally {
    globalThis.WebSocket = oldSocket
    if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage); else delete (globalThis as any).localStorage
  }
})
