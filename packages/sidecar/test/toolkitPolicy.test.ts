import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildContextPack, ContextLibrary } from '../src/contextPack.ts'
import { toolkitSections, ToolkitDispatches, TOOLKIT_POLICY_VERSION } from '../src/toolkitPolicy.ts'

test('default contract is bounded; detailed modules are stable, mission-scoped and retrievable on demand', () => {
  const library = new ContextLibrary(mkdtempSync(join(tmpdir(), 'orbit-toolkit-context-')))
  const make = () => buildContextPack(toolkitSections(), 6000, section => library.put('mission', section))
  const first = make(), second = make()
  assert.deepEqual(first, second)
  assert.ok(first.bytes < 4000, String(first.bytes))
  assert.ok(first.sourceBytes > first.bytes * 2)
  assert.equal(first.references.length, 3)
  for (const ref of first.references) {
    assert.ok(first.text.includes(ref.sha256))
    assert.equal(library.read('mission', ref.sha256).section, ref.section)
    assert.throws(() => library.read('other', ref.sha256), /não encontrada/)
  }
  assert.equal(first.text.split(TOOLKIT_POLICY_VERSION).length - 1, 1)
  assert.ok(!first.text.includes('Do not impose Next.js'), 'details are not eagerly pasted')
  for (const rule of ['for conversation or no task', 'simple task', 'complex work', 'user and applicable project', 'stop ponytail', 'stop caveman', 'credentials', 'model compliance is not guaranteed']) assert.ok(first.text.includes(rule), rule)
})

test('dispatch inheritance is exact to version, provider, account and observed native session across app restarts', () => {
  const root = mkdtempSync(join(tmpdir(), 'orbit-toolkit-receipts-'))
  const receipt = new ToolkitDispatches(root)
  receipt.dispatched(1, 'codex', 'account1', null, 'epoch1')
  assert.equal(receipt.inherited(1, 'codex', 'account1', 'session1'), false, 'unknown session is never a wildcard')
  receipt.observe(1, 'codex', 'account1', 'session1', 'stale-epoch')
  assert.equal(receipt.inherited(1, 'codex', 'account1', 'session1'), false)
  receipt.observe(1, 'codex', 'account1', 'session1', 'epoch1')
  const restored = new ToolkitDispatches(root)
  assert.equal(restored.inherited(1, 'codex', 'account1', 'session1'), true)
  restored.observe(1, 'codex', 'account1', 'session2', 'epoch1')
  for (const [cli, account, session] of [['codex', 'account1', 'session2'], ['codex', 'account2', 'session1'], ['claude', 'account1', 'session1']] as const) assert.equal(restored.inherited(1, cli, account, session), false)
  const data = JSON.parse(readFileSync(join(root, '1.json'), 'utf8'))
  writeFileSync(join(root, '1.json'), JSON.stringify({ ...data, version: 'old' }))
  assert.equal(restored.inherited(1, 'codex', 'account1', 'session1'), false)
  writeFileSync(join(root, '1.json'), 'broken')
  assert.equal(restored.inherited(1, 'codex', 'account1', 'session1'), false)
  assert.throws(() => restored.dispatched(-1, 'codex', null, null, 'epoch'), /inválido/)
})
