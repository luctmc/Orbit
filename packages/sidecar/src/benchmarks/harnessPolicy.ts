import { createHash, randomUUID } from 'node:crypto'
import type { HarnessCandidate, TokenUsage } from '@orbit/protocol'
import type { ExecutionIdentity } from '../adapters/codexUsage.ts'
import { harnessCandidateKey, selectHarnessCandidate, validHarnessCandidate } from '../harness.ts'
import { evaluateHarnessMatrix, type HarnessMatrix } from './harnessMatrix.ts'
export interface TrialObservation {
  exitCode: number | null
  error: 'infrastructure' | 'agent' | 'oracle' | null
  durationMs: number
  observedAt: number
  identity: ExecutionIdentity
  usage: Record<keyof TokenUsage, number | null>
  checks: Array<{command: string; exitCode: number; summary: string}>
}
interface Cell { id: string; caseId: string; candidate: HarnessCandidate; repetition: number; reservedAt: number; observation: TrialObservation | null }
export interface HarnessBatch { id: string; mode: 'live'|'simulated'; manifest: Omit<HarnessMatrix,'runs'>; cells: Cell[]; createdAt: number }
interface Promotion { id: string; batchId: string; sourceRevision: string; digest: string; previousId: string | null; at: number; retiredAt: number | null }
export interface HarnessPolicyState { version: 1; batches: HarnessBatch[]; promotions: Promotion[]; activeId: string | null; transitions: Array<{id: string; kind: 'promote'|'rollback'; promotionId: string; reason: string; at: number}> }
export const emptyHarnessPolicy = (): HarnessPolicyState => ({version:1,batches:[],promotions:[],activeId:null,transitions:[]})
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const source = (revision: string) => /^[a-f0-9]{64}$/.test(revision)
function batchFor(state: HarnessPolicyState, id: string, revision: string): HarnessBatch {
  const batch = state.batches.find(b=>b.id===id)
  if (!batch) throw new Error('Benchmark não encontrado')
  if (!source(revision) || batch.manifest.sourceRevision !== revision) throw new Error('O runtime mudou; benchmark incompatível')
  return batch
}
export function beginHarnessBatch(state: HarnessPolicyState, manifest: Omit<HarnessMatrix,'runs'>, mode: HarnessBatch['mode'], revision: string): HarnessBatch {
  if (!source(revision) || manifest.sourceRevision !== revision) throw new Error('Revisão do runtime incompatível')
  if (!['live','simulated'].includes(mode) || state.batches.length >= 20) throw new Error('Modo inválido ou limite de benchmarks atingido')
  const expected = manifest.cases.length * manifest.candidates.length * manifest.repetitions
  if (expected > 20000) throw new Error('Matriz excede 20000 células')
  const check = evaluateHarnessMatrix({...manifest,runs:[]})
  if (check.issues.some(i=>!i.startsWith('Configuração não executada:'))) throw new Error('Manifesto inválido: '+check.issues.join('; '))
  const batch: HarnessBatch = {id:randomUUID(),mode,manifest:structuredClone(manifest),cells:[],createdAt:Date.now()}
  state.batches.push(batch)
  return batch
}
export function reserveHarnessCell(state: HarnessPolicyState, batchId: string, caseId: string, candidate: HarnessCandidate, repetition: number, revision: string): Cell {
  const batch = batchFor(state,batchId,revision)
  if (!validHarnessCandidate(candidate) || !batch.manifest.cases.some(c=>c.id===caseId) || !batch.manifest.candidates.some(c=>harnessCandidateKey(c)===harnessCandidateKey(candidate)) || !Number.isSafeInteger(repetition) || repetition<1 || repetition>batch.manifest.repetitions) throw new Error('Célula fora do manifesto')
  const previous=batch.cells.find(c=>c.caseId===caseId && c.repetition===repetition && harnessCandidateKey(c.candidate)===harnessCandidateKey(candidate))
  if (previous) return previous
  const cell: Cell = {id:randomUUID(),caseId,candidate:structuredClone(candidate),repetition,reservedAt:Date.now(),observation:null}
  batch.cells.push(cell);return cell
}
export function finishHarnessCell(state: HarnessPolicyState, batchId: string, cellId: string, observation: TrialObservation, revision: string): Cell {
  const cell = batchFor(state,batchId,revision).cells.find(c=>c.id===cellId)
  if (!cell) throw new Error('Reserve a célula antes de executar')
  if (cell.observation) {
    if (hash(cell.observation)!==hash(observation)) throw new Error('Célula já possui outro resultado')
    return cell
  }
  const i=observation.identity, u=observation.usage
  if (!i || !u || !Array.isArray(i.models) || !Array.isArray(i.efforts) || i.models.length>32 || i.efforts.length>8 || !['response','execution-context','unknown'].includes(i.level) || typeof i.complete!=='boolean' || !Object.values(u).every(v=>v===null || typeof v==='number' && Number.isFinite(v) && v>=0) || !Number.isFinite(observation.durationMs) || observation.durationMs<0 || !Number.isFinite(observation.observedAt) || observation.observedAt<=0 || observation.observedAt>Date.now() || observation.exitCode!==null && !Number.isInteger(observation.exitCode) || ![null,'infrastructure','agent','oracle'].includes(observation.error) || !Array.isArray(observation.checks) || observation.checks.length>100 || observation.checks.some(c=>typeof c.command!=='string' || !c.command.trim() || c.command.length>4000 || !Number.isInteger(c.exitCode) || typeof c.summary!=='string' || !c.summary.trim() || c.summary.length>8000)) throw new Error('Observação nativa/oracle inválida')
  cell.observation=structuredClone(observation);return cell
}
function matrixFor(batch: HarnessBatch): HarnessMatrix {
  return {...batch.manifest,runs:batch.cells.flatMap(cell=>{
    const o=cell.observation
    if (!o) return []
    const usageKnown=(['input','output','cacheRead','cacheWrite','total'] as const).every(k=>Number.isSafeInteger(o.usage[k]) && o.usage[k]!>=0) && (o.usage.input! + o.usage.output!) === o.usage.total
    const independentlyReviewed=!!o.checks.length
    return [{id:cell.id,caseId:cell.caseId,candidate:cell.candidate,repetition:cell.repetition,mode:batch.mode,
      outcome:o.error || o.exitCode!==0?'failed' as const:!independentlyReviewed?'unverified' as const:o.checks.every(c=>c.exitCode===0)?'accepted' as const:'rejected' as const,
      independentlyReviewed,identityConfirmed:o.identity.complete && o.identity.level==='response' && o.identity.models.length===1 && o.identity.models[0]===cell.candidate.model && o.identity.efforts.length===1 && o.identity.efforts[0]===cell.candidate.effort,
      tokens:usageKnown?o.usage.total:null,costUsd:o.usage.costUsd??null,durationMs:o.durationMs,observedAt:o.observedAt}]
  })}
}
function qualified(batch: HarnessBatch, revision: string) {
  if (batch.mode!=='live') throw new Error('Matriz simulada não promove política')
  if (batch.manifest.sourceRevision!==revision) throw new Error('Revisão do runtime incompatível')
  const expected=batch.manifest.cases.length*batch.manifest.candidates.length*batch.manifest.repetitions
  if (batch.cells.length!==expected || batch.cells.some(c=>!c.observation)) throw new Error('Matriz incompleta; reserva pendente não é sucesso')
  if (batch.cells.some(c => !c.observation!.checks.length)) throw new Error('Oracle ausente; matriz não qualificada')
  const report=evaluateHarnessMatrix(matrixFor(batch))
  if (report.issues.length || !report.promotionEvidence.length) throw new Error('Matriz não qualificada: identidade, consumo ou oracle incompleto')
  for(const strategy of batch.manifest.strategies) if (!selectHarnessCandidate(strategy,batch.manifest.candidates,report.promotionEvidence).selected) throw new Error('Cobertura/qualidade de holdout não qualifica a política')
  return report.promotionEvidence
}
export function promoteHarnessBatch(state: HarnessPolicyState, batchId: string, revision: string): Promotion {
  const batch=batchFor(state,batchId,revision)
  const previous=state.promotions.find(p=>p.batchId===batchId)
  if (previous?.retiredAt) throw new Error('Esta matriz foi retirada; execute um novo benchmark')
  qualified(batch,revision)
  if (previous) return previous // idempotent replay never reactivates an older promotion
  const promotion: Promotion={id:randomUUID(),batchId,sourceRevision:revision,digest:hash(batch),previousId:state.activeId,at:Date.now(),retiredAt:null}
  state.promotions.push(promotion);state.activeId=promotion.id
  state.transitions.push({id:randomUUID(),kind:'promote',promotionId:promotion.id,reason:'Matriz live completa e holdout qualificado',at:promotion.at})
  return promotion
}
export function rollbackHarnessPolicy(state: HarnessPolicyState, promotionId: string, reason: string) {
  const promotion=state.promotions.find(p=>p.id===promotionId)
  if (!promotion || typeof reason!=='string' || !reason.trim() || reason.length>2000) throw new Error('Política/motivo inválido')
  if (promotion.retiredAt) return promotion
  if (state.activeId!==promotionId) throw new Error('Rollback exige a política ativa')
  promotion.retiredAt=Date.now()
  const previous=state.promotions.find(p=>p.id===promotion.previousId && !p.retiredAt)
  state.activeId=previous?.id??null
  state.transitions.push({id:randomUUID(),kind:'rollback',promotionId,reason:reason.trim(),at:promotion.retiredAt})
  return promotion
}
export function activeHarnessEvidence(state: HarnessPolicyState, revision: string | null) {
  if (!revision || state.version!==1) return []
  const active=state.promotions.find(p=>p.id===state.activeId && !p.retiredAt && p.sourceRevision===revision)
  const batch=active && state.batches.find(b=>b.id===active.batchId)
  if (!active || !batch || hash(batch)!==active.digest) return []
  try { return qualified(batch,revision) } catch { return [] }
}
