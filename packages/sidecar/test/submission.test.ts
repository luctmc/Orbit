import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PaneManager } from '../src/panes.ts'

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
function fixture() {
  const panes = new PaneManager('/bin/sh')
  const live = (panes as unknown as { live: Map<number, any> }).live
  const writes: string[] = []
  const process = { pty: { write: (text: string): void => { writes.push(text) }, kill: () => {} }, idleTimer: null, hookDriven: false, submitTimer: null, queue: [], closing: false, terminationTimers: [] as NodeJS.Timeout[] }
  live.set(1, process)
  return { panes, live, process, writes }
}

test('simultaneous returns cannot interleave their paste and Enter; queued returns share one wakeup', async () => {
  const { panes, writes } = fixture()
  panes.submit(1, 'first')
  panes.submit(1, 'second')
  panes.submit(1, 'third')
  assert.deepEqual(writes, ['first'])
  await delay(430)
  assert.deepEqual(writes, ['first', '\r', 'second\n\nthird', '\r'])
  panes.killAll()
})

test('a deferred Enter never reaches a replacement process or a process that was killed', async () => {
  const { panes, live, writes } = fixture()
  panes.submit(1, 'old session')
  const replacement: string[] = []
  live.set(1, { pty: { write: (text: string) => replacement.push(text), kill: () => {} }, idleTimer: null, hookDriven: false, submitTimer: null, queue: [], closing: false, terminationTimers: [] as NodeJS.Timeout[] })
  await delay(150)
  assert.deepEqual(replacement, [])
  panes.submit(1, 'closing')
  panes.killAll()
  await delay(150)
  assert.deepEqual(replacement, ['closing'])
  assert.deepEqual(writes, ['old session'])
})

test('a failed deferred Enter never acknowledges delivery or escapes as an uncaught timer error', async () => {
  const f = fixture()
  const errors: unknown[] = []
  f.panes.on('receiptError', error => errors.push(error))
  f.process.pty.write = text => { if (text === '\r') throw new Error('injected PTY write failure'); f.writes.push(text) }
  let receipts = 0
  try {
    f.panes.submitWithReceipt(1, 'result', () => { receipts++ })
    await delay(180)
    assert.equal(receipts, 0)
    assert.equal(errors.length, 1)
    assert.equal(f.process.closing, true, 'failed process is retired before another paste can be appended')
  } finally { f.panes.killAll() }
})
