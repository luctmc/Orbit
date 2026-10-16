import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { snapshotRepository, repositoryTask, prepareRepositoryTask, checkRepositoryTask, seedRepositoryRegressions } from './repository-pilot.mjs'

test('regression replay checks both hashes before mutation and restores only declared source paths', () => {
  const from = realpathSync(mkdtempSync(join(tmpdir(), 'orbit-source-oracle-test-')))
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orbit-replay-target-')))
  const files = []
  for (const path of ['packages/sidecar/src/usage.ts', 'packages/sidecar/src/report.ts']) {
    for (const dir of [from, root]) mkdirSync(join(dir, 'packages/sidecar/src'), { recursive: true })
    writeFileSync(join(from, path), 'old source'); writeFileSync(join(root, path), 'current source')
    files.push({ path, sha256: createHash('sha256').update('old source').digest('hex') })
  }
  const path = join(from, 'manifest.json'), manifest = { fixtureRoot: from, files }
  writeFileSync(path, JSON.stringify(manifest))
  writeFileSync(join(from, files[1].path), 'changed after manifest')
  assert.throws(() => seedRepositoryRegressions(root, path), /hash mismatch/)
  assert.equal(readFileSync(join(root, files[0].path), 'utf8'), 'current source')
  writeFileSync(join(from, files[1].path), 'old source')
  writeFileSync(join(root, 'untouched.txt'), 'keep')
  assert.equal(seedRepositoryRegressions(root, path).files.length, 2)
  assert.equal(readFileSync(join(root, files[0].path), 'utf8'), 'old source')
  assert.equal(readFileSync(join(root, 'untouched.txt'), 'utf8'), 'keep')
  assert.throws(() => seedRepositoryRegressions(from, path), /distinct/)
})

test('repository snapshot resolves workspace packages locally and excludes personal/build data', () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'orbit-repo-copy-test-'))), repo = join(base, 'source'), root = join(base, 'copy')
  mkdirSync(join(repo, 'packages/protocol/src'), { recursive: true }); mkdirSync(join(repo, 'node_modules'), { recursive: true })
  mkdirSync(join(repo, 'apps/desktop/build'), { recursive: true })
  writeFileSync(join(repo, 'package.json'), '{"type":"module"}')
  writeFileSync(join(repo, 'packages/protocol/package.json'), '{"name":"@orbit/protocol","type":"module","exports":"./src/index.ts"}')
  writeFileSync(join(repo, 'packages/protocol/src/index.ts'), 'export const origin="copy"')
  writeFileSync(join(repo, '.env'), 'PRIVATE=do-not-copy')
  writeFileSync(join(repo, 'apps/desktop/build/generated.json'), '{}')
  execFileSync('git', ['init'], { cwd: repo, stdio: 'pipe' })
  const snapshot = snapshotRepository(repo, root)
  assert.equal(snapshot.fileCount, 3)
  assert.equal(realpathSync(join(root, 'node_modules/@orbit/protocol')), join(root, 'packages/protocol'))
  assert.equal(execFileSync(process.execPath, ['--input-type=module', '-e', "console.log(import.meta.resolve('@orbit/protocol'))"], { cwd: root, encoding: 'utf8' }).trim(), `file://${root}/packages/protocol/src/index.ts`)
  mkdirSync(join(root, 'packages/sidecar/src'), { recursive: true })
  writeFileSync(join(root, 'packages/sidecar/src/usage.ts'), '')
  const baseline = prepareRepositoryTask(root, 'usage')
  rmSync(join(root, 'node_modules/@orbit/protocol'))
  symlinkSync(join(repo, 'packages/protocol'), join(root, 'node_modules/@orbit/protocol'))
  const checks = checkRepositoryTask(repositoryTask('usage'), root, baseline)
  assert.equal(checks.length, 1); assert.match(checks[0].summary, /node_modules\/@orbit\/protocol/)
})

test('oracle rejects modified tests and unexpected files before executing any check', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orbit-repo-oracle-test-')))
  mkdirSync(join(root, 'packages/sidecar/src'), { recursive: true })
  mkdirSync(join(root, 'packages/sidecar/test'), { recursive: true })
  writeFileSync(join(root, 'packages/sidecar/src/usage.ts'), 'original')
  writeFileSync(join(root, 'packages/sidecar/test/usageCounters.test.ts'), 'throw new Error("must not execute")')
  const baseline = prepareRepositoryTask(root, 'usage'), task = repositoryTask('usage')
  writeFileSync(join(root, 'packages/sidecar/test/usageCounters.test.ts'), '')
  const checks = checkRepositoryTask(task, root, baseline)
  assert.equal(checks.length, 1); assert.equal(checks[0].exitCode, 1)
  assert.match(checks[0].summary, /usageCounters/)
  writeFileSync(join(root, 'packages/sidecar/test/usageCounters.test.ts'), 'throw new Error("must not execute")')
  symlinkSync('/private/tmp', join(root, 'escape'))
  assert.equal(checkRepositoryTask(task, root, baseline)[0].exitCode, 1)
})

test('second task protects the first patch and runs the copied sources', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orbit-repo-sequence-test-')))
  mkdirSync(join(root, 'packages/sidecar/src'), { recursive: true }); mkdirSync(join(root, 'packages/sidecar/test'), { recursive: true })
  for (const name of ['usage', 'report']) writeFileSync(join(root, `packages/sidecar/src/${name}.ts`), `export const ${name}=true`)
  writeFileSync(join(root, 'packages/sidecar/test/usageCounters.test.ts'), "import assert from 'node:assert/strict';import {usage} from '../src/usage.ts';assert.equal(usage,true)")
  writeFileSync(join(root, 'packages/sidecar/test/reportCost.test.ts'), "import assert from 'node:assert/strict';import {report} from '../src/report.ts';assert.equal(report,true)")
  const first = prepareRepositoryTask(root, 'usage')
  assert.ok(checkRepositoryTask(repositoryTask('usage'), root, first).every(c => c.exitCode === 0))
  writeFileSync(join(root, 'packages/sidecar/src/usage.ts'), 'export const usage=true // first patch')
  const second = prepareRepositoryTask(root, 'report')
  assert.ok(checkRepositoryTask(repositoryTask('report'), root, second).every(c => c.exitCode === 0))
  writeFileSync(join(root, 'packages/sidecar/src/usage.ts'), 'export const usage=false')
  const checks = checkRepositoryTask(repositoryTask('report'), root, second)
  assert.equal(checks.length, 1); assert.equal(checks[0].exitCode, 1)
  assert.match(checks[0].summary, /usage.ts/)
})
