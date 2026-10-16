import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PaneManager } from '../src/panes.ts'

test('closing escalates an uncooperative PTY and releases its epoch only after actual exit', async () => {
  const manager = new PaneManager('/bin/sh', () => ({ file: '/bin/sh', args: ['-c', "trap '' HUP TERM; echo READY; while :; do read -r line; done"] }))
  let ready!: () => void
  const started = new Promise<void>(resolve => { ready = resolve })
  manager.on('data', (_id, data) => { if (data.includes('READY')) ready() })
  const pane = manager.spawn({ id: 1, request: { missionId: 'm', role: 'crew', cli: 'shell', model: null, title: 'Owned test' }, squadRole: null, taskType: null, cwd: '/private/tmp', launch: { cli: 'shell', model: null }, env: {}, hookDriven: false, accountId: null })
  const exits: string[] = []
  manager.on('terminated', (_id, epoch) => exits.push(epoch))
  let timeout: NodeJS.Timeout | undefined
  try {
    await Promise.race([started, new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('PTY did not start')), 2000) })])
    clearTimeout(timeout)
    manager.kill(1)
    assert.deepEqual(exits, [], 'requesting termination must not release the epoch')
    manager.forget(1) // The owned process must still terminate after its UI is gone.
    await manager.waitForExit(1, 3500)
    assert.deepEqual(exits, [pane.executionEpoch])
    assert.throws(() => process.kill(pane.pid!, 0), /ESRCH/)
  } finally {
    clearTimeout(timeout)
    try { process.kill(pane.pid!, 'SIGKILL') } catch {}
    await manager.waitForExit(1)
  }
})
