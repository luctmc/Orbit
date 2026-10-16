import { test } from 'node:test'
import assert from 'node:assert/strict'
import { messageBlocks, messageInline } from './messageFormat.ts'

test('leader responses retain headings, numbered steps, code and unfinished streaming fences', () => {
  assert.deepEqual(messageBlocks('## Entrega\n\nFeito.\n\n3. Verificar\n4. Revisar\n\n```ts\nconst a = 1\n```\n> Evidência'), [
    { kind: 'heading', level: 2, text: 'Entrega' }, { kind: 'paragraph', text: 'Feito.' },
    { kind: 'list', ordered: true, start: 3, items: ['Verificar', 'Revisar'] },
    { kind: 'code', language: 'ts', text: 'const a = 1' }, { kind: 'quote', text: 'Evidência' },
  ])
  assert.deepEqual(messageBlocks('```sh\nnpm test'), [{ kind: 'code', language: 'sh', text: 'npm test' }])
})
test('untrusted responses never produce executable links or raw HTML nodes', () => {
  for (const url of ['javascript:alert', 'data:text/html,x', 'file:///etc/passwd', 'https://user:pass@example.com']) {
    assert.equal(messageInline(`[abrir](${url})`).some(part => part.kind === 'link'), false)
  }
  assert.deepEqual(messageInline('<img src=x onerror=alert(1)>'), [{ kind: 'text', text: '<img src=x onerror=alert(1)>' }])
  assert.deepEqual(messageInline('**Feito** em `a.ts` [fonte](https://example.com)'), [
    { kind: 'strong', text: 'Feito' }, { kind: 'text', text: ' em ' }, { kind: 'code', text: 'a.ts' },
    { kind: 'text', text: ' ' }, { kind: 'link', text: 'fonte', href: 'https://example.com/' },
  ])
})
