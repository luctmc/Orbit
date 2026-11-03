import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs, { mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SQUAD_LIMITS } from '@orbit/protocol'

const metadata = { id: 'revisor', name: 'Revisor', cli: 'codex', model: 'gpt-6.1-sol', skills: ['review'], onlySkills: true }
function fixture(t: import('node:test').TestContext, id = 'revisor') {
  const root = mkdtempSync(join(tmpdir(), 'orbit-role-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const dir = join(root, '.maestri', 'roles', id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'role.json'), JSON.stringify({ ...metadata, id }))
  for (const file of ['CLAUDE.md', 'AGENTS.md']) writeFileSync(join(dir, file), 'Revise sem editar.\n')
  return { root, dir }
}
async function load(root: string) {
  const { loadRoleFiles } = await import('../src/roleFiles.ts')
  return loadRoleFiles(root)
}

test('role válido preserva brief, CLI, modelo, skills e assume somente leitura', async t => {
  const { root } = fixture(t)
  assert.deepEqual(await load(root), { roles: [{ ...metadata, brief: 'Revise sem editar.\n', readOnly: true }], ignored: [] })
})

test('readOnly false e modelo/skills omitidos têm defaults explícitos', async t => {
  const { root, dir } = fixture(t)
  writeFileSync(join(dir, 'role.json'), JSON.stringify({ id: 'revisor', name: 'Revisor', cli: 'claude', readOnly: false }))
  assert.deepEqual((await load(root)).roles[0], { id: 'revisor', name: 'Revisor', cli: 'claude', model: null, brief: 'Revise sem editar.\n', skills: [], onlySkills: false, readOnly: false })
})

const invalid: Array<[string, (dir: string) => void, RegExp]> = [
  ['id diferente', d => writeFileSync(join(d, 'role.json'), JSON.stringify({ ...metadata, id: 'outro' })), /^id diferente do diretório$/],
  ['JSON inválido', d => writeFileSync(join(d, 'role.json'), '{'), /JSON inválido/],
  ['Maestri sem role.json', d => rmSync(join(d, 'role.json')), /^role.json ausente$/],
  ['CLAUDE ausente', d => rmSync(join(d, 'CLAUDE.md')), /CLAUDE.md ausente/],
  ['AGENTS ausente', d => rmSync(join(d, 'AGENTS.md')), /AGENTS.md ausente/],
  ['briefs diferentes', d => writeFileSync(join(d, 'AGENTS.md'), 'outro'), /^CLAUDE.md e AGENTS.md diferentes$/],
  ['briefs diferentes byte a byte', d => { writeFileSync(join(d, 'CLAUDE.md'), Buffer.from([0xff])); writeFileSync(join(d, 'AGENTS.md'), Buffer.from([0xfe])) }, /^CLAUDE.md e AGENTS.md diferentes$/],
  ['brief vazio', d => { for (const f of ['CLAUDE.md', 'AGENTS.md']) writeFileSync(join(d, f), ' \n') }, /brief vazio/],
  ['brief acima do limite', d => { for (const f of ['CLAUDE.md', 'AGENTS.md']) writeFileSync(join(d, f), 'x'.repeat(SQUAD_LIMITS.brief + 1)) }, /brief.*limite/],
  ['arquivo enorme', d => writeFileSync(join(d, 'role.json'), ' '.repeat(100_000)), /limite/],
]
for (const [name, mutate, reason] of invalid) test(`ignora ${name} sem interromper a leitura`, async t => {
  const { root, dir } = fixture(t); mutate(dir)
  const result = await load(root)
  assert.equal(result.roles.length, 0); assert.equal(result.ignored.length, 1)
  assert.equal(result.ignored[0]!.dir, dir); assert.match(result.ignored[0]!.reason, reason)
})
for (const [name, patch] of Object.entries({ cli: { cli: 'shell' }, extra: { command: 'touch /tmp/never' }, name: { name: 3 }, model: { model: 4 }, unsafeModel: { model: 'x;echo secret' }, skills: { skills: [2] }, skillsType: { skills: 'review' }, onlySkills: { onlySkills: 'true' }, readOnly: { readOnly: 'false' } })) {
  test(`ignora campo inválido: ${name}`, async t => {
    const { root, dir } = fixture(t)
    writeFileSync(join(dir, 'role.json'), JSON.stringify({ ...metadata, ...patch }))
    const result = await load(root)
    assert.equal(result.roles.length, 0); assert.ok(result.ignored[0]!.reason)
  })
}
test('slug inválido não é normalizado silenciosamente', async t => {
  const { root } = fixture(t, 'Revisor')
  assert.match((await load(root)).ignored[0]!.reason, /slug/)
})
test('nove roles preservam os oito primeiros e explicam o excedente', async t => {
  const { root, dir } = fixture(t, 'r0')
  for (let i = 1; i < 9; i++) {
    const next = join(dir, '..', `r${i}`); mkdirSync(next)
    writeFileSync(join(next, 'role.json'), JSON.stringify({ ...metadata, id: `r${i}` }))
    for (const f of ['CLAUDE.md', 'AGENTS.md']) writeFileSync(join(next, f), 'Revise.')
  }
  const result = await load(root)
  assert.deepEqual(result.roles.map(r => r.id), ['r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7'])
  assert.equal(result.ignored.length, 1); assert.match(result.ignored[0]!.reason, /limite.*8/)
})
for (const target of ['directory', 'role.json', 'CLAUDE.md', 'AGENTS.md', 'roles', '.maestri']) test(`não segue symlink: ${target}`, async t => {
  const { root, dir } = fixture(t)
  const outside = mkdtempSync(join(tmpdir(), 'orbit-outside-')); t.after(() => rmSync(outside, { recursive: true, force: true }))
  const path = target === 'directory' ? dir : target === 'roles' ? join(root, '.maestri', 'roles') : target === '.maestri' ? join(root, '.maestri') : join(dir, target)
  rmSync(path, { recursive: true, force: true }); symlinkSync(outside, path)
  const result = await load(root)
  assert.equal(result.roles.length, 0); assert.match(result.ignored[0]!.reason, /symlink|link simbólico/)
})
test('repositório sem diretório de roles retorna vazio sem erro', async t => {
  const { root } = fixture(t); rmSync(join(root, '.maestri'), { recursive: true })
  assert.deepEqual(await load(root), { roles: [], ignored: [] })
})

// The real open is retained: the hook only places the filesystem race at a deterministic boundary.
for (const target of ['role.json', 'CLAUDE.md', 'AGENTS.md']) for (const restore of [false, true]) {
  test(`recusa troca de diretório antes de abrir ${target}, restauração=${restore}`, async t => {
    const { root, dir } = fixture(t)
    const outside = fixture(t).dir
    for (const file of ['CLAUDE.md', 'AGENTS.md']) writeFileSync(join(outside, file), 'EXTERNO válido e não vazio.')
    const { loadRoleFiles } = await import('../src/roleFiles.ts')
    const original = fs.openSync
    let swapped = false
    fs.openSync = ((path, ...args) => {
      if (String(path) !== join(dir, target) || swapped) return original(path, ...args)
      swapped = true
      renameSync(dir, `${dir}-original`)
      symlinkSync(outside, dir)
      const fd = original(path, ...args)
      if (restore) { rmSync(dir); renameSync(`${dir}-original`, dir) }
      return fd
    }) as typeof fs.openSync
    syncBuiltinESMExports()
    try {
      const result = loadRoleFiles(root)
      assert.equal(swapped, true)
      assert.deepEqual(result.roles, [])
      assert.match(result.ignored[0]!.reason, /caminho mudou durante a leitura/)
    } finally { fs.openSync = original; syncBuiltinESMExports() }
  })
}
