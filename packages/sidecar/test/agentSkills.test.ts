import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, unlinkSync, readlinkSync, realpathSync, lstatSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prepareAgentSkills } from '../src/agentSkills.ts'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'orbit-agent-skills-'))
  const home = join(root, 'home'), data = join(root, 'data'), logs: string[] = []
  mkdirSync(join(home, '.claude', 'skills'), { recursive: true })
  mkdirSync(data)
  const skill = (name: string, valid = true) => {
    const path = join(home, '.claude', 'skills', name)
    mkdirSync(path, { recursive: true })
    if (valid) writeFileSync(join(path, 'SKILL.md'), '# Fixture')
    return realpathSync(path)
  }
  return { root, home, data, logs, skill, prepare: (names: string[]) => prepareAgentSkills(data, names, home, message => logs.push(message)) }
}

test('skill symlinks are idempotent, follow installed targets and remove stale selections', () => {
  const f = fixture(), target = f.skill('unslop')
  const directory = f.prepare(['unslop'])!
  const link = join(directory, '.claude', 'skills', 'unslop')
  assert.equal(readlinkSync(link), target)
  const before = lstatSync(link).ino
  assert.equal(f.prepare(['unslop']), directory)
  assert.equal(lstatSync(link).ino, before)
  const replacement = join(f.root, 'replacement')
  mkdirSync(replacement); writeFileSync(join(replacement, 'SKILL.md'), '# Updated')
  // Installed skills may themselves be symlinks to a user's external checkout.
  symlinkSync(replacement, join(f.home, '.claude', 'skills', 'updated'))
  f.prepare(['updated'])
  assert.equal(existsSync(link), false)
  const updatedLink = join(directory, '.claude', 'skills', 'updated')
  assert.equal(readlinkSync(updatedLink), realpathSync(replacement))
  unlinkSync(join(f.home, '.claude', 'skills', 'updated'))
  symlinkSync(target, join(f.home, '.claude', 'skills', 'updated'))
  f.prepare(['updated'])
  assert.equal(readlinkSync(updatedLink), target)
  unlinkSync(join(target, 'SKILL.md'))
  f.prepare(['updated'])
  assert.equal(existsSync(updatedLink), false)
})

test('missing or invalid skills are logged and skipped without escaping the managed directory', () => {
  const f = fixture()
  f.skill('no-manifest', false)
  const directory = f.prepare(['missing', 'no-manifest', '..', '../escape', '/absolute', '.hidden'])!
  assert.deepEqual(readdirSync(join(directory, '.claude', 'skills')), [])
  assert.equal(f.logs.length, 6)
  assert.deepEqual(readdirSync(f.data), ['agent-skills'])
  assert.equal(existsSync(join(f.root, 'escape')), false)
})

test('redirected managed directories cannot write outside the Orbit skill folder', () => {
  for (const parts of [[], ['.claude'], ['.claude', 'skills']]) {
    const f = fixture(), outside = join(f.root, 'outside')
    f.skill('unslop'); mkdirSync(outside)
    const link = join(f.data, 'agent-skills', ...parts)
    mkdirSync(join(link, '..'), { recursive: true })
    symlinkSync(outside, link)
    assert.equal(f.prepare(['unslop']), undefined)
    assert.deepEqual(readdirSync(outside), [])
    assert.ok(f.logs.length)
  }
})

test('a stray file in the managed skills folder is ignored and never blocks the allowed skills', () => {
  const f = fixture(); f.skill('unslop')
  const directory = f.prepare(['unslop'])!
  const stray = join(directory, '.claude', 'skills', '.DS_Store')
  writeFileSync(stray, 'x')
  assert.equal(f.prepare(['unslop']), directory)
  assert.ok(lstatSync(join(directory, '.claude', 'skills', 'unslop')).isSymbolicLink())
  assert.ok(existsSync(stray), 'the stray entry is kept, only Orbit links are managed')
})
