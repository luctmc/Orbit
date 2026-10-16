import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '../src/store.ts'

test('closing metadata does not release a writer before confirmed process termination', () => {
  const store = new Store(mkdtempSync(join(tmpdir(), 'orbit-lease-')))
  const policy = { epoch: 'old', missionId: 'mission', readOnly: false, roots: ['/synthetic/repo'] }
  store.startExecution(1, 'old', policy)
  store.removePane(1)
  assert.throws(() => store.startExecution(2, 'new', { ...policy, epoch: 'new' }), /escrita|encerr/i)
  assert.throws(() => store.startExecution(1, 'new', { ...policy, epoch: 'new', readOnly: true }), /encerr|execução/i)
  store.releaseExecution(1, 'unrelated')
  assert.ok(store.executionPolicy(1))
  store.releaseExecution(1, 'old')
  store.startExecution(2, 'new', { ...policy, epoch: 'new' })
})

test('recovery does not presume that an inherited live process or unknown reservation stopped', () => {
  const root = mkdtempSync(join(tmpdir(), 'orbit-inherited-lease-'))
  const original = new Store(root)
  const policy = { epoch: 'inherited', missionId: 'm', readOnly: false, roots: ['/synthetic/repo'] }
  original.startExecution(1, policy.epoch, policy)
  original.bindExecutionProcess(1, policy.epoch, process.pid)
  const recovered = new Store(root)
  assert.throws(() => recovered.startExecution(2, 'next', { ...policy, epoch: 'next' }), /escrita/)
  recovered.releaseExecution(1, policy.epoch)
  recovered.startExecution(3, 'unknown-pid', { ...policy, epoch: 'unknown-pid' })
  const uncertain = new Store(root)
  assert.throws(() => uncertain.startExecution(4, 'later', { ...policy, epoch: 'later' }), /escrita/)
})

test('an observed termination can retry its failed durable release on the next admission', () => {
  const root = mkdtempSync(join(tmpdir(), 'orbit-release-fault-'))
  const store = new Store(root)
  const policy = { epoch: 'old', missionId: 'm', readOnly: false, roots: ['/synthetic/repo'] }
  store.startExecution(1, 'old', policy)
  const blocked = join(root, 'state.json.tmp')
  mkdirSync(blocked)
  assert.throws(() => store.releaseExecution(1, 'old'))
  assert.ok(store.executionPolicy(1), 'failed flush retains the durable lease')
  rmSync(blocked, { recursive: true })
  store.startExecution(2, 'next', { ...policy, epoch: 'next' })
  assert.equal(store.executionPolicy(1), undefined)
  assert.equal(store.executionPolicy(2)?.epoch, 'next')
})
