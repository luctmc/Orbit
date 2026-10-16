// A code snapshot, never the user's Git checkout or application data. No CLI/model calls here.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex')
const ignored = new Set(['.git', 'node_modules', '.claude', '.codex', 'target', 'build', 'dist', '.vite'])
const sourceRoot = /^(packages\/|apps\/desktop\/(src\/|src-tauri\/(src\/|native\/|capabilities\/|icons\/|[^/]+$)|public\/|[^/]+$)|scripts\/|\.github\/)/
const rootFiles = new Set(['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.base.json', 'README.md', '.gitignore'])
const extension = /\.(?:ts|tsx|js|mjs|cjs|json|md|css|html|svg|png|jpg|jpeg|webp|ico|rs|toml|lock|yml|yaml)$/

export function repositoryTask(name) {
  if (name === 'usage') return { id: 'orbit-usage', category: 'bug', allowedWrites: ['packages/sidecar/src/usage.ts'], tests: ['packages/sidecar/test/usageCounters.test.ts'], checks: [{ label: 'Codex output includes reasoning once, preserves native total and unknown cost' }], goal: 'Fix fromCodexRollout in Orbit: output_tokens already includes reasoning_output_tokens. Preserve the provider output_tokens and total_tokens without adding reasoning twice. Preserve all other accounting, limits and observation semantics. Protected tests cover positive, zero and absent reasoning.' }
  if (name === 'report') return { id: 'orbit-report', category: 'bug', allowedWrites: ['packages/sidecar/src/report.ts'], tests: ['packages/sidecar/test/reportCost.test.ts', 'packages/sidecar/test/usageCounters.test.ts'], checks: [{ label: 'Markdown distinguishes reported zero, unknown USD and known subtotal; previous token fix stays green' }], goal: 'Fix missionReport in Orbit: show reported cost 0 as US$ 0,00; null must explicitly say "custo em USD não informado". For known cost, retain pt-BR currency and say "subtotal informado pelo Claude; outros custos podem estar ausentes", without claiming full coverage or a bill. Preserve all other report sections. The previous usage counter correction must remain intact.' }
  throw new Error('Repository task must be usage or report')
}

/** Explicit replay of known fixed bugs, only in an owned source snapshot. */
export function seedRepositoryRegressions(root, manifestPath) {
  const raw = readFileSync(manifestPath), manifest = JSON.parse(raw)
  const from = realpathSync(manifest.fixtureRoot)
  if (!from.startsWith(realpathSync(tmpdir()) + '/orbit-source-oracle-') || realpathSync(root) === from) throw new Error('Regression replay requires a distinct owned temporary snapshot')
  const paths = ['packages/sidecar/src/usage.ts', 'packages/sidecar/src/report.ts']
  // Validate both sources before any mutation. Never restore an arbitrary manifest path.
  const records = paths.map(path => {
    const entry = manifest.files?.find(f => f.path === path)
    const src = join(from, path)
    if (!entry || !lstatSync(src).isFile() || lstatSync(src).isSymbolicLink() || sha(src) !== entry.sha256) throw new Error(`Regression replay source hash mismatch: ${path}`)
    const dest = join(root, path)
    if (!lstatSync(dest).isFile() || lstatSync(dest).isSymbolicLink()) throw new Error(`Regression replay target must be an ordinary source file: ${path}`)
    return { path, sha256: entry.sha256 }
  })
  for (const { path } of records) copyFileSync(join(from, path), join(root, path))
  return { kind: 'replay of two locally reproduced and fixed bugs; fixture changes only', manifestSha256: createHash('sha256').update(raw).digest('hex'), files: records }
}

function files(root, prefix = '') {
  const result = []
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isSymbolicLink()) throw new Error(`Unexpected source symlink: ${path}`)
    if (entry.isDirectory()) result.push(...files(root, path))
    else result.push(path)
  }
  return result.sort()
}

export function snapshotRepository(repo, root) {
  mkdirSync(root, { recursive: true })
  const names = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: repo, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).split('\0').filter(Boolean)
  const copied = [], seen = new Set()
  for (const path of names.sort()) {
    if (seen.has(path) || path.split('/').some(p => ignored.has(p)) || !(rootFiles.has(path) || sourceRoot.test(path) && extension.test(path))) continue
    seen.add(path)
    const from = join(repo, path)
    if (!existsSync(from)) continue // A deleted tracked path remains deleted in the snapshot.
    const stat = lstatSync(from)
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Snapshot requires ordinary source files: ${path}`)
    if (stat.size > 32 * 1024 * 1024 || copied.length >= 20000) throw new Error('Snapshot source limit exceeded')
    const dest = join(root, path); mkdirSync(dirname(dest), { recursive: true }); copyFileSync(from, dest)
    copied.push({ path, sha256: sha(dest), bytes: stat.size })
  }
  if (!copied.length || copied.reduce((n, f) => n + f.bytes, 0) > 128 * 1024 * 1024) throw new Error('Snapshot empty or too large')
  // External dependencies share the already installed runtime. Workspace aliases must resolve
  // to the snapshot; linking the entire original node_modules would silently test original code.
  mkdirSync(join(root, 'node_modules', '@orbit'), { recursive: true })
  for (const entry of readdirSync(join(repo, 'node_modules'))) {
    if (entry === '@orbit') continue
    symlinkSync(join(repo, 'node_modules', entry), join(root, 'node_modules', entry))
  }
  for (const [name, path] of Object.entries({ protocol: 'packages/protocol', sidecar: 'packages/sidecar', desktop: 'apps/desktop' })) {
    if (existsSync(join(root, path, 'package.json'))) symlinkSync(join(root, path), join(root, 'node_modules', '@orbit', name))
  }
  return { kind: 'current Orbit code snapshot; no Git history or personal data', files: copied, fileCount: copied.length, bytes: copied.reduce((n, f) => n + f.bytes, 0), externalDependencies: 'shared installed packages; @orbit aliases resolve inside snapshot' }
}

export function prepareRepositoryTask(root, name) {
  const task = repositoryTask(name)
  mkdirSync(join(root, '.benchmark'), { recursive: true })
  // This exact script is included in the protected snapshot below. No install or network.
  writeFileSync(join(root, '.benchmark', 'all.mjs'), `import {spawnSync} from 'node:child_process';\nconst env={...process.env}; delete env.NODE_TEST_CONTEXT;\nconst r=spawnSync(process.execPath,['--test',...${JSON.stringify(task.tests)}],{cwd:${JSON.stringify(realpathSync(root))},env,stdio:'inherit',timeout:20000});\nif(r.error) console.error(r.error.message);\nprocess.exit(r.status??1);\n`)
  const aliases = {}
  for (const name of ['protocol', 'sidecar', 'desktop']) {
    const path = join(root, 'node_modules', '@orbit', name)
    if (existsSync(path)) aliases[name] = realpathSync(path)
  }
  return { taskId: task.id, root: realpathSync(root), aliases, files: Object.fromEntries(files(root).map(path => [path, sha(join(root, path))])) }
}

export function checkRepositoryTask(task, root, baseline) {
  if (realpathSync(root) !== baseline.root || task.id !== baseline.taskId) throw new Error('Oracle snapshot identity mismatch')
  let paths
  try { paths = files(root) } catch (e) { return [{ command: 'verify repository write scope and protected oracle', exitCode: 1, summary: e.message }] }
  const allowed = new Set(task.allowedWrites), all = new Set([...paths, ...Object.keys(baseline.files)])
  const bad = [...all].filter(path => !allowed.has(path) && (!existsSync(join(root, path)) || sha(join(root, path)) !== baseline.files[path]))
  for (const [name, expected] of Object.entries(baseline.aliases ?? {})) {
    try { if (realpathSync(join(root, 'node_modules', '@orbit', name)) !== expected) bad.push(`node_modules/@orbit/${name}`) }
    catch { bad.push(`node_modules/@orbit/${name}`) }
  }
  for (const path of allowed) if (!existsSync(join(root, path)) || !lstatSync(join(root, path)).isFile() || lstatSync(join(root, path)).isSymbolicLink()) bad.push(path)
  const checks = [{ command: 'verify repository write scope and protected oracle', exitCode: bad.length ? 1 : 0, summary: bad.length ? `Unexpected source edits: ${bad.join(', ')}` : 'All protected repository sources and oracle unchanged' }]
  if (bad.length) return checks // Never execute modified oracle or tests.
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT
  try {
    const stdout = execFileSync(process.execPath, ['.benchmark/all.mjs'], { cwd: root, env, encoding: 'utf8', timeout: 25000, maxBuffer: 1024 * 1024 })
    checks.push({ command: `${process.execPath} .benchmark/all.mjs`, exitCode: 0, summary: stdout.slice(-1500) })
  } catch (e) {
    checks.push({ command: `${process.execPath} .benchmark/all.mjs`, exitCode: e.status ?? 1, summary: `${e.stdout ?? ''}\n${e.stderr ?? e.message}`.slice(-2500) })
  }
  return checks
}
