// Opt-in native pilot. The supervisor never delegates, delivers, reviews or declares ready.
import { randomBytes, createHash } from 'node:crypto'
import { fork, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, renameSync, openSync, closeSync, fsyncSync, readdirSync, realpathSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer } from '../packages/sidecar/src/server.ts'
import { buildCommand } from '../packages/sidecar/src/command.ts'
import { loginShellRunner } from '../packages/sidecar/src/clis.ts'
import { HarnessMeasurements } from '../packages/sidecar/src/measurements.ts'
import { CORPUS, corpusRevision, taskRevision, fixtureFiles, writeFiles, checkTask } from '../packages/sidecar/src/benchmarks/corpus.ts'
import { evaluateAutonomy } from '../packages/sidecar/src/benchmarks/autonomy.ts'

const args = process.argv.slice(2), self = fileURLToPath(import.meta.url), repo = resolve(dirname(self), '..')
const value = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback
const sleep = ms => new Promise(r => setTimeout(r, ms))
const atomic = (path, object) => {
  const temp = `${path}.tmp`, fd = openSync(temp, 'w', 0o600)
  try { writeFileSync(fd, JSON.stringify(object, null, 2) + '\n'); fsyncSync(fd) } finally { closeSync(fd) }
  renameSync(temp, path)
}
const json = path => JSON.parse(readFileSync(path, 'utf8'))
const pins = { claude: 'claude-haiku-5-5', codex: 'gpt-6-luna' }
const alive = pid => { try { process.kill(pid, 0); return true } catch (e) { if (e.code === 'ESRCH') return false; throw e } }
let stopped = false
process.on('SIGTERM', () => { stopped = true }); process.on('SIGINT', () => { stopped = true })

function objective(task, root, worker, reviewer) {
  const check = `${JSON.stringify(process.execPath)} .benchmark/all.mjs`
  return `Bounded autonomous Orbit pilot. Goal: ${task.goal}
Owned root: ${root}. Only allowed writes: ${task.allowedWrites.join(', ')}. Preserve .benchmark and every other fixture; no new files. No network, installs, commit, push, native subagents or extra helpers. Protected check: ${check} (run alone, read actual exit status; stderr warnings are not a nonzero exit). In Codex exec_command use login=false and /bin/sh if necessary.
User explicitly pins worker=${worker}/${pins[worker]}/low and reviewer=${reviewer}/${pins[reviewer]}/low. Exactly TWO required activities, one attempt each. No retries/model fallback, force, waivers or self-review. You orchestrate; do not implement the fix yourself. Maintain a small board and stop your turn after each delegation so delivery wakes you.
1. agent_spawn activityId=implementation, kind=bug, agent=${worker}, model=${pins[worker]}, effort=low, difficulty=simples. Pass this goal, root, write restrictions, check command and acceptance: ["Preserve protected fixtures and modify only declared paths", ${task.checks.map(c => JSON.stringify(c.label)).join(', ')}]. Worker reproduces failing check before minimal fix, runs it green, handoff_submit done with current attemptId, evidence and every criterion. No helpers. Wait.
2. On worker delivery: inspect activity_status/handoff_list, delivery_status and delivery_ack exact deliveryId. Repeated notices mean ACK, never repeat work. agent_spawn activityId=review, kind=revisao, agent=${reviewer}, model=${pins[reviewer]}, effort=low, difficulty=simples, readOnly=true${reviewer === 'codex' ? ', requireReadOnlySandbox=true' : ''}, accept=["Independently review exact worker result and record executable evidence"]. Include worker resultId. Reviewer must result_inspect scope=result, inspect source/diff, run protected check independently and verification_submit truthful verdict with every returned criterion, then handoff_submit done with its CURRENT attemptId and assigned criterion. No integration scope yet; no edits or helpers. Wait.
3. On reviewer delivery ACK exact deliveryId. Audit the reviewer's result/evidence independently as leader: result_inspect(scope=result) on REVIEWER resultId, verification_submit with truthful evidence (do not invent commands you ran). This accepts the review activity without another helper. Do not agent_send to a completed helper: that creates another required assignment.
4. After both activity results accepted, result_inspect(scope=integration) on WORKER resultId and verification_submit final truthful integration verdict for current code/contracts and all criteria. You may read source and review evidence; do not claim another agent's check as your own execution. Then mission_ready summary, no force. Never declare completion before recorded current integration acceptance.
If delivery repeats after recovery, reuse existing result/attempt/receipt IDs, ACK and continue from ledger. Do not rerun implementation. If blocked report the actual boundary; do not bypass permissions or gates.`
}

async function child(configPath, resume) {
  const cfg = json(configPath), task = CORPUS.find(t => t.id === cfg.taskId), measurements = new HarnessMeasurements()
  let missionId = cfg.missionId ?? '', leadId = cfg.leadId ?? null, server, error = null, checks = [], progress = null
  const shellRun = loginShellRunner('/bin/zsh'), trust = new Map(), started = Date.now()
  const run = (command, timeout) => /claude auth status$|codex login status$/.test(command) ? shellRun(command, timeout) : /codex debug models/.test(command) ? shellRun('codex debug models --bundled', timeout) : Promise.resolve({ code: 127, stdout: '', stderr: 'Probe excluded from bounded pilot' })
  const agentCommand = (launch, shell) => {
    if (!pins[launch.cli] || launch.model !== pins[launch.cli] || launch.effort !== 'low') throw new Error('Pilot rejects unpinned native launch')
    const openings = json(join(cfg.output, 'openings.json'))
    if (openings.length >= cfg.maxOpenings) throw new Error('Pilot native opening limit reached')
    openings.push({ cli: launch.cli, model: launch.model, effort: launch.effort, resumeSessionId: launch.resume ?? null, at: Date.now() })
    atomic(join(cfg.output, 'openings.json'), openings)
    return buildCommand(launch, shell)
  }
  const observed = () => {
    const core = server.core
    return { missionId, leadId, readyAt: core.store.mission(missionId)?.readyAt ?? null, missionUsage: core.store.mission(missionId)?.usage ?? null,
      history: core.store.activityHistory(missionId), verifications: core.store.verifications(missionId), notifications: core.store.notifications(missionId),
      panes: core.missionPanes(missionId), executions: measurements.snapshot(missionId), auxiliaryCalls: core.store.auxiliaryCalls(missionId) }
  }
  try {
    server = await startServer({ port: 0, token: randomBytes(32).toString('hex'), allowedOrigins: ['http://localhost:5374'], dataDir: cfg.data, shell: '/bin/zsh', browser: null, scheduler: false, run, measurements, agentCommand })
    const core = server.core
    if (!resume) {
      core.store.saveSettings({ ...core.store.settings(), smartClassify: false, resumeOnStart: true })
      core.store.saveRouting({ lead: { cli: cfg.leader, model: pins[cfg.leader], effort: 'low' }, taskTypes: [
        { id: 'bug', name: 'Bug', description: 'Small implementation', cli: cfg.worker, model: pins[cfg.worker], effort: 'low', skills: [], onlySkills: false, method: 'direct', readOnly: false, alt: null },
        { id: 'revisao', name: 'Review', description: 'Independent review', cli: cfg.reviewer, model: pins[cfg.reviewer], effort: 'low', skills: [], onlySkills: false, method: 'direct', readOnly: true, alt: null },
      ] })
      core.handle({ type: 'workspace.open', path: cfg.root })
      core.handle({ type: 'mission.create', workspaceId: core.store.snapshot().workspaces[0].id, title: `Autonomy ${cfg.direction}: ${task.id}`, objective: objective(task, cfg.root, cfg.worker, cfg.reviewer), mode: 'agentica', allowedClis: ['claude', 'codex'], lead: { cli: cfg.leader, model: pins[cfg.leader], effort: 'low', title: 'Native autonomous leader' }, budget: { tokens: 1500000, costUsd: 0.15 } })
      const lead = core.store.snapshot().panes.find(p => p.role === 'lead'); missionId = lead.missionId; leadId = lead.id
      atomic(configPath, { ...cfg, missionId, leadId })
      if (cfg.interruptDelivery) {
        const commit = core.store.commitActivityResult.bind(core.store)
        core.store.commitActivityResult = (...params) => {
          const result = commit(...params)
          if (!result.duplicate && result.result.status === 'done') {
            const notice = core.store.notifications(missionId).find(n => n.resultId === result.result.id)
            atomic(join(cfg.output, 'checkpoint.json'), { ...observed(), resultId: result.result.id, attemptId: result.result.attemptId, notificationId: notice?.id ?? null, boundary: 'durable result commit returned, before delivery dispatch', at: Date.now() })
            process.kill(process.pid, 'SIGKILL')
          }
          return result
        }
      }
    }
    const until = Date.now() + 360000
    while (!core.store.mission(missionId)?.readyAt) {
      if (stopped || Date.now() > until) throw new Error('Stopped or six-minute phase timeout; no automatic retry')
      if (core.store.mission(missionId)?.budget?.exceeded) throw new Error('Pilot mission budget exhausted')
      const history = core.store.activityHistory(missionId)
      if (history.attempts.length > 2 || history.activities.some(a => a.state === 'waived')) throw new Error('Unexpected extra attempt or waived activity')
      const screens = {}
      for (const pane of core.missionPanes(missionId)) {
        const screen = core.panes.screenText(pane.id, 100); screens[pane.id] = screen
        const prompt = screen.includes('Quick safety check') || screen.includes('Trust this folder?')
        const prior = trust.get(pane.id) ?? { seenAt: Date.now(), tries: 0, sentAt: 0 }
        if (prompt && [cfg.root, realpathSync(cfg.root)].some(p => screen.replace(/\s+/g, '').includes(p))) {
          trust.set(pane.id, prior)
          // The first paint can precede the CLI's input listener. Wait for a stable, complete
          // owned-folder prompt, and permit at most one retry of that same trust action.
          if (Date.now() - prior.seenAt >= 1200 && Date.now() - prior.sentAt >= 2000 && prior.tries < 2 && (screen.includes('Enter to confirm') || screen.includes('Trust this folder?'))) {
            prior.tries++; prior.sentAt = Date.now()
            core.handle({ type: 'pane.input', paneId: pane.id, data: screen.includes('❯ Yes, I trust') || screen.includes('Trust this folder?') ? '\r' : '\x1b[B\r' })
            console.log(JSON.stringify({ phase: 'trust-owned-folder', paneId: pane.id, attempt: prior.tries }))
          }
        }
        if (pane.role === 'lead' && pane.status === 'exited') throw new Error('Native leader exited before completion')
      }
      atomic(join(cfg.scratch, 'screens.json'), screens)
      atomic(join(cfg.output, 'active.json'), { phase: resume ? 'recovered' : 'initial', elapsedMs: Date.now() - started, ...observed() })
      await sleep(500)
    }
    checks = checkTask(task, cfg.root); progress = core.missionProgress(missionId)
    await sleep(6000)
  } catch (e) { error = String(e?.message ?? e) }
  finally { if (server) await server.close() }
  if (!server) { atomic(join(cfg.output, resume ? 'recovered.json' : 'initial.json'), { error }); return }
  const checkpoint = existsSync(join(cfg.output, 'checkpoint.json')) ? json(join(cfg.output, 'checkpoint.json')) : undefined
  let accountingReplay = null
  if (resume && checkpoint) {
    const before = structuredClone(server.core.store.mission(missionId)?.usage)
    const reports = []
    for (const old of checkpoint.panes.filter(p => p.sessionId && p.usage)) {
      const current = server.core.store.pane(old.id)
      if (!current || current.sessionId !== old.sessionId) { reports.push({ paneId: old.id, sameSession: false }); continue }
      const replay = server.core.store.accountSessionUsage(current, old.usage, old.cli === 'codex' ? 'rollout' : 'status')
      reports.push({ paneId: old.id, sameSession: true, delta: replay.delta })
    }
    const after = server.core.store.mission(missionId)?.usage
    accountingReplay = { before, after, reports, passed: reports.length > 0 && reports.every(r => r.sameSession && r.delta.total === 0 && (r.delta.costUsd ?? 0) === 0) && JSON.stringify(before) === JSON.stringify(after) }
  }
  const state = observed()
  // Even failed missions get a protected independent oracle observation.
  if (!checks.length) checks = checkTask(task, cfg.root)
  const evaluation = evaluateAutonomy({ leadId, workerCli: cfg.worker, reviewerCli: cfg.reviewer, ready: !!state.readyAt, integrationCurrent: progress?.integration.state === 'current', ...state.history, verifications: state.verifications, notifications: state.notifications, checks, checkpoint })
  const sessionRecovery = checkpoint && resume ? checkpoint.panes.map(old => ({ paneId: old.id, priorSessionId: old.sessionId, currentSessionId: state.panes.find(p => p.id === old.id)?.sessionId ?? null, priorEpoch: old.executionEpoch, currentEpoch: state.panes.find(p => p.id === old.id)?.executionEpoch ?? null })) : null
  const recoveryPassed = !resume || (accountingReplay?.passed && sessionRecovery.every(p => p.priorSessionId && p.priorSessionId === p.currentSessionId && p.priorEpoch !== p.currentEpoch))
  const record = { ...state, durationMs: Date.now() - started, checks, integration: progress?.integration ?? null, evaluation, accountingReplay, sessionRecovery, error, passed: !error && evaluation.passed && recoveryPassed }
  atomic(join(cfg.output, resume ? 'recovered.json' : 'initial.json'), record)
  console.log(JSON.stringify({ phase: 'child-finished', passed: record.passed, error, issues: evaluation.issues }))
}

async function parent() {
  if (!args.includes('--live') || args.includes('--help')) {
    console.log('node scripts/verify-autonomous-harness.mjs --live --direction forward|reverse --out NEW_DIRECTORY [--interrupt-delivery]\nTwo native agents plus real leader, fixed economic models. One mission per invocation. No model calls without --live. Recovery kills only the owned sidecar after durable result commit; never bypasses reviews or permissions.')
    return
  }
  const direction = value('--direction', 'forward')
  if (!['forward', 'reverse'].includes(direction)) throw new Error('Invalid direction')
  const output = resolve(value('--out', join(tmpdir(), `orbit-autonomy-result-${Date.now()}`)))
  if (existsSync(output)) throw new Error('Output directory must be new; preserve previous observations')
  mkdirSync(output, { recursive: true, mode: 0o700 })
  const scratch = mkdtempSync(join(tmpdir(), 'orbit-autonomy-')), root = join(scratch, 'workspace'), data = join(scratch, 'data')
  mkdirSync(root); mkdirSync(data)
  const task = CORPUS.find(t => t.id === (direction === 'forward' ? 'bug-mean' : 'bug-pagination'))
  writeFiles(root, fixtureFiles(task))
  const env = { ...process.env, GIT_AUTHOR_DATE: '2000-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2000-01-01T00:00:00Z' }
  for (const argv of [['init', '-b', 'main'], ['add', '.'], ['-c', 'user.name=Orbit Pilot', '-c', 'user.email=pilot@localhost', 'commit', '-m', 'Fixed pilot fixture']]) execFileSync('git', argv, { cwd: root, env, stdio: 'pipe' })
  const worker = direction === 'forward' ? 'claude' : 'codex', reviewer = direction === 'forward' ? 'codex' : 'claude'
  const cfg = { direction, output, scratch, root, data, taskId: task.id, worker, reviewer, leader: reviewer, interruptDelivery: args.includes('--interrupt-delivery'), maxOpenings: args.includes('--interrupt-delivery') ? 7 : 4 }
  atomic(join(output, 'config.json'), cfg); atomic(join(output, 'openings.json'), [])
  const paths = ['scripts/verify-autonomous-harness.mjs', 'package.json', 'package-lock.json', 'packages/sidecar/hooks/statusline.mjs']
  const walk = path => { for (const entry of readdirSync(join(repo, path), { withFileTypes: true })) { const p = `${path}/${entry.name}`; if (entry.isDirectory()) walk(p); else if (/\.(ts|json|md)$/.test(p)) paths.push(p) } }
  for (const path of ['packages/sidecar/src', 'packages/sidecar/resources', 'packages/protocol/src']) walk(path)
  const source = paths.sort().map(path => ({ path, sha256: createHash('sha256').update(readFileSync(join(repo, path))).digest('hex') }))
  for (const { path } of source) { const dest = join(output, 'source', path); mkdirSync(dirname(dest), { recursive: true }); copyFileSync(join(repo, path), dest) }
  const runtime = { node: process.version, ...Object.fromEntries(['claude', 'codex'].map(cli => [cli, execFileSync(cli, ['--version'], { encoding: 'utf8', timeout: 10000 }).trim()])) }
  atomic(join(output, 'manifest.json'), { version: 1, ...cfg, runtime, pins, source, sourceRevision: createHash('sha256').update(JSON.stringify(source)).digest('hex'), corpusRevision: corpusRevision(), taskRevision: taskRevision(task), objective: objective(task, root, worker, reviewer), limits: { tokens: 1500000, knownClaudeUsd: 0.15 }, coordinator: 'native autonomous leader; supervisor only observes, tests and injects controlled fault', initialChecks: checkTask(task, root) })
  const execute = resume => new Promise(resolveChild => {
    const proc = fork(self, ['--child', join(output, 'config.json'), ...(resume ? ['--resume'] : [])], { execPath: process.execPath, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
    const log = openSync(join(output, resume ? 'recovered.log' : 'initial.log'), 'w', 0o600)
    proc.stdout.on('data', chunk => writeFileSync(log, chunk)); proc.stderr.on('data', chunk => writeFileSync(log, chunk))
    const timer = setInterval(() => { if (stopped) proc.kill('SIGTERM') }, 500)
    proc.on('exit', (code, signal) => { clearInterval(timer); closeSync(log); resolveChild({ code, signal }) })
  })
  console.log(JSON.stringify({ phase: 'start', output, scratch, direction, interruptDelivery: cfg.interruptDelivery }))
  const initial = await execute(false)
  let recovery = null, recoveryError = null
  if (!stopped && initial.signal === 'SIGKILL' && cfg.interruptDelivery && existsSync(join(output, 'checkpoint.json'))) {
    const checkpoint = json(join(output, 'checkpoint.json')), pids = checkpoint.panes.map(p => p.pid).filter(p => p > 0)
    const until = Date.now() + 15000
    while (pids.some(alive) && Date.now() < until) await sleep(500)
    if (pids.some(alive)) recoveryError = 'Owned inherited CLI still alive after crash; refusing recovery/lease bypass'
    else { console.log(JSON.stringify({ phase: 'recover', checkpointResultId: checkpoint.resultId })); recovery = await execute(true) }
  }
  const path = join(output, recovery ? 'recovered.json' : 'initial.json'), record = existsSync(path) ? json(path) : null
  const summary = { initialExit: initial, recoveryExit: recovery, recoveryError, passed: !!record?.passed && (!cfg.interruptDelivery || !!recovery), error: record?.error ?? null, evaluation: record?.evaluation ?? null, missionUsage: record?.missionUsage ?? null, openings: json(join(output, 'openings.json')).length, output }
  atomic(join(output, 'summary.json'), summary); console.log(JSON.stringify({ phase: 'finished', ...summary }))
  if (!summary.passed) process.exitCode = 1
}

if (args.includes('--child')) await child(args[args.indexOf('--child') + 1], args.includes('--resume'))
else await parent()
