import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ATTACHMENT_LIMITS } from '@orbit/protocol'
import { Attachments } from '../src/attachments.ts'

test('attachments preserve binary content, stay private and are scoped to a mission after restart', () => {
  const root = mkdtempSync(join(tmpdir(), 'orbit-files-'))
  const files = new Attachments(root)
  const bytes = Buffer.from([0, 1, 255, 5])
  const item = files.add('mission-a', { name: '../../photo.png', mime: 'image/png', data: bytes.toString('base64') })
  assert.equal(item.name, 'photo.png')
  assert.deepEqual(readFileSync(item.path), bytes)
  assert.equal(statSync(item.path).mode & 0o777, 0o600)
  assert.equal(new Attachments(root).get('mission-a', item.id).path, item.path)
  assert.throws(() => files.get('mission-b', item.id), /Anexo/)
  assert.throws(() => files.get('mission-a', '../../etc/passwd'), /Anexo/)
  assert.throws(() => files.add('mission-a', { name: 'x', mime: 'text/plain', data: 'not base64!' }), /inválido/)
  assert.throws(() => files.add('mission-a', { name: 'x', mime: '', data: Buffer.alloc(ATTACHMENT_LIMITS.bytes + 1).toString('base64') }), /4 MB/)
  files.remove('mission-a')
  assert.throws(() => files.get('mission-a', item.id), /Anexo/)
})
