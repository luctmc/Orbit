import { createHash } from 'node:crypto'
import { AGENT_CLIS, EFFORTS, MODEL_ID, type Difficulty, type HarnessCandidate, type HarnessDecision, type HarnessModule, type HarnessStrategy } from '@orbit/protocol'

export const HARNESS_POLICY_VERSION = 'orbit-harness-v1'
const MAX_AGE = 30 * 86400000
const MIN_SAMPLES = 30
const MIN_TASKS = 10
const MIN_PROJECTS = 2
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

export interface HarnessEvidence {
  version: 1
  id: string
  taskId: string
  projectId: string
  strategyKey: string
  candidate: HarnessCandidate
  mode: 'live' | 'simulated'
  partition: 'history' | 'calibration' | 'holdout'
  benchmarkKey?: string
  outcome: 'accepted' | 'rejected' | 'failed' | 'unverified'
  independentlyReviewed: boolean
  identityConfirmed: boolean
  tokens: number | null
  costUsd: number | null
  durationMs: number
  observedAt: number
}

/** Building blocks describe the activity, never extend its authority. */
export function composeHarness(input: { kind: string | null; difficulty: Difficulty; readOnly: boolean; retry: boolean; requireReadOnlySandbox?: boolean; constraintRevision?: string }): HarnessStrategy {
  const modules: HarnessModule[] = ['inspect']
  if (input.retry) modules.push('recover')
  if (input.kind === 'bug' || input.retry) modules.push('reproduce')
  if (!input.readOnly) modules.push('implement')
  if (input.kind === 'revisao') modules.push('review')
  modules.push('verify', 'deliver')
  const optionalContextBytes = input.difficulty === 'dificil' || input.retry ? 4000 : input.difficulty === 'simples' ? 1000 : 2000
  const stratum = JSON.stringify([input.kind ?? 'unclassified', input.difficulty, input.readOnly, input.retry])
  const constraints = { readOnly: input.readOnly, requireReadOnlySandbox: input.requireReadOnlySandbox === true, independentReviewRequired: true as const }
  return { version: 1, policyVersion: HARNESS_POLICY_VERSION, stratum, key: digest([HARNESS_POLICY_VERSION, stratum, modules, optionalContextBytes, constraints, input.constraintRevision ?? null]), modules, optionalContextBytes, ...constraints, qualityFloor: input.difficulty === 'dificil' || input.kind === 'revisao' ? .95 : .85 }
}

/** Manifests may carry compiler output, never redefine its invariant modules or quality floor. */
export function validHarnessStrategy(value: unknown): value is HarnessStrategy {
  try {
    const actual = value as HarnessStrategy
    if (!actual || !/^[a-f0-9]{64}$/.test(actual.key) || typeof actual.requireReadOnlySandbox !== 'boolean') return false
    const [kind, difficulty, readOnly, retry] = JSON.parse(actual.stratum)
    if (kind !== 'unclassified' && (typeof kind !== 'string' || !kind || kind.length > 100) || !['simples', 'normal', 'dificil'].includes(difficulty) || typeof readOnly !== 'boolean' || typeof retry !== 'boolean' || actual.requireReadOnlySandbox && !readOnly) return false
    const expected = composeHarness({ kind: kind === 'unclassified' ? null : kind, difficulty, readOnly, retry, requireReadOnlySandbox: actual.requireReadOnlySandbox })
    return (Object.keys(expected) as Array<keyof HarnessStrategy>).every(key => key === 'key' || JSON.stringify(actual[key]) === JSON.stringify(expected[key]))
  } catch { return false }
}

/** A new version, model or effort starts a new evidence cohort. */
export const harnessCandidateKey = (candidate: HarnessCandidate) => digest([candidate.cli, candidate.model, candidate.effort, candidate.cliVersion, candidate.catalogRevision])
const id = (s: unknown): s is string => typeof s === 'string' && s.length > 0 && s.length <= 300
export function validHarnessCandidate(value: unknown): value is HarnessCandidate {
  const c = value as HarnessCandidate | null
  return !!c && AGENT_CLIS.includes(c.cli) && typeof c.model === 'string' && c.model.length <= 200 && MODEL_ID.test(c.model) && EFFORTS.includes(c.effort) && id(c.cliVersion) && id(c.catalogRevision)
}
export function validHarnessEvidence(value: unknown): value is HarnessEvidence {
  const e = value as HarnessEvidence | null
  return !!e && e.version === 1 && [e.id, e.taskId, e.projectId, e.strategyKey].every(id) && validHarnessCandidate(e.candidate) && ['live', 'simulated'].includes(e.mode) && ['history', 'calibration', 'holdout'].includes(e.partition) && (e.benchmarkKey === undefined || /^[a-f0-9]{64}$/.test(e.benchmarkKey)) && ['accepted', 'rejected', 'failed', 'unverified'].includes(e.outcome) && typeof e.independentlyReviewed === 'boolean' && typeof e.identityConfirmed === 'boolean' && (e.tokens === null || Number.isSafeInteger(e.tokens) && e.tokens >= 0) && (e.costUsd === null || Number.isFinite(e.costUsd) && e.costUsd >= 0) && Number.isFinite(e.durationMs) && e.durationMs >= 0 && Number.isFinite(e.observedAt) && e.observedAt > 0
}

/** Wilson 95% lower bound: a small perfect sample is not certainty. */
export function qualityLowerBound(successes: number, total: number): number {
  if (!total) return 0
  const z2 = 1.96 ** 2, p = successes / total
  return (p + z2 / (2 * total) - 1.96 * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total)) / (1 + z2 / total)
}
const median = (values: number[]): number | null => {
  const sorted = [...values].sort((a, b) => a - b), at = Math.floor(sorted.length / 2)
  return !sorted.length ? null : sorted.length % 2 ? sorted[at]! : (sorted[at - 1]! + sorted[at]!) / 2
}
const fingerprint = (e: HarnessEvidence) => digest([e.id, e.taskId, e.projectId, e.strategyKey, harnessCandidateKey(e.candidate), e.mode, e.partition, e.benchmarkKey, e.outcome, e.independentlyReviewed, e.identityConfirmed, e.tokens, e.costUsd, e.durationMs, e.observedAt])

/** Pure and conservative: comparable live evidence can change a seat; absent evidence cannot. */
export function selectHarnessCandidate(strategy: HarnessStrategy, candidates: HarnessCandidate[], observations: HarnessEvidence[], options: { now?: number; explicit?: boolean } = {}): HarnessDecision {
  const empty = (reason: string, status: HarnessDecision['status'] = 'fallback'): HarnessDecision => ({ strategy, status, selected: null, samples: 0, qualityLowerBound: null, tokens: null, costUsd: null, durationMs: null, evidenceDigest: null, reasons: [reason] })
  if (options.explicit) return empty('Escolha explícita preservada; a política adaptativa não substitui a configuração solicitada.', 'explicit')
  if (candidates.length > 256 || observations.length > 20000) return empty('Volume de dados excede o limite desta política; preserve o fallback até conferir o conjunto.')
  const now = options.now ?? Date.now()
  const unique = new Map<string, HarnessEvidence>(), conflicts = new Set<string>()
  for (const e of observations) {
    if (!validHarnessEvidence(e)) return empty('Há observações inválidas no conjunto; corrija a origem antes de comparar configurações.')
    const previous = unique.get(e.id)
    if (previous && fingerprint(previous) !== fingerprint(e)) conflicts.add(e.id)
    else unique.set(e.id, e)
  }
  if (conflicts.size) return empty('Há versões contraditórias da mesma tentativa; o conjunto não pode certificar uma escolha.')
  const current = [...unique.values()].filter(e => !conflicts.has(e.id) && e.mode === 'live' && e.partition === 'holdout' && !!e.benchmarkKey && e.strategyKey === strategy.key && e.observedAt <= now && now - e.observedAt <= MAX_AGE)
  if (new Set(current.map(e => e.benchmarkKey)).size > 1) return empty('Matrizes de benchmark diferentes exigem comparação separada; nenhum ranking foi aplicado.')
  const qualified = [...new Map(candidates.filter(validHarnessCandidate).map(c => [harnessCandidateKey(c), c])).values()].flatMap(candidate => {
    const key = harnessCandidateKey(candidate), evidence = current.filter(e => harnessCandidateKey(e.candidate) === key)
    if (evidence.length < MIN_SAMPLES || new Set(evidence.map(e => e.taskId)).size < MIN_TASKS || new Set(evidence.map(e => e.projectId)).size < MIN_PROJECTS) return []
    // Missing consumption/identity cannot make a failing cohort look cheap or precise.
    if (evidence.some(e => e.tokens === null || !e.identityConfirmed)) return []
    const successes = evidence.filter(e => e.outcome === 'accepted' && e.independentlyReviewed).length
    const lower = qualityLowerBound(successes, evidence.length)
    if (lower < strategy.qualityFloor) return []
    return [{ candidate, evidence, lower, samples: evidence.length, tokens: median(evidence.map(e => e.tokens!))!, durationMs: median(evidence.map(e => e.durationMs))!, costUsd: evidence.every(e => e.costUsd !== null) ? median(evidence.map(e => e.costUsd!)) : null }]
  })
  if (qualified.length > 1 && new Set(qualified.map(q => JSON.stringify([...new Set(q.evidence.map(e => e.taskId))].sort()))).size !== 1) return empty('Configurações sem os mesmos casos de holdout; comparação de consumo recusada.')
  qualified.sort((a, b) => a.tokens - b.tokens || a.durationMs - b.durationMs || b.lower - a.lower || harnessCandidateKey(a.candidate).localeCompare(harnessCandidateKey(b.candidate)))
  const best = qualified[0]
  if (!best) return empty('Faltam testes comparáveis com modelos reais para escolher modelo e esforço por benchmark; o maestro usou a regra atual.')
  return { strategy, status: 'measured', selected: best.candidate, samples: best.samples, qualityLowerBound: best.lower, tokens: best.tokens, costUsd: best.costUsd, durationMs: best.durationMs, evidenceDigest: digest(best.evidence.map(fingerprint).sort()), reasons: [`${best.samples} tentativas comparáveis; limite inferior de qualidade ${(best.lower * 100).toFixed(1)}%.`, `Menor mediana de tokens entre ${qualified.length} configurações qualificadas; latência usada no desempate.`, ...(best.costUsd === null ? ['Custo em USD não foi observado por completo; não é tratado como zero nem como economia financeira.'] : [])] }
}

/** Bounded plan text. Mandatory project/permission instructions stay in their existing blocks. */
export function harnessNote(decision: HarnessDecision): string {
  const notes: Record<HarnessModule, string> = {
    inspect: 'Inspect relevant code, instructions and acceptance before acting.',
    recover: 'Read the previous result and retry reason; avoid repeating effects already completed.',
    reproduce: 'Reproduce the defect or rejected criterion and retain the failing evidence before changes.',
    implement: 'Make only the changes authorized by this activity and follow the project conventions.',
    review: 'Inspect the assigned result independently; report concrete findings and actual checks.',
    verify: 'Run checks appropriate to the acceptance and report real outputs; unknown is not passing.',
    deliver: 'Submit the result and evidence. Completion and independent acceptance remain separate.',
  }
  return `Execution strategy (${decision.strategy.policyVersion}; ${decision.status}):\n${decision.strategy.modules.map((m, i) => `${i + 1}. ${notes[m]}`).join('\n')}\nThis strategy never changes permissions, budget, tool/skill restrictions or the acceptance contract. Adapt only when evidence warrants it and report a blocked requirement rather than bypassing it.\n`
}
