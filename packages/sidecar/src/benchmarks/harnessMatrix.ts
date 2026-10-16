import { createHash } from 'node:crypto'
import type { HarnessCandidate, HarnessStrategy } from '@orbit/protocol'
import { harnessCandidateKey, validHarnessCandidate, validHarnessEvidence, validHarnessStrategy, type HarnessEvidence } from '../harness.ts'

export interface HarnessMatrix {
  version: 1
  corpusRevision: string
  sourceRevision: string
  oracleRevision: string
  strategies: HarnessStrategy[]
  candidates: HarnessCandidate[]
  cases: Array<{ id: string; revision: string; projectId: string; partition: 'calibration' | 'holdout'; strategyKey: string }>
  repetitions: number
  runs: Array<Omit<HarnessEvidence, 'version' | 'taskId' | 'projectId' | 'strategyKey' | 'partition' | 'benchmarkKey'> & { caseId: string; repetition: number }>
}
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex')
const sha = (s: unknown) => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s)
const id = (s: unknown) => typeof s === 'string' && s.length > 0 && s.length <= 300
/** Evaluates a closed matrix; incomplete/contradictory matrices never yield promotion records. */
export function evaluateHarnessMatrix(matrix: HarnessMatrix) {
  const issues: string[] = []
  if (!matrix || matrix.version !== 1 || ![matrix.corpusRevision, matrix.sourceRevision, matrix.oracleRevision].every(sha) || !Array.isArray(matrix.cases) || !Array.isArray(matrix.candidates) || !Array.isArray(matrix.strategies) || !Array.isArray(matrix.runs) || !Number.isSafeInteger(matrix.repetitions) || matrix.repetitions < 1 || matrix.repetitions > 10 || matrix.runs.length > 20000 || matrix.cases.length > 1000 || matrix.candidates.length > 256) throw new Error('Manifesto de benchmark inválido ou fora dos limites')
  if (!matrix.strategies.length || matrix.strategies.length > 100 || !matrix.strategies.every(validHarnessStrategy) || new Set(matrix.strategies.map(s => s.key)).size !== matrix.strategies.length || matrix.cases.length * matrix.candidates.length * matrix.repetitions > 20000) throw new Error('Manifesto com estratégia inválida ou matriz excessiva')
  const candidateKeys = matrix.candidates.filter(validHarnessCandidate).map(harnessCandidateKey)
  if (!candidateKeys.length || candidateKeys.length !== matrix.candidates.length || new Set(candidateKeys).size !== candidateKeys.length) issues.push('Configurações ausentes, inválidas ou duplicadas')
  if (!matrix.cases.length || new Set(matrix.cases.map(c => c.id)).size !== matrix.cases.length) issues.push('Casos ausentes ou duplicados; calibração e holdout devem ser disjuntos')
  const revisionPartitions = new Map<string, string>()
  for (const c of matrix.cases) {
    if (!id(c.id) || !id(c.projectId) || !sha(c.revision) || !['calibration', 'holdout'].includes(c.partition) || !matrix.strategies.some(s => s.key === c.strategyKey)) issues.push(`Caso inválido: ${c.id}`)
    if (revisionPartitions.has(c.revision) && revisionPartitions.get(c.revision) !== c.partition) issues.push('Mesmo conteúdo presente na calibração e no holdout')
    revisionPartitions.set(c.revision, c.partition)
  }
  if (!matrix.cases.some(c => c.partition === 'calibration') || !matrix.cases.some(c => c.partition === 'holdout')) issues.push('Calibração e holdout são obrigatórios')
  const benchmarkKey = hash({ corpus: matrix.corpusRevision, source: matrix.sourceRevision, oracle: matrix.oracleRevision, cases: matrix.cases, strategies: matrix.strategies, repetitions: matrix.repetitions, candidates: matrix.candidates })
  const seen = new Set<string>(), cells = new Set<string>(), evidence: HarnessEvidence[] = []
  for (const r of matrix.runs) {
    const c = matrix.cases.find(c => c.id === r.caseId)
    if (!c || !validHarnessCandidate(r.candidate)) { issues.push(`Execução desconhecida: ${r.id}`); continue }
    const e: HarnessEvidence = { ...r, version: 1, taskId: `${c.id}:${c.revision}`, projectId: c.projectId, strategyKey: c.strategyKey, partition: c.partition, benchmarkKey }
    const cell = JSON.stringify([c.id, harnessCandidateKey(r.candidate), r.repetition])
    if (!validHarnessEvidence(e) || !Number.isSafeInteger(r.repetition) || r.repetition < 1 || r.repetition > matrix.repetitions || !candidateKeys.includes(harnessCandidateKey(r.candidate))) { issues.push(`Execução inválida: ${r.id}`); continue }
    if (seen.has(r.id) || cells.has(cell)) issues.push(`Execução duplicada: ${r.id}`)
    seen.add(r.id); cells.add(cell); evidence.push(e)
  }
  for (const c of matrix.cases) for (const key of candidateKeys) for (let i = 1; i <= matrix.repetitions; i++) if (!cells.has(JSON.stringify([c.id, key, i]))) issues.push(`Configuração não executada: ${c.id}/${key.slice(0, 8)}/${i}`)
  if (new Set(evidence.map(e => e.mode)).size > 1) issues.push('Matriz mistura execuções live e simuladas')
  const rows = matrix.candidates.filter(validHarnessCandidate).map(candidate => {
    const runs = evidence.filter(e => harnessCandidateKey(e.candidate) === harnessCandidateKey(candidate))
    return { candidate, attempts: runs.length, accepted: runs.filter(r => r.outcome === 'accepted' && r.independentlyReviewed).length, tokens: runs.length && runs.every(r => r.tokens !== null) ? runs.reduce((s, r) => s + r.tokens!, 0) : null, costUsd: runs.length && runs.every(r => r.costUsd !== null) ? runs.reduce((s, r) => s + r.costUsd!, 0) : null, durationMs: runs.reduce((s, r) => s + r.durationMs, 0) }
  })
  // One incomplete identity/consumption invalidates the whole comparison, including successes.
  const certifiable = !issues.length && evidence.every(e => e.mode === 'live' && e.identityConfirmed && e.tokens !== null)
  return { version: 1, benchmarkKey, issues: [...new Set(issues)], rows, promotionEvidence: certifiable ? evidence.filter(e => e.partition === 'holdout') : [], note: 'Matriz válida não certifica superioridade: o seletor ainda exige cobertura e limite inferior de qualidade. Relatório importado não é evidência confiável por si só.' }
}
