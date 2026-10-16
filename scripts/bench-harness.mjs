// Bounded local evaluation. Offline runs are harness simulations, never model-quality evidence.
import { randomUUID, randomBytes, createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, renameSync, openSync, closeSync, fsyncSync, readdirSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, basename } from 'node:path'
import { performance } from 'node:perf_hooks'
import { startServer } from '../packages/sidecar/src/server.ts'
import { loginShellRunner } from '../packages/sidecar/src/clis.ts'
import { HarnessMeasurements } from '../packages/sidecar/src/measurements.ts'
import { CORPUS, corpusRevision, taskRevision, fixtureFiles, writeFiles, runReference, checkTask } from '../packages/sidecar/src/benchmarks/corpus.ts'
import { evaluateRuns } from '../packages/sidecar/src/benchmarks/evaluation.ts'

const args = process.argv.slice(2)
const value = (flag, fallback) => { const i = args.indexOf(flag); return i < 0 ? fallback : args[i + 1] }
if (args.includes('--help')) {
  console.log('node scripts/bench-harness.mjs [--live --pilot] [--tasks op-build,bug-mean] [--repetitions 3] [--out DIRECTORY] [--resume]\nOffline is default. --live uses authenticated native CLIs through Orbit. --pilot selects 2 tasks x 2 configurations x 1 repetition. Full matrix: 12 x 2 x 3. Every failed/unverified run is retained. No installs or publication.')
  process.exit(0)
}
const live = args.includes('--live'), pilot = args.includes('--pilot')
let stopRequested = false
process.on('SIGTERM', () => { stopRequested = true })
process.on('SIGINT', () => { stopRequested = true })
const limits = { tokens: Number(value('--tokens-per-mission', '750000')), knownClaudeCostUsd: Number(value('--known-usd-per-mission', '0.10')) }
if (!Number.isSafeInteger(limits.tokens) || limits.tokens < 1 || !Number.isFinite(limits.knownClaudeCostUsd) || limits.knownClaudeCostUsd <= 0) throw new Error('Invalid benchmark limits')
const repetitions = Number(value('--repetitions', pilot ? '1' : '3'))
if (!Number.isSafeInteger(repetitions) || repetitions < 1 || repetitions > 3) throw new Error('repetitions must be 1..3')
const ids = value('--tasks', pilot ? 'op-build,bug-mean' : CORPUS.map(t => t.id).join(',')).split(',')
if (new Set(ids).size !== ids.length || ids.some(id => !CORPUS.some(t => t.id === id))) throw new Error('Unknown or duplicate task id')
const tasks = ids.map(id => CORPUS.find(t => t.id === id))
const output = value('--out', null) ? resolve(value('--out')) : mkdtempSync(join(tmpdir(), 'orbit-benchmark-results-'))
mkdirSync(output, { recursive: true, mode: 0o700 })
const atomic = (path, object) => {
  const temp = `${path}.tmp`, fd = openSync(temp, 'w', 0o600)
  try { writeFileSync(fd, JSON.stringify(object, null, 2) + '\n'); fsyncSync(fd) } finally { closeSync(fd) }
  renameSync(temp, path)
}
const sourceFiles = ['scripts/bench-harness.mjs', 'package.json', 'package-lock.json']
const sources = relative => {
  for (const entry of readdirSync(new URL(`../${relative}/`, import.meta.url), { withFileTypes: true })) {
    const path = `${relative}/${entry.name}`
    if (entry.isDirectory()) sources(path)
    else if (/\.(ts|json|md)$/.test(entry.name)) sourceFiles.push(path)
  }
}
for (const relative of ['packages/sidecar/src','packages/sidecar/resources','packages/protocol/src']) sources(relative)
sourceFiles.push('packages/sidecar/hooks/statusline.mjs')
sourceFiles.sort()
const sourceRevision = createHash('sha256').update(sourceFiles.map(path => `${path}:${createHash('sha256').update(readFileSync(new URL(`../${path}`, import.meta.url))).digest('hex')}`).join('\n')).digest('hex')
const version = cli => { try { return execFileSync(cli, ['--version'], { encoding: 'utf8', timeout: 10000, stdio: ['ignore','pipe','ignore'] }).trim() } catch { return null } }
const models = { worker: 'claude:claude-haiku-5-5:low', reviewer: 'codex:gpt-6-luna:low' }
const runtime = { node: process.version, claude: live ? version('claude') : null, codex: live ? version('codex') : null }
if (live && (!runtime.claude || !runtime.codex)) throw new Error('Both native CLIs must be available before a live run')
const setup = { version: 1, mode: live ? 'live' : 'offline', requestedTasks: ids, repetitions, fullTarget: { tasks: CORPUS.map(t => t.id), repetitions: 3 }, corpusRevision: corpusRevision(), sourceRevision, runtime, models, limits, coordinator: 'deterministic Orbit controller; not an autonomous LLM maestro evaluation', comparison: 'eager versus budgeted optional context, identical safety gates', firstResponse: 'Not observable from PTY banners; left null' }
const manifest = join(output, 'manifest.json')
if (existsSync(manifest)) {
  if (!args.includes('--resume') || JSON.stringify(JSON.parse(readFileSync(manifest, 'utf8'))) !== JSON.stringify(setup)) throw new Error('Existing output requires --resume and identical source, corpus, models, runtime and matrix')
} else atomic(manifest, setup)
const runs = []
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const shellRun = loginShellRunner('/bin/zsh')
const runner = async (command, timeout) => {
  if (!live) return { code: 127, stdout: '', stderr: 'offline benchmark' }
  if (/claude auth status$|codex login status$/.test(command)) return shellRun(command, timeout)
  if (/codex debug models/.test(command)) return shellRun('codex debug models --bundled', timeout)
  return { code: 127, stdout: '', stderr: 'probe excluded from bounded benchmark; no updates or external lookup' }
}
const initialize = root => {
  const env = { ...process.env, GIT_AUTHOR_DATE: '2000-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2000-01-01T00:00:00Z' }
  for (const cmd of [['init','-b','main'],['add','.'],['-c','user.name=Orbit Benchmark','-c','user.email=benchmark@localhost','commit','-m','Fixed benchmark fixture']]) execFileSync('git',cmd,{cwd:root,env,stdio:'pipe'})
}
function syntheticReview(core, reviewer, resultId, checks, scope = 'result') {
  const inspected = core.inspectResult(reviewer, resultId, scope)
  return core.verifyResult(reviewer, { inspectionId: inspected.id, verdict: 'accepted', summary: 'Deterministic independent oracle verification; not a model verdict', checks, criteria: inspected.acceptance.map((_, i) => ({ item: i + 1, met: true, how: 'Protected executable corpus criteria passed; independent controller checked the current source' })) })
}

async function execute(task, configuration, repetition, path) {
  const scratch = mkdtempSync(join(tmpdir(), `orbit-bench-${task.id}-`)), root = join(scratch, 'workspace'), data = join(scratch, 'data')
  mkdirSync(root)
  writeFiles(root, fixtureFiles(task)); initialize(root)
  if (!live) {
    for (const [key, name] of [['CLAUDE_CONFIG_DIR','claude'],['CODEX_HOME','codex'],['GEMINI_CLI_HOME','gemini']]) process.env[key] = join(scratch, name)
  }
  const measurements = new HarnessMeasurements(), began = performance.now()
  const server = await startServer({ port: 0, token: randomBytes(32).toString('hex'), allowedOrigins: ['http://localhost:5374'], dataDir: data, shell: '/bin/zsh', browser: null, scheduler: false, measurements, benchmarkEagerContext: configuration === 'eager', run: runner, ...(!live ? { agentCommand: () => ({ file: '/bin/sh', args: ['-c', 'while read line; do :; done'] }) } : {}) })
  const core = server.core
  let missionId = '', checks = [], accepted = false, failure = null
  const trusted = new Set()
  const state = () => ({ taskId: task.id, configuration, repetition, scratch, root, dataDir: data, port: server.port, missionId })
  const waitFor = async (predicate, phase) => {
    const deadline = Date.now() + (live ? 150000 : 5000)
    while (Date.now() < deadline) {
      if (stopRequested) throw new Error(`${phase}: stopped by user/supervisor; incomplete work retained`)
      if (core.store.mission(missionId)?.budget?.exceeded) throw new Error(`${phase}: benchmark budget exhausted; incomplete work retained`)
      if (predicate()) return
      const screens = {}
      for (const pane of core.missionPanes(missionId).filter(p => p.cli !== 'shell')) {
        const screen = core.panes.screenText(pane.id, 100)
        screens[pane.id] = screen
        // Trust only this owned synthetic workspace; do not accept generic permission prompts.
        if (!trusted.has(pane.id) && [root, realpathSync(root)].some(path => screen.replace(/\s+/g, '').includes(path)) && (screen.includes('Quick safety check') || screen.includes('Trust this folder?'))) {
          trusted.add(pane.id)
          core.handle({ type: 'pane.input', paneId: pane.id, data: screen.includes('Trust this folder?') ? '\r' : '\x1b[B\r' })
        }
        if (pane.status === 'exited' && !predicate()) throw new Error(`${phase}: ${pane.cli} #${pane.id} exited before the required result`)
      }
      atomic(join(scratch, 'screens.json'), screens)
      atomic(join(output, 'active.json'), { ...state(), phase, panes: core.missionPanes(missionId).map(p => ({ id: p.id, cli: p.cli, status: p.status, handoffStatus: p.handoffStatus })) })
      await sleep(500)
    }
    throw new Error(`${phase}: bounded timeout; no automatic retry or waiver`)
  }
  try {
    core.handle({ type: 'workspace.open', path: root })
    const workspace = core.store.snapshot().workspaces[0]
    // One empty-history operation and one history-heavy bug in the economic pilot.
    if (task.category !== 'operation') for (let i = 0; i < 48; i++) core.store.saveMemory(workspace.id, { id: `history-${i}`, kind: 'fato', text: `Unrelated synthetic historical observation ${i}. ` + 'A prior benchmark fixture had a different implementation. '.repeat(3), at: 1000 + i, pinned: false, source: { missionId: 'historical', missionTitle: 'Synthetic prior work', paneId: null } })
    core.handle({ type: 'mission.create', workspaceId: workspace.id, title: task.id, objective: task.goal, mode: 'agentica', lead: { cli: 'shell', model: null, title: 'Deterministic benchmark coordinator' }, budget: { tokens: limits.tokens, costUsd: limits.knownClaudeCostUsd } })
    const lead = core.store.snapshot().panes.find(p => p.role === 'lead'); missionId = lead.missionId
    const acceptance = ['Preserve protected fixtures and modify only the declared paths', ...task.checks.map(c => c.label)]
    const { pane: worker } = await core.spawnHelper(lead, { activityId: 'implementation', title: task.id, task: `${task.goal}\nAllowed writes: ${task.allowedWrites.join(', ') || '(none)'}. Protected independent checks: node .benchmark/all.mjs. Do not modify .benchmark or other files. No network, installs, publication or subhelpers. Deliver with Orbit handoff_submit and answer every criterion with actual evidence. This is a bounded synthetic benchmark.`, cli: 'claude', model: 'claude-haiku-5-5', effort: 'low', accept: acceptance })
    if (!live) {
      runReference(task, root)
      const observed = checkTask(task, root)
      core.handoff(worker, { summary: 'Offline reference executor; not model behavior', evidence: observed.map(c => `${c.command}: exit ${c.exitCode}`).join('\n'), criteria: acceptance.map((_, i) => ({ item: i + 1, met: true, how: 'Offline reference executor ran the protected oracle' })) })
    }
    await waitFor(() => core.store.activityHistory(missionId).results.some(r => r.status === 'done' && core.store.activityAttempt(r.attemptId)?.paneId === worker.id), 'worker')
    const result = core.store.activityHistory(missionId).results.findLast(r => r.status === 'done' && core.store.activityAttempt(r.attemptId)?.paneId === worker.id)
    checks = checkTask(task, root)
    if (checks.some(c => c.exitCode !== 0)) throw new Error('Independent corpus criteria failed after worker delivery')
    const { pane: reviewer } = await core.spawnHelper(lead, { activityId: 'review', title: 'Independent review', cli: 'codex', model: 'gpt-6-luna', effort: 'low', readOnly: true, requireReadOnlySandbox: true, task: `Review resultId ${result.id} independently. Call result_inspect with scope=result, inspect source and run node .benchmark/all.mjs. Submit verification_submit with a truthful verdict, checks and every returned criterion. Then handoff_submit done with evidence and your one assigned criterion. Do not request scope=integration: the deterministic coordinator runs that final oracle after your handoff. No edits, subhelpers, installs, network or force.`, accept: ['Review the exact worker result with independent executable checks and a recorded result verdict'] })
    if (!live) {
      syntheticReview(core, reviewer, result.id, checks)
      core.handoff(reviewer, { summary: 'Offline independent controller review; not a model verdict', evidence: checks.map(c => `${c.command}: exit ${c.exitCode}`).join('\n'), criteria: [{ item: 1, met: true, how: 'Protected oracle and exact result were reviewed by the offline controller' }] })
    }
    await waitFor(() => core.store.activityHistory(missionId).results.some(r => r.status === 'done' && core.store.activityAttempt(r.attemptId)?.paneId === reviewer.id), 'reviewer')
    if (core.store.verifications(missionId).findLast(v => v.resultId === result.id && v.scope === 'result')?.verdict !== 'accepted') throw new Error('Independent reviewer did not accept the worker result')
    checks = checkTask(task, root)
    if (checks.some(c => c.exitCode !== 0)) throw new Error('Final independent corpus criteria failed')
    const reviewResult = core.store.activityHistory(missionId).results.findLast(r => r.status === 'done' && core.store.activityAttempt(r.attemptId)?.paneId === reviewer.id)
    syntheticReview(core, lead, reviewResult.id, checks)
    syntheticReview(core, lead, result.id, checks, 'integration')
    core.missionReady(lead, 'Protected independent corpus oracle and source-bound reviews passed', false)
    accepted = true
    // Allow native status/rollout reporting to arrive before closing; missing reports stay unknown.
    if (live) {
      const until = Date.now() + 10000
      while (Date.now() < until && (core.missionPanes(missionId).some(p => p.cli !== 'shell' && p.status === 'running') || measurements.snapshot(missionId).some(e => e.cli !== 'shell' && e.usage.total === null))) await sleep(500)
      await sleep(500)
    }
  } catch (error) { failure = String(error?.message ?? error) }
  finally { await server.close() }
  const history = core.store.activityHistory(missionId), verifications = core.store.verifications(missionId), executions = measurements.snapshot(missionId)
  const record = { version: 1, id: randomUUID(), taskId: task.id, taskRevision: taskRevision(task), corpusRevision: corpusRevision(), sourceRevision, mode: live ? 'live' : 'offline', configuration, repetition, runtime, models, limits, durationMs: performance.now() - began, firstResponseMs: null, checks, accepted, resultReviewed: history.results.filter(r => r.status === 'done').every(r => verifications.findLast(v => v.resultId === r.id && v.scope === 'result')?.verdict === 'accepted'), integrationReviewed: verifications.findLast(v => v.scope === 'integration')?.verdict === 'accepted', waived: history.activities.some(a => a.state === 'waived'), error: failure, executions, auxiliaryCalls: core.store.auxiliaryCalls(missionId), attempts: history.attempts.length, retries: history.attempts.filter(a => a.retryReason).length, reopenings: executions.length - new Set(executions.map(e => e.paneId)).size, results: history.results.length }
  atomic(path, record)
  console.log(JSON.stringify({ ...state(), accepted, failure, file: path }))
  return record
}

console.log(JSON.stringify({ phase: 'start', output, setup }))
matrix: for (let rep = 1; rep <= repetitions; rep++) for (const [index, task] of tasks.entries()) {
  const order = (rep + index) % 2 ? ['eager', 'budgeted'] : ['budgeted', 'eager']
  for (const configuration of order) {
    if (stopRequested) break matrix
    const path = join(output, `${task.id}-${rep}-${configuration}.json`)
    const record = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : await execute(task, configuration, rep, path)
    runs.push(record)
    atomic(join(output, 'summary.json'), evaluateRuns(runs, CORPUS.map(t => t.id), 3))
    if (live && !record.accepted && !args.includes('--continue-on-failure')) break matrix
  }
}
const summary = evaluateRuns(runs, CORPUS.map(t => t.id), 3)
atomic(join(output, 'summary.json'), summary)
console.log(JSON.stringify({ phase: 'finished', output, accepted: runs.filter(r => r.accepted).length, runs: runs.length, issues: summary.issues, tokenReductionPercent: summary.observedTokenReductionPercent, fullMatrixComplete: summary.fullMatrixComplete }))
if (stopRequested || runs.some(r => !r.accepted) || summary.issues.length) process.exitCode = 1
