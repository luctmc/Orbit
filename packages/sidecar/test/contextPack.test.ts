import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildContextPack, ContextLibrary } from '../src/contextPack.ts'

test('budget keeps the full contract and exposes omitted context by immutable reference', () => {
  const library = new ContextLibrary(mkdtempSync(join(tmpdir(), 'orbit-context-')))
  const sections = [
    { id: 'objective', text: '# Objective\nNão publicar. Aceite: precisão 🛰️.', required: true },
    { id: 'history', text: 'é🛰️'.repeat(1000), maxBytes: 100 },
    { id: 'safety', text: '## Contract\nRead only; unresolved work blocks ready.', required: true },
  ]
  const pack = buildContextPack(sections, 600, s => library.put('mission-a', s))
  assert.ok(pack.bytes <= 600)
  assert.ok(pack.sourceBytes > pack.bytes)
  assert.ok(pack.text.includes(sections[0]!.text))
  assert.ok(pack.text.endsWith(sections[2]!.text))
  const ref = pack.references[0]!
  assert.ok(pack.text.includes(ref.sha256))
  let text = '', offset = 0
  do {
    const page = library.read('mission-a', ref.sha256, offset, 73)
    text += page.text
    if (page.nextOffset === null) break
    offset = page.nextOffset
  } while (true)
  assert.equal(text, sections[1]!.text)
  assert.equal(new ContextLibrary(library.root).read('mission-a', ref.sha256, 0, 64).text, sections[1]!.text.slice(0, 64))
  assert.throws(() => library.read('mission-b', ref.sha256), /referência|Referência/)
  assert.throws(() => library.read('mission-a', '../secrets'), /referência|Referência/)
  assert.throws(() => library.read('mission-a', ref.sha256, -1), /Cursor/)
  const path = join(library.root, 'mission-a', `${ref.sha256}.json`)
  writeFileSync(path, readFileSync(path, 'utf8').replace('é', 'x'))
  assert.throws(() => library.read('mission-a', ref.sha256), /integridade/)
})

test('mandatory overflow and duplicate sections fail explicitly without producing a partial contract', () => {
  assert.throws(() => buildContextPack([{ id: 'acceptance', text: 'x'.repeat(500), required: true }], 100, () => { throw Error('must not store') }), /obrigatório/)
  assert.throws(() => buildContextPack([{ id: 'a', text: '1' }, { id: 'a', text: '2' }], 1000, () => { throw Error('unused') }), /duplicada/)
  assert.equal(buildContextPack([{ id: 'short', text: 'small' }], 5, () => { throw Error('needless reference') }).text, 'small')
})
