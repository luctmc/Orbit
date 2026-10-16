import type { AuxiliaryCall, ExecutionMeasurement } from '../measurements.ts'
import type { CorpusCheck } from './corpus.ts'

export interface BenchmarkRun {
  version: 1
  id: string
  taskId: string
  taskRevision: string
  corpusRevision: string
  sourceRevision: string
  mode: 'offline' | 'live'
  configuration: 'eager' | 'budgeted'
  repetition: number
  runtime: { node: string; claude: string | null; codex: string | null }
  models: { worker: string; reviewer: string }
  limits: { tokens: number; knownClaudeCostUsd: number }
  durationMs: number
  firstResponseMs: null
  checks: CorpusCheck[]
  accepted: boolean
  resultReviewed: boolean
  integrationReviewed: boolean
  waived: boolean
  error: string | null
  executions: ExecutionMeasurement[]
  auxiliaryCalls: AuxiliaryCall[]
  attempts: number
  retries: number
  reopenings: number
  results: number
}
export const acceptedRun = (run: BenchmarkRun) => run.accepted && run.resultReviewed && run.integrationReviewed && !run.waived && !run.error && run.checks.length > 0 && run.checks.every(c => c.exitCode === 0)
const sumKnown = (values: Array<number | null>): number | null => values.length && values.every(v => v !== null && Number.isFinite(v) && v >= 0) ? values.reduce<number>((s, v) => s + v!, 0) : null
export function runUsage(run: BenchmarkRun) {
  const agents = run.executions.filter(e => e.cli !== 'shell')
  const totals = [...agents.map(e => e.usageSources?.includes(e.cli === 'claude' ? 'claude-transcript-v1' : 'codex-session-total-v1') ? e.usage.total : null), ...run.auxiliaryCalls.map(c => c.observation?.usage.total ?? null)]
  const costs = [...agents.map(e => e.usage.costUsd), ...run.auxiliaryCalls.map(c => c.observation?.usage.costUsd ?? null)]
  return { tokens: sumKnown(totals), costUsd: sumKnown(costs), knownCostUsd: costs.some(c => c !== null) ? costs.reduce<number>((s, v) => s + (v ?? 0), 0) : null, callsWithUsage: totals.filter(v => v !== null).length, observedExecutions: agents.length, auxiliaryCalls: run.auxiliaryCalls.length }
}
const quantiles = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  const q = (p: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)]! : null
  return { min: sorted[0] ?? null, median: sorted.length ? sorted.length % 2 ? sorted[Math.floor(sorted.length / 2)]! : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2 : null, p95: q(.95), max: sorted.at(-1) ?? null }
}
const key = (r: BenchmarkRun) => JSON.stringify([r.taskId, r.taskRevision, r.corpusRevision, r.sourceRevision, r.mode, r.repetition, r.runtime, r.models, r.limits])
const reduction = (before: number, after: number) => before > 0 ? (1 - after / before) * 100 : null

/** Refuse missing/duplicate/incompatible pairs and never hide failed work from the numerator. */
export function evaluateRuns(runs: BenchmarkRun[], expectedTasks: string[], repetitions = 3) {
  const issues: string[] = []
  const pairs = new Map<string, Partial<Record<BenchmarkRun['configuration'], BenchmarkRun>>>()
  const seenIds = new Set<string>()
  for (const run of runs) {
    if (run.version !== 1 || !Number.isInteger(run.repetition) || run.repetition < 1 || !['eager', 'budgeted'].includes(run.configuration) || !Number.isFinite(run.durationMs) || run.durationMs < 0) { issues.push(`Invalid run ${run.id}`); continue }
    if (seenIds.has(run.id)) { issues.push(`Duplicate run id ${run.id}`); continue }
    seenIds.add(run.id)
    const group = pairs.get(key(run)) ?? {}
    if (group[run.configuration]) { issues.push(`Duplicate configuration for ${run.taskId}/${run.repetition}`); continue }
    group[run.configuration] = run
    pairs.set(key(run), group)
  }
  for (const group of pairs.values()) if (!group.eager || !group.budgeted) issues.push(`Unpaired or incompatible run ${(group.eager ?? group.budgeted)!.taskId}`)
  const paired = [...pairs.values()].filter((p): p is { eager: BenchmarkRun; budgeted: BenchmarkRun } => !!p.eager && !!p.budgeted)
  const profiles = (['eager', 'budgeted'] as const).map(configuration => {
    const selected = runs.filter(r => r.configuration === configuration)
    const usage = selected.map(runUsage)
    const accepted = selected.filter(acceptedRun).length
    const tokens = sumKnown(usage.map(u => u.tokens)), cost = sumKnown(usage.map(u => u.costUsd))
    return { configuration, runs: selected.length, accepted, failedOrUnverified: selected.length - accepted, tokens, costUsd: cost, knownCostUsd: sumKnown(usage.map(u => u.knownCostUsd)), tokensPerAccepted: accepted && tokens !== null ? tokens / accepted : null, costPerAcceptedUsd: accepted && cost !== null ? cost / accepted : null, durationMs: quantiles(selected.map(r => r.durationMs)), initialBytes: selected.reduce((s, r) => s + r.executions.reduce((n, e) => n + e.initialBytes, 0), 0), retrievalBytes: selected.reduce((s, r) => s + r.executions.reduce((n, e) => n + e.contextReadBytes + e.skillReadBytes, 0), 0), submittedBytes: selected.reduce((s, r) => s + r.executions.reduce((n, e) => n + e.submittedBytes, 0), 0), attempts: selected.reduce((s, r) => s + r.attempts, 0), retries: selected.reduce((s, r) => s + r.retries, 0), reopenings: selected.reduce((s, r) => s + r.reopenings, 0), ptyAcceptedWakeups: selected.reduce((s, r) => s + r.executions.reduce((n, e) => n + e.ptyAcceptedWakeups, 0), 0) }
  })
  const qualityPreserved = runs.length > 0 && issues.length === 0 && runs.every(acceptedRun)
  const allLive = runs.length > 0 && runs.every(r => r.mode === 'live')
  const complete = issues.length === 0 && runs.length === expectedTasks.length * repetitions * 2 && expectedTasks.every(task => Array.from({ length: repetitions }, (_, i) => i + 1).every(rep => paired.some(p => p.eager.taskId === task && p.eager.repetition === rep)))
  const tokenCoverage = runs.length > 0 && runs.every(r => runUsage(r).tokens !== null)
  const initialReductions = paired.map(p => reduction(p.eager.executions.reduce((s, e) => s + e.initialBytes, 0), p.budgeted.executions.reduce((s, e) => s + e.initialBytes, 0))).filter((v): v is number => v !== null)
  const before = profiles[0]!, after = profiles[1]!
  const tokenReduction = allLive && qualityPreserved && tokenCoverage && before.tokensPerAccepted !== null && after.tokensPerAccepted !== null ? reduction(before.tokensPerAccepted, after.tokensPerAccepted) : null
  return { version: 1, comparison: 'Current harness with eager optional context versus current budgeted optional context; identical safety and review contracts', scope: allLive ? 'observed-live-sample' : 'offline-or-mixed; no model quality or token-savings claim', runs: runs.length, pairs: paired.length, issues, fullMatrixComplete: complete, qualityPreserved, tokenCoverage, profiles, initialByteReductionPercent: quantiles(initialReductions), observedTokenReductionPercent: tokenReduction, target25Percent: allLive && complete && qualityPreserved && tokenCoverage && tokenReduction !== null ? tokenReduction >= 25 : null, limitations: ['First PTY output is not semantic first response; firstResponseMs stays null', 'Provider/CLI cost estimates are not invoices; unreported cost remains null', 'Independent oracle execution time is included in total time', 'A pilot does not establish statistical significance or universal superiority', 'Fixed model names are requested pins; serving identity is only known when the provider reports it'] }
}
