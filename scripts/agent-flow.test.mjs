import test from 'node:test'
import assert from 'node:assert/strict'
import { checkBranch, normalizeFiles, overlaps } from './agent-flow.mjs'

test('accepts requested prefixes and blocks main or unrelated branches', () => {
  for (const name of ['feature/orbit-release-automatico', 'fix/orbit-resumo_do_ajuste']) assert.equal(checkBranch(name), name)
  for (const name of ['main', 'feature/foo', 'fix/orbit-../main', 'feature/orbit-x;echo']) assert.throws(() => checkBranch(name))
})
test('claims detect exact file and parent-directory conflicts', () => {
  assert.ok(overlaps('apps/desktop', 'apps/desktop/src/App.tsx'))
  assert.ok(overlaps('scripts/release.mjs', 'scripts/release.mjs'))
  assert.ok(!overlaps('apps/desktop', 'apps/desktop-other'))
  assert.ok(!overlaps('scripts/a.mjs', 'scripts/b.mjs'))
})
test('normalizes claims and refuses unsafe or empty paths', () => {
  assert.deepEqual(normalizeFiles(['./scripts/', 'scripts']), ['scripts'])
  for (const files of [[], ['../other'], ['/tmp/file'], ['.git/config'], ['a/../../b']]) assert.throws(() => normalizeFiles(files))
})

import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
const script = fileURLToPath(new URL('./agent-flow.mjs', import.meta.url))

test('real git worktrees reserve paths and reject overlap or preexisting changes', () => {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'orbit-agent-flow-')))
  const repo = join(scratch, 'repo'), remote = join(scratch, 'remote.git')
  const git = (args, cwd = repo) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const run = args => spawnSync(process.execPath, [script, ...args], { cwd: repo, encoding: 'utf8' })
  try {
    execFileSync('git', ['init', '--bare', remote], { stdio: 'ignore' })
    execFileSync('git', ['init', '-b', 'main', repo], { stdio: 'ignore' })
    git(['config', 'user.name', 'Orbit Test']); git(['config', 'user.email', 'orbit-test@example.invalid'])
    writeFileSync(join(repo, 'file.txt'), 'base\n')
    git(['add', 'file.txt']); git(['commit', '-m', 'base'])
    git(['remote', 'add', 'origin', remote]); git(['push', '-u', 'origin', 'main'])
    const base = git(['rev-parse', 'origin/main'])
    const first = run(['begin', 'feature/orbit-first', 'src'])
    assert.equal(first.status, 0, first.stderr)
    const target = join(scratch, 'Orbit-feature-orbit-first')
    assert.equal(git(['rev-parse', 'HEAD'], target), base)
    assert.equal(JSON.parse(readFileSync(join(repo, '.git/orbit-agent-claims.json'), 'utf8'))[0].worktree, target)
    const second = run(['begin', 'fix/orbit-overlap', 'src/file.ts'])
    assert.notEqual(second.status, 0)
    assert.match(second.stderr, /reservado/)
    writeFileSync(join(repo, 'file.txt'), 'someone else is editing\n')
    const dirty = run(['begin', 'fix/orbit-dirty', 'file.txt'])
    assert.notEqual(dirty.status, 0)
    assert.match(dirty.stderr, /já tem mudanças/)
    assert.equal(run(['begin', 'fix/orbit-independent', 'other.txt']).status, 0)
    assert.match(run(['finish']).stderr, /Use feature/)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
})
