// Explicitly repair one retained benchmark review. Never edits original run/summary files.
import { randomBytes, createHash } from 'node:crypto'
import { readFileSync, writeFileSync, realpathSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { performance } from 'node:perf_hooks'
import { startServer } from '../packages/sidecar/src/server.ts'
import { Store } from '../packages/sidecar/src/store.ts'
import { HarnessMeasurements } from '../packages/sidecar/src/measurements.ts'
import { CORPUS, taskRevision, checkTask } from '../packages/sidecar/src/benchmarks/corpus.ts'
import { runUsage } from '../packages/sidecar/src/benchmarks/evaluation.ts'

const args = process.argv.slice(2)
const option = name => args[args.indexOf(name) + 1]
if (!args.includes('--live') || !args.includes('--run') || !args.includes('--out')) {
  console.log('node scripts/recover-benchmark-review.mjs --live --run FAILED_RUN.json --out RECOVERY.json\nResumes only the retained owned benchmark workspace. Original failure remains unchanged; retry usage is recorded separately.')
  process.exit(0)
}
const runPath = option('--run'), out = option('--out'), original = JSON.parse(readFileSync(runPath, 'utf8'))
const active = JSON.parse(readFileSync(join(dirname(runPath), 'active.json'), 'utf8'))
const root = realpathSync(active.root), dataDir = active.dataDir
if (original.accepted || original.mode !== 'live' || original.taskId !== active.taskId || original.configuration !== active.configuration || !root.startsWith(realpathSync(tmpdir()) + '/') || !basename(dirname(root)).startsWith('orbit-bench-')) throw new Error('Recovery requires the matching failed owned temporary benchmark')
const task = CORPUS.find(t => t.id === original.taskId)
if (!task || taskRevision(task) !== original.taskRevision) throw new Error('Corpus revision changed')
const checks = checkTask(task, root)
if (checks.some(c => c.exitCode !== 0)) throw new Error('Code does not pass the independent oracle; diagnose before requesting another model review')
const preparation = new Store(dataDir)
preparation.saveSettings({ ...preparation.settings(), resumeOnStart: false }); preparation.flush()
const measurements = new HarnessMeasurements(), started = performance.now()
const server = await startServer({ port: 0, token: randomBytes(32).toString('hex'), allowedOrigins: ['http://localhost:5374'], dataDir, shell: '/bin/zsh', browser: null, scheduler: false, measurements, run: async () => ({ code: 127, stdout: '', stderr: 'No probes during bounded recovery' }) })
const core = server.core, missionId = active.missionId
let accepted = false, error = null, retryPaneId = null
const stop = { requested: false }
process.on('SIGTERM', () => { stop.requested = true }); process.on('SIGINT', () => { stop.requested = true })
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
try {
  const leadId = core.missionPanes(missionId).find(p => p.role === 'lead').id
  await core.handle({ type: 'pane.restart', paneId: leadId, resume: false })
  const lead = core.store.pane(leadId), history = core.store.activityHistory(missionId)
  const worker = history.activities.find(a => a.title === task.id), review = history.activities.find(a => a.title === 'Independent review')
  const result = history.results.findLast(r => r.activityId === worker.id && r.attemptId === worker.activeAttemptId && r.status === 'done')
  core.handle({ type: 'mission.budget', missionId, tokens: core.store.mission(missionId).usage.total + 250000, costUsd: original.limits.knownClaudeCostUsd })
  const { pane } = await core.spawnHelper(lead, { activityId: review.id, retryReason: 'Earlier reviewer reported exit 1 although the actual combined execution receipt had exit_code 0. Re-run the protected check separately and record its observed status.', title: 'Independent review retry', cli: 'codex', model: 'gpt-6-luna', effort: 'low', readOnly: true, requireReadOnlySandbox: true, accept: ['Review the exact worker result with independent executable checks and a recorded truthful result verdict'], task: `This is a bounded correction of the earlier review of result ${result.id}. The earlier combined git/status/diff/check command had actual exit_code 0. Git printed xcrun cache warnings to stderr; those warnings did not make the protected test fail. Do not fabricate an exit status from stderr. Make a NEW result_inspect(scope=result), run the mandatory check BY ITSELF using the bundled runtime: ${JSON.stringify(process.execPath)} .benchmark/all.mjs . Use a non-login shell if needed (exec_command login=false, shell=/bin/sh). Keep the read-only sandbox. Record the observed exit code and criteria with verification_submit, then handoff_submit done with the CURRENT attempt id and your criterion. No edits, subhelpers, network, installation, integration scope or force. If the isolated check really fails, report that exact failure without claiming acceptance.` })
  retryPaneId = pane.id
  const until = Date.now() + 120000
  while (!core.store.activityHistory(missionId).results.some(r => r.attemptId === core.store.currentPaneAttempt(pane.id)?.id && r.status === 'done')) {
    if (stop.requested || Date.now() > until || core.store.mission(missionId).budget?.exceeded) throw new Error('Bounded review retry stopped/timed out; original failure retained')
    const screen = core.panes.screenText(pane.id, 100)
    writeFileSync(join(dirname(out), 'recovery-active.json'), JSON.stringify({ root, dataDir, missionId, paneId: pane.id, screen }, null, 2), { mode: 0o600 })
    await sleep(500)
  }
  if (core.store.verifications(missionId).findLast(v => v.scope === 'result' && v.resultId === result.id)?.verdict !== 'accepted') throw new Error('Retry reviewer still did not accept the worker result')
  const finalChecks = checkTask(task, root)
  if (finalChecks.some(c => c.exitCode !== 0)) throw new Error('Final oracle failed')
  const retryResult = core.store.activityHistory(missionId).results.findLast(r => r.attemptId === core.store.currentPaneAttempt(pane.id)?.id && r.status === 'done')
  for (const [resultId, scope] of [[retryResult.id, 'result'], [result.id, 'integration']]) {
    const inspection = core.inspectResult(lead, resultId, scope)
    core.verifyResult(lead, { inspectionId: inspection.id, verdict: 'accepted', summary: 'Deterministic independent protected oracle after native reviewer correction', checks: finalChecks, criteria: inspection.acceptance.map((_, i) => ({ item: i + 1, met: true, how: 'Current source passed immutable executable criteria and corrected native result review' })) })
  }
  core.missionReady(lead, 'Review recovered after reading actual exit status; original failed benchmark record remains unchanged', false)
  accepted = true
  await sleep(6000)
} catch (e) { error = String(e?.message ?? e) }
finally { await server.close() }
const native = measurements.snapshot(missionId).filter(e => e.cli !== 'shell')
const retryTokens = native.length && native.every(e => e.usage.total !== null) ? native.reduce((s, e) => s + e.usage.total, 0) : null
const priorTokens = runUsage(original).tokens
const report = { version: 1, initialRunId: original.id, initialRunSha256: createHash('sha256').update(readFileSync(runPath)).digest('hex'), originalFailure: original.error, originalStillFailed: true, retryScriptSha256: createHash('sha256').update(readFileSync(import.meta.filename)).digest('hex'), originalSourceRevision: original.sourceRevision, taskId: original.taskId, configuration: original.configuration, acceptedAfterRetry: accepted, error, retryPaneId, retryDurationMs: performance.now() - started, retryTokens, tokensIncludingOriginalFailedAttempt: priorTokens !== null && retryTokens !== null ? priorTokens + retryTokens : null, knownOriginalClaudeCostUsd: runUsage(original).knownCostUsd, retryCostUsd: null, executions: native, activityHistory: core.store.activityHistory(missionId), verifications: core.store.verifications(missionId), readyAt: core.store.mission(missionId)?.readyAt ?? null, notes: ['Original run and comparison summary are not rewritten', 'Recovery is not another A/B observation; extra retry usage is explicit', 'No source edits, sandbox relaxation or waiver'] }
writeFileSync(out, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 })
console.log(JSON.stringify({ acceptedAfterRetry: accepted, retryTokens, totalIncludingFailedAttempt: report.tokensIncludingOriginalFailedAttempt, error, out }))
if (!accepted) process.exitCode = 1
