import { createHash, randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import { performance } from 'node:perf_hooks'
import type { HarnessCandidate, Pane } from '@orbit/protocol'
import { startServer } from '../server.ts'
import { loginShellRunner, loadCatalog, inspectCli, type Run } from '../clis.ts'
import { Store } from '../store.ts'
import { composeHarness } from '../harness.ts'
import { harnessAccounts } from '../harnessEligibility.ts'
import { harnessRuntimeRevision } from '../harnessRuntime.ts'
import { CORPUS, corpusRevision, taskRevision, fixtureFiles, writeFiles, checkTask, type CorpusCheck, type BenchmarkTask } from './corpus.ts'
import { runHarnessBenchmark } from './harnessRunner.ts'
import { aggregateTrialAccounting } from './trialAccounting.ts'
import type { TrialObservation } from './harnessPolicy.ts'
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
/** Prepared inputs must be precisely the public fixture in an owned temporary directory. */
export function validatePreparedPilot(task: BenchmarkTask, path: string): string {
  const workspace = realpathSync(path), rel = relative(realpathSync(tmpdir()), workspace)
  if (!rel || rel.startsWith('..') || isAbsolute(rel) || lstatSync(path).isSymbolicLink() || lstatSync(workspace).uid !== process.getuid?.()) throw new Error('Piloto exige uma pasta temporária própria')
  const files = fixtureFiles(task)
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name), st = lstatSync(full), key = relative(workspace, full)
      if (st.isSymbolicLink()) throw new Error('Fixture não aceita links')
      if (key === '.git' && st.isDirectory()) continue
      if (st.isDirectory()) walk(full)
      else if (!st.isFile() || !(key in files) || readFileSync(full, 'utf8') !== files[key]) throw new Error('Conteúdo fora do corpus público; nenhum modelo será iniciado')
    }
  }
  walk(workspace)
  for (const [key, value] of Object.entries(files)) if (readFileSync(join(workspace, key), 'utf8') !== value) throw new Error('Fixture incompleta')
  return workspace
}
const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>(resolve => {
  const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', finish); resolve() }
  const timer = setTimeout(finish, ms); signal?.addEventListener('abort', finish, { once: true })
  if (signal?.aborted) finish()
})

/** An explicitly requested two-task live pilot through Orbit's actual PTYs/MCP/ledger.
 * Public fixtures only, no automatic trust/permission confirmation, no retries or promotion.
 * The independent local oracle grades actual files after all writers have terminated.
 */
export async function runNativeHarnessPilot(options: { cli: 'codex' | 'claude'; preparedWorkspaces?: Record<string, string>; trustedFolders?: string[]; signal?: AbortSignal; onProgress?: (message: object) => void }) {
  const root = mkdtempSync(join(tmpdir(), 'orbit-native-harness-'))
  const shell = process.env.SHELL || '/bin/zsh', shellRun = loginShellRunner(shell)
  const run: Run = (command, timeout) => {
    if (command === 'codex debug models') return shellRun('codex debug models --bundled', timeout)
    if (command === `command -v ${options.cli}` || command === `${options.cli} --version` || command === `${options.cli} login status` || command === `${options.cli} auth status` || command.includes('read-codex-limits.mjs') && options.cli === 'codex' || command.startsWith('claude -p "/usage"') && options.cli === 'claude') return shellRun(command, timeout)
    return Promise.resolve({ code: 127, stdout: '', stderr: 'probe outside bounded native pilot' })
  }
  const [catalog, installed] = await Promise.all([loadCatalog(run), inspectCli(run, options.cli)])
  if (!installed.installed || !installed.version) throw new Error('CLI nativa indisponível para o piloto')
  const model = catalog[options.cli].models.find(m => /luna|mini|haiku|affordable|lightweight/i.test(`${m.id} ${m.description}`)) ?? catalog[options.cli].models[0]
  if (!model) throw new Error('Catálogo sem modelo para o piloto')
  const effort = model.efforts.includes('low') ? 'low' : model.defaultEffort ?? model.efforts[0]
  if (!effort) throw new Error('Esforço do piloto não disponível no catálogo')
  const candidate: HarnessCandidate = { cli: options.cli, model: model.id, effort, cliVersion: installed.version, catalogRevision: sha(catalog) }
  const tasks = ['op-build', 'bug-mean'].map(id => CORPUS.find(t => t.id === id)!)
  const strategies = tasks.map(t => composeHarness({ kind: t.category === 'bug' ? 'bug' : 'operacao', difficulty: 'normal', readOnly: false, retry: false }))
  const revision = harnessRuntimeRevision(true)
  if (!revision) throw new Error('Runtime sem identidade verificável')
  const journal = new Store(join(root, 'journal'))
  const diagnostics: Array<object> = []
  const batch = await runHarnessBenchmark(journal, { version: 1, sourceRevision: revision, corpusRevision: corpusRevision(), oracleRevision: sha(tasks.map(t => t.checks)), candidates: [candidate], strategies, repetitions: 1,
    cases: tasks.map((t, i) => ({ id: t.id, revision: taskRevision(t), projectId: `public-${i}`, partition: i ? 'holdout' : 'calibration', strategyKey: strategies[i]!.key })),
  }, { mode: 'live', signal: options.signal, execute: async cell => {
    const began = performance.now(), task = tasks.find(t => t.id === cell.caseId)!, scratch = join(root, cell.id)
    const prepared = options.preparedWorkspaces?.[task.id]
    const workspace = prepared ? validatePreparedPilot(task, prepared) : join(scratch, 'workspace')
    mkdirSync(scratch, { recursive: true })
    if (!prepared) {
      mkdirSync(workspace, { recursive: true }); writeFiles(workspace, fixtureFiles(task))
      for (const args of [['init', '-q', '-b', 'main'], ['add', '.'], ['-c', 'user.name=Orbit Pilot', '-c', 'user.email=pilot@localhost', 'commit', '-qm', 'Public synthetic fixture']]) execFileSync('git', args, { cwd: workspace, stdio: 'pipe' })
    }
    const server = await startServer({ port: 0, token: randomBytes(32).toString('hex'), allowedOrigins: ['http://localhost:5388'], dataDir: join(scratch, 'data'), shell, run, browser: null, scheduler: false })
    const core = server.core
    let missionId = '', message: string | null = null, delivered = false, worker: Pane | undefined
    let error: TrialObservation['error'] = null
    try {
      await server.initialized
      if (!harnessAccounts(core.store.accounts(), (core.welcome().find(m => m.type === 'account.status') as { statuses: import('@orbit/protocol').AccountStatus[] }).statuses, core.store.limits()).some(a => a.cli === options.cli)) throw new Error('Piloto bloqueado: login/limites atuais não confirmam assinatura com saldo nas janelas informadas')
      if (options.signal?.aborted) throw new Error('Piloto cancelado antes do lançamento')
      core.handle({ type: 'workspace.open', path: workspace })
      const w = core.store.snapshot().workspaces[0]!
      // Livre denies sub-helper admission. The local controller creates exactly one inference task
      // per corpus case; no classifier call, agent reviewer or hidden auxiliary phase.
      core.handle({ type: 'mission.create', allowOriginal: true, workspaceId: w.id, title: task.id, objective: task.goal, mode: 'livre', lead: { cli: 'shell', model: null, title: 'Protected oracle controller' }, budget: { tokens: 40000, costUsd: .5 } })
      const lead = core.store.snapshot().panes.find(p => p.role === 'lead')!; missionId = lead.missionId
      const accept = ['Preserve protected fixtures and stay within allowed writes', ...task.checks.map(c => c.label)]
      worker = (await core.spawnHelper(lead, { activityId: task.id, title: task.id, taskTypeId: task.category === 'bug' ? 'bug' : 'operacao', cli: options.cli, model: candidate.model, effort: candidate.effort,
        task: `${task.goal}\nPublic synthetic pilot. Allowed writes: ${task.allowedWrites.join(', ') || '(none)'}. Never edit .benchmark or other protected files. Verify with node .benchmark/all.mjs. No network, installs, commits, subagents or publication. Submit a handoff_submit with actual evidence and each criterion.`, accept })).pane
      options.onProgress?.({ phase: 'spawned', caseId: task.id, cli: options.cli, model: candidate.model, paneId: worker.id })
      const deadline = Date.now() + 180000
      let trustSent = false
      while (Date.now() < deadline) {
        if (options.signal?.aborted) throw new Error('Piloto cancelado')
        const current = core.store.pane(worker.id)
        // Keep bounded diagnostics in the private temporary trial, never in promotion evidence.
        const screen = (core as unknown as { panes: { screenText(id: number, lines: number): string } }).panes.screenText(worker.id, 100)
        writeFileSync(join(scratch, 'native-screen.txt'), screen.slice(-20000), { mode: 0o600 })
        if (screen.includes('Trust this folder?') && screen.includes('1. Trust and continue')) {
          if (!screen.replace(/\s/g, '').includes(workspace.replace(/\s/g, ''))) throw new Error('Prompt de confiança não corresponde à fixture')
          if (!options.trustedFolders?.some(path => realpathSync(path) === realpathSync(workspace))) throw new Error(`Confiança explícita necessária somente para ${workspace}`)
          if (!trustSent) {
            validatePreparedPilot(task, workspace)
            trustSent = true
            core.handle({ type: 'pane.input', paneId: worker.id, data: '\r' })
            options.onProgress?.({ phase: 'folder-trust-confirmed', caseId: task.id, workspace })
          }
        }
        const result = core.store.activityHistory(missionId).results.find(r => r.attemptId === core.store.currentPaneAttempt(worker!.id)?.id && r.status === 'done')
        if (result) { delivered = true; break }
        if (core.store.mission(missionId)?.budget?.exceeded) throw new Error('Orçamento do piloto atingido')
        if (current?.status === 'waiting') throw new Error('CLI pediu autorização/resposta; nenhuma confirmação automática foi enviada')
        if (current?.status === 'exited') { error = 'agent'; throw new Error('CLI encerrou antes de entregar') }
        await sleep(500, options.signal)
      }
      if (!delivered) throw new Error('Prazo de 180 s excedido; não haverá repetição automática')
      // Allow one normal native metadata poll before terminating the owned process.
      await sleep(5500, options.signal)
    } catch (cause) { error ??= 'infrastructure'; message = cause instanceof Error ? cause.message : String(cause) }
    finally { await server.close() }
    let checks: CorpusCheck[] = []
    try { checks = checkTask(task, workspace); if (checks.some(c => c.exitCode !== 0)) error ??= 'oracle' }
    catch (cause) { error ??= 'oracle'; message ??= cause instanceof Error ? cause.message : String(cause) }
    const attempts = missionId ? core.store.activityHistory(missionId).attempts.filter(a => a.cli !== 'shell') : []
    const accounting = aggregateTrialAccounting(attempts.map(a => core.store.harnessObservation(a.id)), missionId ? core.store.auxiliaryCalls(missionId) : [])
    const diagnostic = { caseId: task.id, delivered, message, attempts: attempts.length, quota: core.store.limits().map(l => ({ cli: l.cli, updatedAt: l.updatedAt, fiveHour: l.fiveHour, weekly: l.weekly, source: l.source, refreshError: l.refreshError ?? null })) }
    diagnostics.push(diagnostic); writeFileSync(join(scratch, 'diagnostic.json'), JSON.stringify(diagnostic, null, 2), { mode: 0o600 })
    options.onProgress?.({ phase: 'observed', caseId: task.id, delivered, error, message, tokens: accounting.usage.total })
    return { exitCode: delivered && !error ? 0 : null, error, durationMs: performance.now() - began, observedAt: Date.now(), checks, ...accounting }
  } })
  journal.flush()
  const restored = new Store(join(root, 'journal')), persisted = restored.harnessBenchmark(batch.id)!
  const accepted = persisted.cells.filter(c => c.observation?.exitCode === 0 && !c.observation.error && c.observation.checks.length && c.observation.checks.every(check => check.exitCode === 0)).length
  return { version: 1, mode: 'live', root, batchId: batch.id, candidate, tasks: tasks.map(t => t.id), attempts: persisted.cells.length, accepted,
    observations: persisted.cells.map(c => ({ caseId: c.caseId, observation: c.observation })), diagnostics, promotedObservations: restored.harnessEvidence().length,
    limitations: ['Two public tasks are functional pilot evidence, not a model comparison', 'Local executable oracle; not an autonomous LLM maestro or agent-review benchmark', 'Current native model/effort context is not provider response identity', 'No policy promotion and no token-savings attribution'] }
}
