import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hashHarnessFiles, harnessRuntimeRevision } from '../src/harnessRuntime.ts'
test('runtime fingerprint covers complete contents, file identity and Node version', () => {
  const root=mkdtempSync(join(tmpdir(),'orbit-runtime-hash-')), a=join(root,'a.ts'), b=join(root,'b.ts')
  writeFileSync(a,'x'.repeat(200000)); writeFileSync(b,'one')
  const first=hashHarnessFiles(root,[a,b],'fixture-node')
  assert.match(first!,/^[a-f0-9]{64}$/)
  assert.equal(hashHarnessFiles(root,[b,a],'fixture-node'),first)
  writeFileSync(a,'x'.repeat(99999)+'y'+'x'.repeat(100000))
  assert.notEqual(hashHarnessFiles(root,[a,b],'fixture-node'),first)
  assert.notEqual(hashHarnessFiles(root,[a,b],'other-node'),hashHarnessFiles(root,[a,b],'fixture-node'))
  assert.equal(hashHarnessFiles(root,[join(root,'missing')]),null)
  assert.match(harnessRuntimeRevision()!,/^[a-f0-9]{64}$/)
})
