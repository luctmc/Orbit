import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '../src/store.ts'
test('unknown state versions fail closed and preserve the original bytes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orbit-future-state-')), file = join(dir, 'state.json')
  const source = JSON.stringify({ version: 999, missions: [{ title: 'Do not lose this data' }] })
  writeFileSync(file, source)
  assert.throws(() => new Store(dir), /versão|version/i)
  assert.equal(readFileSync(file, 'utf8'), source)
})
