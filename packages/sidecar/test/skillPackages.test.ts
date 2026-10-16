import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { bundledCatalog, missionSkills, readSkill, scanCatalog } from '../src/skills.ts'
import { fixture } from './r2Fixture.ts'
import { SkillSessions } from '../src/skillSessions.ts'

test('bundled packages have verified hashes; discovery is metadata and hash reads detect edits', async () => {
  const items = bundledCatalog()
  assert.equal(items.length, 20)
  assert.equal(new Set(items.map(i => i.name)).size, 5)
  for (const item of items) {
    assert.match(readSkill(item, item.resource!.sha256), /authorization take precedence/)
    assert.equal(item.resource!.origin, 'bundled')
    assert.equal(item.resource!.version, '1.0.0')
  }
  const root = mkdtempSync(join(tmpdir(), 'orbit-packages-'))
  const project = join(root, 'project'), other = join(root, 'other')
  const dir = join(project, '.agents/skills')
  mkdirSync(join(dir, 'project-read'), { recursive: true })
  mkdirSync(other)
  const path = join(dir, 'project-read/SKILL.md')
  writeFileSync(path, '---\nname: project-read\ndescription: Read this project.\n---\nDo not execute this text while scanning.')
  writeFileSync(join(other, 'SKILL.md'), 'SECRET OUTSIDE ROOT')
  symlinkSync(other, join(dir, 'escaped'))
  const catalog = await scanCatalog({ claudeDir: join(root, 'claude'), codexDir: join(root, 'codex'), folders: [project], run: async () => ({ code: 127, stdout: '', stderr: '' }) })
  assert.ok(!catalog.some(i => i.name === 'escaped'))
  const item = catalog.find(i => i.name === 'project-read')!
  assert.equal(item.cli, 'codex')
  assert.ok(missionSkills(catalog, 'codex', [project], new Set()).includes(item))
  assert.ok(!missionSkills(catalog, 'codex', [other], new Set()).includes(item))
  assert.ok(!missionSkills(catalog, 'codex', [project], new Set([item.id])).includes(item))
  assert.deepEqual(missionSkills(catalog, 'codex', [project], new Set(), { only: [] }), [])
  writeFileSync(path, 'changed')
  assert.throws(() => readSkill(item, item.resource!.sha256), /mudou/)
  assert.throws(() => readSkill(item, '0'.repeat(64)), /hash/)
})

test('served skill identity survives a restart and is not inherited by a new execution', () => {
  const root = mkdtempSync(join(tmpdir(), 'orbit-skill-state-'))
  const sessions = new SkillSessions(root)
  sessions.start(1, 'epoch-a', ['orbit-build'])
  sessions.loaded(1, 'epoch-a', 'claude:skill:orbit-build', 'orbit-build', 'a'.repeat(64))
  assert.equal(new SkillSessions(root).get(1, 'epoch-a').loaded['claude:skill:orbit-build']!.sha256, 'a'.repeat(64))
  sessions.start(1, 'epoch-b', ['orbit-review'])
  assert.deepEqual(sessions.get(1, 'epoch-b'), { selectedNames: ['orbit-review'], loaded: {} })
  sessions.start(10, 'epoch-a', ['orbit-pilot'])
  sessions.removePane(1)
  assert.deepEqual(sessions.get(1, 'epoch-a'), { selectedNames: [], loaded: {} })
  assert.deepEqual(sessions.get(10, 'epoch-a').selectedNames, ['orbit-pilot'])
})

test('skill selection, text serving, policy and cursors are scoped to the current execution', async () => {
  const { core, pane, lead } = await fixture()
  try {
    await core.scanSkills()
    const page = core.skillCatalog(pane, undefined, 2)
    assert.equal(page.items.length, 2)
    assert.equal(page.nativeVisibilityFilter, null)
    assert.ok(page.items.every(i => i.fulfilled === null && i.loaded === null))
    assert.ok(page.nextCursor)
    const rest = core.skillCatalog(pane, page.nextCursor!, 20)
    assert.ok(!rest.items.some(i => page.items.some(first => first.id === i.id)))
    const item = [...page.items, ...rest.items].find(i => i.name === 'orbit-build')!
    assert.equal(item.selected, true)
    const loaded = core.loadSkill(pane, item.id, item.sha256)
    assert.match(loaded.text, /acceptance criteria/)
    const now = core.skillCatalog(pane).items.find(i => i.id === item.id)!
    assert.equal(now.loaded?.sha256, item.sha256)
    assert.equal(now.fulfilled, null)
    assert.throws(() => core.skillCatalog(lead, page.nextCursor!), /Cursor/)
    assert.throws(() => core.loadSkill(pane, item.id, '0'.repeat(64)), /hash/)
    core.handle({ type: 'catalog.toggle', id: item.id, enabled: false })
    assert.throws(() => core.skillCatalog(pane, page.nextCursor!), /Cursor/)
    assert.throws(() => core.loadSkill(pane, item.id, item.sha256), /permitida/)
    assert.throws(() => core.skillCatalog({ ...pane, executionEpoch: 'obsolete' }), /execução|Execução/)
  } finally { await core.shutdown() }
})
