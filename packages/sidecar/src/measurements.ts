import { performance } from 'node:perf_hooks'
import type { Pane, TokenUsage } from '@orbit/protocol'

export interface ObservedUsage {
  input: number | null
  output: number | null
  cacheRead: number | null
  cacheWrite: number | null
  total: number | null
  costUsd: number | null
}
export const unknownUsage = (): ObservedUsage => ({ input: null, output: null, cacheRead: null, cacheWrite: null, total: null, costUsd: null })
const count = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null
const money = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null

/** A single, non-resumed Claude JSON result. USD is a CLI estimate, never an invoice. */
export function headlessUsage(stdout: string): { usage: ObservedUsage; models: string[] } {
  try {
    const result = JSON.parse(stdout), raw = result.usage ?? {}
    const usage: ObservedUsage = { input: count(raw.input_tokens), output: count(raw.output_tokens), cacheRead: count(raw.cache_read_input_tokens), cacheWrite: count(raw.cache_creation_input_tokens), total: count(raw.total_tokens), costUsd: money(result.total_cost_usd) }
    const fields = [usage.input, usage.output, usage.cacheRead, usage.cacheWrite]
    if (usage.total === null && fields.every(v => v !== null)) {
      const sum = fields.reduce<number>((s, v) => s + v!, 0)
      usage.total = Number.isSafeInteger(sum) ? sum : null
    }
    // Crash results may contain zero placeholders instead of the spend before the crash.
    if (result.is_error && fields.every(v => v === null || v === 0) && !usage.costUsd) return { usage: unknownUsage(), models: [] }
    const models = result.modelUsage && typeof result.modelUsage === 'object' && !Array.isArray(result.modelUsage) ? Object.keys(result.modelUsage).sort() : []
    return { usage, models }
  } catch { return { usage: unknownUsage(), models: [] } }
}

export interface AuxiliaryObservation {
  exitCode: number | null
  durationMs: number
  usage: ObservedUsage
  reportedModels: string[]
  outcome: 'classified' | 'invalid' | 'error'
}
export interface AuxiliaryCall {
  id: string
  missionId: string
  attemptId: string
  model: string
  kind: 'classifier'
  promptBytes: number
  startedAt: number
  finishedAt: number | null
  observation: AuxiliaryObservation | null
}

export interface ExecutionMeasurement {
  usageSources: string[]
  epoch: string
  paneId: number
  missionId: string
  cli: Pane['cli']
  model: string | null
  role: Pane['role']
  spawnMs: number
  firstPtyOutputMs: number | null
  /** Bytes do role preparado localmente; não comprovam retenção ou cobrança no provedor. */
  preparedRoleBytes: number
  initialBytes: number
  sourceBytes: number
  contextReadBytes: number
  skillReadBytes: number
  submittedBytes: number
  submittedMessages: number
  ptyAcceptedWakeups: number
  reports: number
  usage: ObservedUsage
}

/** Optional, in-memory measurement. No content, model calls or per-chunk disk writes. */
export class HarnessMeasurements {
  private readonly records = new Map<string, { record: ExecutionMeasurement; clock: number; totals: TokenUsage }>()
  start(pane: Pane, spawnMs: number, initialBytes: number, sourceBytes: number, preparedRoleBytes = 0): void {
    if (!pane.executionEpoch) return
    this.records.set(pane.executionEpoch, { clock: performance.now() - spawnMs, totals: {input:0,output:0,cacheRead:0,cacheWrite:0,total:0,costUsd:null}, record: { usageSources: [], epoch: pane.executionEpoch, paneId: pane.id, missionId: pane.missionId, cli: pane.cli, model: pane.model, role: pane.role, spawnMs, firstPtyOutputMs: null, initialBytes, sourceBytes, preparedRoleBytes, contextReadBytes: 0, skillReadBytes: 0, submittedBytes: 0, submittedMessages: 0, ptyAcceptedWakeups: 0, reports: 0, usage: unknownUsage() } })
  }
  output(epoch: string): void {
    const item = this.records.get(epoch)
    if (item && item.record.firstPtyOutputMs === null) item.record.firstPtyOutputMs = performance.now() - item.clock
  }
  bytes(epoch: string, kind: 'contextReadBytes' | 'skillReadBytes' | 'submittedBytes', text: string): void {
    const item = this.records.get(epoch)
    if (item) { item.record[kind] += Buffer.byteLength(text); if (kind === 'submittedBytes') item.record.submittedMessages++ }
  }
  wakeup(epoch: string): void { const item = this.records.get(epoch); if (item) item.record.ptyAcceptedWakeups++ }
  report(epoch: string, delta: TokenUsage, source: 'status' | 'rollout', known?: Partial<Record<keyof TokenUsage, boolean>>, origin?: string): void {
    const item = this.records.get(epoch)
    if (!item) return
    item.record.reports++
    if (origin && !item.record.usageSources.includes(origin)) item.record.usageSources.push(origin)
    for (const key of Object.keys(delta) as Array<keyof TokenUsage>) {
      const observed = known?.[key] ?? (key !== 'cacheRead' && key !== 'cacheWrite' || source === 'rollout')
      if (delta[key] !== null) item.totals[key] = (item.totals[key] ?? 0) + delta[key]!
      if (observed && delta[key] !== null) item.record.usage[key] = item.totals[key]
      else if (delta.total > 0 || item.record.reports === 1) item.record.usage[key] = null
    }
  }
  snapshot(missionId?: string): ExecutionMeasurement[] { return structuredClone([...this.records.values()].map(v => v.record).filter(r => !missionId || r.missionId === missionId)) }
}
