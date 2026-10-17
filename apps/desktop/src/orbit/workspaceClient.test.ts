import { test } from 'node:test'
import assert from 'node:assert/strict'
import { OrbitClient } from './client.ts'

test('workspace save and rejection settle only the matching operation; deletion snapshot removes the displayed list', async () => {
  const real = globalThis.WebSocket
  class Socket { static OPEN = 1; readyState = 1; send() {} }
  globalThis.WebSocket = Socket as any
  try {
    const client = new OrbitClient(async () => 'ws://synthetic'); await Promise.resolve()
    const workspace = { id: 'qa', name: 'Disposable', path: '/tmp/qa', folders: ['/tmp/qa'], instructions: '', lastOpenedAt: 1 }
    ;(client as any).receive({ type: 'workspace.updated', workspace })
    let settled = false
    const save = client.ask({ type: 'workspace.update', workspaceId: 'qa', name: 'Edited', requestId: 'save' }, 'workspace.saved', m => m.requestId === 'save', 50).then(m => { settled = true; return m })
    ;(client as any).receive({ type: 'workspace.saved', workspace, requestId: 'other' })
    await Promise.resolve(); assert(!settled)
    ;(client as any).receive({ type: 'workspace.saved', workspace, requestId: 'save' })
    assert.equal((await save).workspace.id, 'qa')
    const rejected = client.ask({ type: 'workspace.update', workspaceId: 'qa', requestId: 'fail' }, 'workspace.saved', () => true, 50)
    ;(client as any).receive({ type: 'workspace.error', requestId: 'fail', message: 'Rejected' })
    await assert.rejects(rejected, /Rejected/)
    ;(client as any).receive({ type: 'snapshot', snapshot: { workspaces: [], missions: [], panes: [], events: [] } })
    assert.deepEqual(client.getState().workspaces, [])
  } finally { globalThis.WebSocket = real }
})
