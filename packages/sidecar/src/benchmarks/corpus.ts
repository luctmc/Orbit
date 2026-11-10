import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, lstatSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

export interface BenchmarkTask {
  id: string
  category: 'operation' | 'bug' | 'multi-file'
  goal: string
  files: Record<string, string>
  allowedWrites: string[]
  checks: Array<{ label: string; code: string }>
  reference: Record<string, string>
  operation?: string[]
}
const check = (label: string, code: string) => ({ label, code })
const childEnv = () => { const env = { ...process.env }; delete env.NODE_TEST_CONTEXT; return env }
const library = (id: string, goal: string, file: string, before: string, after: string, checks: BenchmarkTask['checks']): BenchmarkTask => ({ id, goal, category: 'bug', files: { [file]: before }, reference: { [file]: after }, allowedWrites: [file], checks })
const feature = (id: string, goal: string, files: Record<string, string>, checks: BenchmarkTask['checks']): BenchmarkTask => ({ id, goal, category: 'multi-file', files: Object.fromEntries(Object.keys(files).map(p => [p, 'throw new Error("Not implemented")\n'])), reference: files, allowedWrites: Object.keys(files), checks })
const bootstrap = `import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const mod = path => import(pathToFileURL(resolve(path)).href);
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const cli = (path, args = [], env = {}) => execFileSync(process.execPath, [path, ...args], {encoding:'utf8', env:{...process.env,...env}, timeout:3000}).trim();
`

export const CORPUS: BenchmarkTask[] = [
  { id: 'op-tests', category: 'operation', goal: 'Run npm test. Do not change project files. Deliver the command outcome and test count.', files: { 'package.json': '{"type":"module","scripts":{"test":"node --test unit.test.mjs"}}\n', 'sum.mjs': 'export const sum = values => values.reduce((a,b)=>a+b,0)\n', 'unit.test.mjs': "import {test} from 'node:test'; import assert from 'node:assert/strict'; import {sum} from './sum.mjs'; test('empty',()=>assert.equal(sum([]),0)); test('mixed',()=>assert.equal(sum([2,-3,5]),4));\n" }, allowedWrites: [], reference: {}, operation: ['--test', 'unit.test.mjs'], checks: [check('The fixed unit suite passes', "assert.match(cli('--test',['unit.test.mjs']), /pass 2/)")] },
  { id: 'op-build', category: 'operation', goal: 'Run node build.mjs to generate dist/site.json from site.json. Preserve source files.', files: { 'site.json': '{"title":"Orbit fixture","routes":["/","/settings"]}\n', 'build.mjs': "import {mkdirSync,readFileSync,writeFileSync} from 'node:fs'; const site=JSON.parse(readFileSync('site.json')); mkdirSync('dist',{recursive:true}); writeFileSync('dist/site.json',JSON.stringify({...site,built:true}));\n" }, allowedWrites: ['dist/site.json'], reference: {}, operation: ['build.mjs'], checks: [check('Build artifact contains actual source routes and build flag', "assert.deepEqual(json('dist/site.json'), {title:'Orbit fixture',routes:['/','/settings'],built:true})")] },
  { id: 'op-config', category: 'operation', goal: 'Run node inspect.mjs to write report.json. Preserve configuration and scripts.', files: { 'config.json': '{"host":"127.0.0.1","port":4173,"tls":false}\n', 'inspect.mjs': "import {readFileSync,writeFileSync} from 'node:fs'; const c=JSON.parse(readFileSync('config.json')); writeFileSync('report.json',JSON.stringify({url:`http://${c.host}:${c.port}`,tls:c.tls}));\n" }, allowedWrites: ['report.json'], reference: {}, operation: ['inspect.mjs'], checks: [check('Report reflects the fixed local configuration', "assert.deepEqual(json('report.json'), {url:'http://127.0.0.1:4173',tls:false})")] },
  { id: 'op-health', category: 'operation', goal: 'Run node health.mjs. It must write health.json from the three fixture service records. Preserve source.', files: { 'services.json': '[{"name":"api","ready":true},{"name":"worker","ready":false},{"name":"store","ready":true}]\n', 'health.mjs': "import {readFileSync,writeFileSync} from 'node:fs'; const all=JSON.parse(readFileSync('services.json')); writeFileSync('health.json',JSON.stringify({total:all.length,ready:all.filter(s=>s.ready).length,pending:all.filter(s=>!s.ready).map(s=>s.name)}));\n" }, allowedWrites: ['health.json'], reference: {}, operation: ['health.mjs'], checks: [check('Health report preserves pending services', "assert.deepEqual(json('health.json'), {total:3,ready:2,pending:['worker']})")] },
  library('bug-mean', 'Fix mean(values): an empty numeric array returns 0; otherwise return the arithmetic mean, including negative values.', 'src/stats.mjs', 'export const mean = values => values.reduce((a,b)=>a+b,0)/values.length\n', 'export const mean = values => values.length ? values.reduce((a,b)=>a+b,0)/values.length : 0\n', [check('Empty and mixed numeric arrays', "const {mean}=await mod('src/stats.mjs'); assert.equal(mean([]),0); assert.equal(mean([1,2,6]),3); assert.equal(mean([-4,2]),-1)")]),
  library('bug-pagination', 'Fix offset(page,size): page 1 begins at offset 0; pages below 1 normalize to page 1. Size is a positive integer.', 'src/page.mjs', 'export const offset = (page,size) => page*size\n', 'export const offset = (page,size) => (Math.max(1,page)-1)*size\n', [check('One-based pages and lower bound', "const {offset}=await mod('src/page.mjs'); assert.equal(offset(1,10),0); assert.equal(offset(3,10),20); assert.equal(offset(0,4),0); assert.equal(offset(-2,4),0)")]),
  library('bug-escape', 'Fix escapeHTML(value): stringify values, then escape &, <, >, double quotes and apostrophes using &amp;, &lt;, &gt;, &quot;, &#39;. Preserve ordinary text.', 'src/html.mjs', "export const escapeHTML = value => String(value).replaceAll('<','&lt;')\n", "export const escapeHTML = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('\\\"','&quot;').replaceAll(\"'\",'&#39;')\n", [check('All reserved characters without double escaping', `const {escapeHTML}=await mod('src/html.mjs'); assert.equal(escapeHTML(${JSON.stringify('<a title="x">&' + "'" + 'y</a>')}), ${JSON.stringify('&lt;a title=&quot;x&quot;&gt;&amp;&#39;y&lt;/a&gt;')}); assert.equal(escapeHTML(0),'0'); assert.equal(escapeHTML('plain'),'plain')`)]),
  library('bug-unique', 'Fix uniqueById(rows): keep the first object for each id and preserve input order. Do not mutate input.', 'src/unique.mjs', 'export const uniqueById = rows => [...new Set(rows)]\n', 'export const uniqueById = rows => {const seen=new Set();return rows.filter(row=>{if(seen.has(row.id))return false;seen.add(row.id);return true})}\n', [check('Stable deduplication by id and nonmutation', "const {uniqueById}=await mod('src/unique.mjs'); const rows=[{id:2,v:'first'},{id:1},{id:2,v:'later'}]; const before=JSON.stringify(rows); assert.deepEqual(uniqueById(rows),[rows[0],rows[1]]); assert.equal(JSON.stringify(rows),before); assert.deepEqual(uniqueById([]),[])")]),
  feature('feature-money', 'Implement formatCents(integer) in src/money.mjs and bin/money.mjs CLI. Format integer cents as $12.34 or -$12.34; CLI takes one integer argument and prints the same string. Modify both files.', { 'src/money.mjs': "export const formatCents = cents => `${cents<0?'-':''}$${Math.floor(Math.abs(cents)/100)}.${String(Math.abs(cents)%100).padStart(2,'0')}`\n", 'bin/money.mjs': "import {formatCents} from '../src/money.mjs'; console.log(formatCents(Number(process.argv[2])));\n" }, [check('Signed integer cents library', "const {formatCents}=await mod('src/money.mjs'); assert.equal(formatCents(0),'$0.00'); assert.equal(formatCents(1234),'$12.34'); assert.equal(formatCents(-1),'-$0.01')"), check('CLI uses the library contract', "assert.equal(cli('bin/money.mjs',['-1234']), '-$12.34')")]),
  feature('feature-config', 'Implement readConfig(env) and bin/config.mjs. Default host=127.0.0.1 and port=3000; nonempty HOST overrides, integer PORT in 1..65535 overrides, invalid PORT throws. CLI prints JSON from process.env. Modify both files.', { 'src/config.mjs': "export function readConfig(env){const port=env.PORT===undefined||env.PORT===''?3000:Number(env.PORT);if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid port');return {host:env.HOST||'127.0.0.1',port}}\n", 'bin/config.mjs': "import {readConfig} from '../src/config.mjs';console.log(JSON.stringify(readConfig(process.env)));\n" }, [check('Defaults, overrides and port bounds', "const {readConfig}=await mod('src/config.mjs'); assert.deepEqual(readConfig({}),{host:'127.0.0.1',port:3000}); assert.deepEqual(readConfig({HOST:'localhost',PORT:'8080'}),{host:'localhost',port:8080}); for(const PORT of ['x','0','65536','1.5'])assert.throws(()=>readConfig({PORT}))"), check('CLI reads environment', "assert.deepEqual(JSON.parse(cli('bin/config.mjs',[],{HOST:'local.test',PORT:'4173'})),{host:'local.test',port:4173})")]),
  feature('feature-csv', 'Implement serialize(rows) and bin/export.mjs. Each row is an array of strings; quote cells containing comma, newline or quote, doubling inner quotes. Join rows with newline, no trailing newline. CLI reads one JSON array argument and prints the CSV. Modify both files.', { 'src/csv.mjs': "export const serialize = rows => rows.map(row=>row.map(value=>/[\",\\n]/.test(value)?'\"'+value.replaceAll('\"','\"\"')+'\"':value).join(',')).join('\\n')\n", 'bin/export.mjs': "import {serialize} from '../src/csv.mjs';console.log(serialize(JSON.parse(process.argv[2])));\n" }, [check('CSV quoting and row boundaries', `const {serialize}=await mod('src/csv.mjs'); assert.equal(serialize([]),''); assert.equal(serialize(${JSON.stringify([['a,b','say "hi"'],['x','y']])}), ${JSON.stringify('"a,b","say ""hi"""\nx,y')}); assert.equal(serialize(${JSON.stringify([['a\nb']])}), ${JSON.stringify('"a\nb"')})`), check('CLI serializes JSON rows', `assert.equal(cli('bin/export.mjs',[JSON.stringify([['a,b','ok']])]), '"a,b",ok')`)]),
  feature('feature-profile', 'Implement normalize(profile) and bin/profile.mjs. Trim name/email, lowercase email, preserve name case; reject blank name or email without @. CLI reads one JSON object argument and prints normalized JSON. Modify both files.', { 'src/profile.mjs': "export function normalize(p){const name=String(p.name??'').trim(),email=String(p.email??'').trim().toLowerCase();if(!name||!email.includes('@'))throw Error('Invalid profile');return {name,email}}\n", 'bin/profile.mjs': "import {normalize} from '../src/profile.mjs';console.log(JSON.stringify(normalize(JSON.parse(process.argv[2]))));\n" }, [check('Normalization and invalid input', "const {normalize}=await mod('src/profile.mjs'); assert.deepEqual(normalize({name:' Ada ',email:' ADA@EXAMPLE.COM '}),{name:'Ada',email:'ada@example.com'}); assert.throws(()=>normalize({name:' ',email:'x@y'})); assert.throws(()=>normalize({name:'Ada',email:'invalid'}))"), check('CLI integrates normalization', "assert.deepEqual(JSON.parse(cli('bin/profile.mjs',[JSON.stringify({name:' Ada ',email:' A@EXAMPLE.COM '})])),{name:'Ada',email:'a@example.com'})")]),
]

export const taskRevision = (task: BenchmarkTask): string => createHash('sha256').update(JSON.stringify(task)).digest('hex')
export const corpusRevision = (): string => createHash('sha256').update(CORPUS.map(taskRevision).join('\n')).digest('hex')
export function fixtureFiles(task: BenchmarkTask): Record<string, string> {
  return { 'package.json': '{"type":"module"}\n', '.gitignore': 'dist/\nnode_modules/\n', ...task.files, ...Object.fromEntries(task.checks.map((c, i) => [`.benchmark/check-${i}.mjs`, bootstrap + c.code + '\n'])), '.benchmark/all.mjs': task.checks.map((_, i) => `await import('./check-${i}.mjs');`).join('\n') + '\n' }
}
export function writeFiles(root: string, files: Record<string, string>): void {
  for (const [path, text] of Object.entries(files)) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text) }
}
export function runReference(task: BenchmarkTask, root: string): void {
  writeFiles(root, task.reference)
  if (task.operation) execFileSync(process.execPath, task.operation, { cwd: root, env: childEnv(), timeout: 5000, stdio: 'pipe' })
}
export interface CorpusCheck { command: string; exitCode: number; summary: string }
export function checkTask(task: BenchmarkTask, root: string): CorpusCheck[] {
  const fixed = fixtureFiles(task), allowed = new Set(task.allowedWrites)
  const unexpected: string[] = []
  for (const [path, text] of Object.entries(fixed)) if (!allowed.has(path)) {
    try { if (readFileSync(join(root, path), 'utf8') !== text) unexpected.push(path) } catch { unexpected.push(path) }
  }
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (['.git', '.claude', '.codex'].includes(name)) continue
      const full = join(dir, name), stat = lstatSync(full), path = relative(root, full)
      if (stat.isSymbolicLink()) { unexpected.push(path); continue }
      if (stat.isDirectory()) walk(full)
      else if (!(path in fixed) && !allowed.has(path)) unexpected.push(path)
    }
  }
  walk(root)
  const outcomes: CorpusCheck[] = [{ command: 'verify immutable fixture and declared write scope', exitCode: unexpected.length ? 1 : 0, summary: unexpected.length ? `Unexpected edits: ${unexpected.join(', ')}` : 'Protected fixture unchanged; writes stay in declared paths' }]
  if (unexpected.length) return outcomes // never execute a modified oracle
  for (const [i, criterion] of task.checks.entries()) {
    const command = `node .benchmark/check-${i}.mjs`
    try { execFileSync(process.execPath, [`.benchmark/check-${i}.mjs`], { cwd: root, env: childEnv(), timeout: 5000, maxBuffer: 1024 * 1024, stdio: 'pipe' }); outcomes.push({ command, exitCode: 0, summary: criterion.label }) }
    catch (error) { const e = error as { status?: number; stderr?: Buffer }; outcomes.push({ command, exitCode: e.status ?? 1, summary: `${criterion.label}: ${e.stderr?.toString().slice(0, 600) ?? 'check failed'}` }) }
  }
  if (task.category === 'multi-file') for (const path of task.allowedWrites) {
    const changed = readFileSync(join(root, path), 'utf8') !== fixed[path]
    outcomes.push({ command: `verify required changed path ${path}`, exitCode: changed ? 0 : 1, summary: changed ? 'Required integration path changed' : 'Required integration path unchanged' })
  }
  return outcomes
}
