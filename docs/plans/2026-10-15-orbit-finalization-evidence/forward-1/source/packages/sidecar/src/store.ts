import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { DeliveryNotice, DecisionReceipt, ExecutionPolicy, ResultInspection, VerificationInput, VerificationRecord } from '@orbit/protocol'
import { writerConflict } from './scheduler.ts'
import type { AuxiliaryCall, AuxiliaryObservation } from './measurements.ts'
import { makeNotice } from './deliveryQueue.ts'
import type { TurnCursor } from './adapters/codex.ts'
import { AGENT_CLIS, EMPTY_USAGE, type ActivityRecord, type ActivityResult, type Account, type Card, type CardColumn, type MissionTemplate, type Schedule, type UsageEntry, type AccountLimits, type AgentCliForRole, type Mission, type MissionEvent, type OrbitSettings, type RoutingProposal, type MemoryEntry, MEMORY_LIMITS, type MissionMode, type Pane, type Routing, type Snapshot, type SpawnPaneRequest, type Squad, type TokenUsage, type UsageDay, type Workspace } from '@orbit/protocol'
import { BUILTIN_ACCOUNTS, migrateLimits } from './accounts.ts'
import { DEFAULT_ROUTING, FACTORY_ALTS, FACTORY_METHODS, OLD_FACTORY_START, routingRevision } from './routing.ts'
import { BUILTIN_SQUADS } from './squads.ts'
import { deliveryPending, deliveryStatus, newDelivery, type DeliveryObligation } from './deliveryLedger.ts'
import { accountReport, type SessionBaseline } from './sessionAccounting.ts'
import { contractHash, createAttempt, emptyActivityLedger, resultDigest, syncAttempt, type ActivityLedger } from './activityLedger.ts'

const EVENTS_PER_MISSION = 200
const DEFAULT_SETTINGS: OrbitSettings = { resumeOnStart: true, smartClassify: true, agentsInEnglish: true, agentToolProfile: 'orbit' }
const PROPOSALS_KEPT = 50

export interface DelegationRecord {
  missionId: string
  key: string
  pane: Pane
  acceptance: string[]
  retryReason: string | null
  result?: { status: string; summary: string; evidence: string; details: string }
}

interface PersistedState extends Omit<Snapshot, 'squads' | 'routing' | 'accounts'> {
  // usageDays and limits are persisted as they are sent.
  version: 1
  nextPaneId: number
  /** User squads; builtins live in code. */
  customSquads: Squad[]
  /** The user's task table; null = Orbit's default. */
  routing: Routing | null
  /** Accounts the person added; the built-in ones live in code. */
  customAccounts: Account[]
  /** Whether Orbit may pick each built-in account by itself (default: yes). */
  builtinAuto: Record<string, boolean>
  /** Catalog items (skills, agents, MCP servers) Orbit's agents may not use. */
  disabledCatalog: string[]
  /** How each pane was opened (without its first task), to restart or resume it later. */
  paneSpecs: Record<string, SpawnPaneRequest>
  /** Tokens and cost per day, mission and agent setup (CLI, model, account). */
  usageLog: UsageEntry[]
  /** Each workspace's memory across missions. */
  memories?: Record<string, MemoryEntry[]>
  delegations?: DelegationRecord[]
  deliveryObligations?: DeliveryObligation[]
  sessionBaselines?: SessionBaseline[]
  activityLedger?: ActivityLedger
  executionEpochs?: Record<string, string>
  notifications?: DeliveryNotice[]
  adapterTurns?: Record<string, TurnCursor>
  executionPolicies?: Record<string, ExecutionPolicy>
  inspections?: ResultInspection[]
  verifications?: VerificationRecord[]
  resumePaneIds?: number[]
  auxiliaryCalls?: AuxiliaryCall[]
}

/** State in `<dataDir>/state.json`; critical acknowledgements bypass the ordinary debounce. */
export class Store {
  private initializing = true
  private readonly inheritedExecutions = new Set<string>()
  private readonly confirmedTerminations = new Set<string>()
  private state: PersistedState
  private readonly file: string
  /** Each workspace's memory, newest last. */
  private get memories(): Record<string, MemoryEntry[]> {
    return (this.state.memories ??= {})
  }

  /** Agents that were running when Orbit last stopped (they can be brought back). */
  readonly wasRunning: number[] = []
  private saveTimer: NodeJS.Timeout | null = null

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true })
    this.file = join(dataDir, 'state.json')
    this.state = this.load()
    // Older state files predate some fields.
    this.state.customSquads ??= []
    this.state.routing ??= null
    for (const squad of this.state.customSquads) for (const role of squad.roles) Object.assign(role, { skills: role.skills ?? [], onlySkills: role.onlySkills ?? false })
    for (const row of this.state.routing?.taskTypes ?? []) {
      row.onlySkills ??= false
      row.method ??= FACTORY_METHODS[row.id]?.method ?? ''
      // A factory method still in its old Portuguese text becomes the English one; edited ones stay.
      if (OLD_FACTORY_START[row.id] && row.method.startsWith(OLD_FACTORY_START[row.id]!)) row.method = FACTORY_METHODS[row.id]!.method
      row.readOnly ??= FACTORY_METHODS[row.id]?.readOnly ?? false
      row.alt ??= FACTORY_ALTS[row.id] && FACTORY_ALTS[row.id]!.cli !== row.cli ? FACTORY_ALTS[row.id]! : null
    }
    this.state.settings = { ...DEFAULT_SETTINGS, ...this.state.settings }
    if (this.state.settings.agentToolProfile !== 'orbit' && this.state.settings.agentToolProfile !== 'inherit') this.state.settings.agentToolProfile = 'orbit'
    this.state.proposals ??= []
    this.state.disabledCatalog ??= []
    this.state.paneSpecs ??= {}
    this.state.delegations ??= []
    this.state.cards ??= []
    this.state.templates ??= []
    this.state.schedules ??= []
    this.state.usageLog ??= []
    for (const entry of this.state.usageLog) if (entry.costComplete === undefined) {
      entry.costComplete = false
      if (entry.costUsd === 0) entry.costUsd = null // old zeros also represented missing reports
    }
    for (const template of this.state.templates) template.budget ??= null
    this.state.usageDays ??= []
    for (const day of this.state.usageDays) for (const cli of AGENT_CLIS) day[cli] ??= 0
    this.state.limits = migrateLimits(this.state.limits ?? [])
    this.state.customAccounts ??= []
    this.state.builtinAuto ??= {}
    for (const workspace of this.state.workspaces) {
      workspace.folders ??= [workspace.path]
      workspace.instructions ??= ''
    }
    for (const mission of this.state.missions) {
      mission.squadId ??= null
      mission.usage ??= { ...EMPTY_USAGE }
      mission.git ??= null
      mission.scheduleId ??= null
      mission.allowedClis ??= ['claude', 'codex']
      mission.readyAt ??= null
      mission.notes ??= []
      mission.readySummary ??= null
      mission.budget ??= null
    }
    // PTY connections cannot be reattached. Resume intent survives an orderly shutdown;
    // persisted writer leases independently check whether the previous process is gone.
    for (const pane of this.state.panes) {
      pane.attention = null
      pane.choices = null
      pane.deliveredAt ??= null
      pane.handoffStatus ??= pane.deliveredAt === null ? null : 'done'
      pane.assignedBy ??= null
      pane.squadRole ??= null
      pane.taskType ??= null
      pane.effort ??= null
      pane.accountId ??= null
      pane.sessionId ??= null
      pane.branch ??= null
      pane.usage ??= null
      pane.contextPercent = null
      if (pane.status !== 'exited') {
        this.wasRunning.push(pane.id)
        Object.assign(pane, { status: 'exited', pid: null })
      }
    }
    for (const id of this.state.resumePaneIds ?? []) if (!this.wasRunning.includes(id)) this.wasRunning.push(id)
    this.state.resumePaneIds = []
    if (!this.state.deliveryObligations) {
      // Closed helper terminals can still owe work. Live metadata supersedes its older snapshot.
      const known = new Map((this.state.delegations ?? []).map(d => [d.pane.id, d.pane]))
      for (const pane of this.state.panes) known.set(pane.id, pane)
      this.state.deliveryObligations = [...known.values()].flatMap(pane => {
        const contract = this.state.delegations?.find(d => d.pane.id === pane.id)
        const record = newDelivery(pane, contract?.acceptance)
        if (record && contract?.result) record.summary = contract.result.summary
        return record ? [record] : []
      })
      this.save()
    }
    if (!this.state.sessionBaselines) {
      this.state.sessionBaselines = []
      // Existing pane totals have already been charged. Migration establishes a watermark only.
      const known = new Map(this.state.delegations.map(d => [d.pane.id, d.pane]))
      for (const pane of this.state.panes) known.set(pane.id, pane)
      for (const pane of known.values()) if (pane.usage && pane.cli !== 'shell') accountReport(this.state.sessionBaselines, pane, pane.usage, 'legacy', Date.now())
      this.save()
    }
    if (!this.state.activityLedger) {
      this.state.activityLedger = emptyActivityLedger()
      for (const record of this.state.delegations) {
        const activity = this.newActivity(record.missionId, record.key, record.pane.title, contractHash({ ...this.state.paneSpecs[String(record.pane.id)], accept: record.acceptance }), record.acceptance)
        createAttempt(this.state.activityLedger, activity, record.pane.id, record.retryReason)
        syncAttempt(this.state.activityLedger, record.pane)
        if (record.result) this.appendResult(record.pane, { ...record.result, status: record.result.status as Pane['handoffStatus'] & string, deliveredTo: record.pane.assignedBy })
      }
      // Assignments made without agent_spawn also keep an activity identity.
      for (const delivery of this.state.deliveryObligations ?? []) {
        const pane = this.state.panes.find(p => p.id === delivery.paneId) ?? this.state.delegations.find(d => d.pane.id === delivery.paneId)?.pane
        if (pane) this.ensureActivity(pane, delivery)
        else {
          // Some old assignments only retain an obligation after their terminal was closed.
          const activity = this.newActivity(delivery.missionId, `assignment:${delivery.id}`, delivery.title, contractHash({ accept: delivery.acceptance }), delivery.acceptance)
          const attempt = createAttempt(this.state.activityLedger, activity, delivery.paneId, null, delivery.createdAt)
          attempt.state = delivery.status === 'done' ? 'delivered' : 'stopped'
          activity.deliveryId = delivery.id
          activity.state = delivery.status === 'waived' ? 'waived' : delivery.status === 'done' ? 'awaiting_validation' : 'stopped'
        }
      }
    }
    for (const attempt of this.state.activityLedger.attempts) if (['reserved', 'starting', 'running'].includes(attempt.state)) {
      attempt.state = 'stopped'
      attempt.error = 'Orbit reiniciou; confira a tentativa antes de retomar ou repetir.'
      const activity = this.state.activityLedger.activities.find(a => a.id === attempt.activityId)
      if (activity?.activeAttemptId === attempt.id && ['reserved', 'running'].includes(activity.state)) activity.state = 'stopped'
    }
    this.state.executionEpochs ??= {}
    for (const pane of this.state.panes) {
      pane.executionEpoch ??= `legacy:${pane.id}:${pane.createdAt}`
      this.state.executionEpochs[String(pane.id)] ??= pane.executionEpoch
    }
    if (!this.state.notifications) {
      this.state.notifications = []
      // R1 has no consumption receipts. Import latest results per attempt once, without claiming ACK.
      const latest = new Map(this.state.activityLedger.results.map(r => [r.attemptId, r]))
      for (const result of latest.values()) {
        if (result.status === 'progress' && result.deliveredTo === null) continue
        const attempt = this.state.activityLedger.attempts.find(a => a.id === result.attemptId)
        if (!attempt?.pane) continue
        this.state.notifications.push(makeNotice(result, attempt.pane, this.noticeRecipient(result.deliveredTo)))
      }
    }
    // Migration and crash recovery are durable before any new process can be launched.
    this.state.executionPolicies ??= {}
    for (const lease of Object.values(this.state.executionPolicies)) this.inheritedExecutions.add(lease.epoch)
    this.state.inspections ??= []
    this.state.verifications ??= []
    this.state.auxiliaryCalls ??= []
    this.initializing = false
    this.flush()
  }

  startExecution(paneId: number, executionEpoch: string, policy?: ExecutionPolicy): void {
    this.transaction(() => {
      // After a crash only ESRCH proves a persisted process is gone. A live/reused PID,
      // EPERM or a reservation without a PID stays blocked; never signal an unknown process.
      for (const [owner, lease] of Object.entries(this.state.executionPolicies ?? {})) {
        if (this.confirmedTerminations.has(lease.epoch)) { delete this.state.executionPolicies![owner]; continue }
        if (!lease.pid || !this.inheritedExecutions.has(lease.epoch)) continue
        try { process.kill(lease.pid, 0) } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ESRCH') delete this.state.executionPolicies![owner]
        }
      }
      if (this.state.executionPolicies?.[String(paneId)]) throw new Error(`A execução anterior de #${paneId} ainda não confirmou o encerramento`)
      if (policy) for (const [owner, current] of Object.entries(this.state.executionPolicies ?? {})) {
        if (Number(owner) !== paneId && writerConflict(policy, current)) throw new Error(`Conflito de escrita com #${owner}: a mesma cópia física já tem um writer. Feche/encerre esse processo ou use worktrees isolados.`)
      }
      (this.state.executionEpochs ??= {})[String(paneId)] = executionEpoch
      if (policy) (this.state.executionPolicies ??= {})[String(paneId)] = structuredClone(policy)
    })
  }

  executionPolicy(paneId: number): ExecutionPolicy | undefined { return structuredClone(this.state.executionPolicies?.[String(paneId)]) }
  prepareShutdown(): void {
    this.transaction(() => { this.state.resumePaneIds = this.state.panes.filter(p => p.status !== 'exited').map(p => p.id) })
  }
  bindExecutionProcess(paneId: number, epoch: string, pid: number): void {
    if (this.executionPolicy(paneId)?.epoch !== epoch) return
    this.transaction(() => { this.state.executionPolicies![String(paneId)]!.pid = pid })
  }
  releaseExecution(paneId: number, epoch: string): void {
    if (this.state.executionPolicies?.[String(paneId)]?.epoch !== epoch) return
    // Keep the observed OS receipt in memory if disk is temporarily unavailable.
    // A subsequent admission can atomically retry release and reserve its new lease.
    this.confirmedTerminations.add(epoch)
    this.transaction(() => { delete this.state.executionPolicies![String(paneId)] })
    this.confirmedTerminations.delete(epoch)
  }

  executionEpoch(paneId: number): string | undefined {
    return this.state.executionEpochs?.[String(paneId)]
  }

  revokeExecution(paneId: number): void { this.transaction(() => this.clearExecution(paneId)) }

  private clearExecution(paneId: number): void {
    const key = String(paneId)
    const epoch = this.state.executionEpochs?.[key]
    if (epoch && this.state.adapterTurns) delete this.state.adapterTurns[epoch]
    if (this.state.executionEpochs) delete this.state.executionEpochs[key]
    // Closing metadata revokes authority, not the process's writer lease.
    // Only a matching termination receipt (or ESRCH during admission) releases it.
  }

  adapterTurn(epoch: string): TurnCursor | undefined {
    const cursor = this.state.adapterTurns?.[epoch]
    return cursor && { ...cursor }
  }

  recordAdapterTurn(epoch: string, cursor: TurnCursor): void {
    this.transaction(() => {
      const previous = this.state.adapterTurns?.[epoch]
      const seenIds = previous?.at === cursor.at ? [...(previous.seenIds ?? [previous.id]), cursor.id] : [cursor.id]
      ;(this.state.adapterTurns ??= {})[epoch] = { ...cursor, seenIds: seenIds.slice(-256) }
    })
  }

  notifications(missionId?: string, pendingOnly = false): DeliveryNotice[] {
    return structuredClone((this.state.notifications ?? []).filter(n => (!missionId || n.missionId === missionId) && (!pendingOnly || n.state !== 'agent_acknowledged')))
  }

  private noticeRecipient(paneId: number | null): DeliveryNotice['recipient'] {
    const pane = paneId === null ? undefined : this.pane(paneId)
    return pane?.role === 'crew' ? { kind: 'pane', paneId: pane.id } : { kind: 'lead' }
  }

  markNoticeAccepted(id: string, pane: Pane): void {
    this.transaction(() => {
      const notice = this.state.notifications?.find(n => n.id === id && n.missionId === pane.missionId)
      if (!notice || !pane.executionEpoch || this.executionEpoch(pane.id) !== pane.executionEpoch) return
      if (!notice.deliveries.some(d => d.paneId === pane.id && d.executionEpoch === pane.executionEpoch)) notice.deliveries.push({ paneId: pane.id, executionEpoch: pane.executionEpoch, at: Date.now() })
      if (notice.state !== 'agent_acknowledged') notice.state = 'pty_accepted'
    })
  }

  acknowledgeNotice(id: string, pane: Pane): DeliveryNotice {
    return this.transaction(() => {
      const notice = this.state.notifications?.find(n => n.id === id && n.missionId === pane.missionId)
      if (!notice || !pane.executionEpoch || this.executionEpoch(pane.id) !== pane.executionEpoch) throw new Error('Aviso ou execução inválida')
      const current = this.pane(pane.id)
      if (!current || (notice.recipient.kind === 'lead' ? current.role !== 'lead' : current.id !== notice.recipient.paneId)) throw new Error('Só o destinatário atual confirma este aviso')
      if (!notice.deliveries.some(d => d.paneId === pane.id && d.executionEpoch === pane.executionEpoch)) throw new Error('Este aviso ainda não foi enviado a esta execução')
      if (notice.acknowledgedBy && (notice.acknowledgedBy.paneId !== pane.id || notice.acknowledgedBy.executionEpoch !== pane.executionEpoch)) throw new Error('Aviso confirmado por outra execução')
      notice.state = 'agent_acknowledged'
      notice.acknowledgedBy ??= { paneId: pane.id, executionEpoch: pane.executionEpoch, at: Date.now() }
      return structuredClone(notice)
    })
  }

  activityHistory(missionId: string): Omit<ActivityLedger, 'version'> {
    const ledger = this.state.activityLedger!
    const activities = ledger.activities.filter(a => a.missionId === missionId)
    const ids = new Set(activities.map(a => a.id))
    return structuredClone({ activities, attempts: ledger.attempts.filter(a => ids.has(a.activityId)), results: ledger.results.filter(r => ids.has(r.activityId)) })
  }

  activity(missionId: string, idOrKey: string): ActivityRecord | undefined {
    const activity = this.state.activityLedger!.activities.find(a => a.missionId === missionId && (a.id === idOrKey || a.key === idOrKey))
    return activity && structuredClone(activity)
  }

  activityAttempt(id: string) {
    const attempt = this.state.activityLedger!.attempts.find(a => a.id === id)
    return attempt && structuredClone(attempt)
  }

  currentPaneAttempt(paneId: number) {
    const attempt = this.state.activityLedger!.attempts.findLast(a => a.paneId === paneId)
    return attempt && this.state.activityLedger!.activities.some(a => a.id === attempt.activityId && a.activeAttemptId === attempt.id) ? structuredClone(attempt) : undefined
  }

  private newActivity(missionId: string, key: string, title: string, hash: string, acceptance: string[]): ActivityRecord {
    const at = Date.now()
    const activity: ActivityRecord = { id: randomUUID(), missionId, key, title, revision: 1, contractHash: hash, acceptance: [...acceptance], verificationRequired: !this.initializing, dependencies: [], state: 'reserved', activeAttemptId: '', deliveryId: null, createdAt: at, updatedAt: at }
    this.state.activityLedger!.activities.push(activity)
    return activity
  }

  /** Reserve the pane number and attempt in one durable commit before any spawn side effect. */
  reserveActivity(input: { missionId: string; key: string; title: string; contractHash: string; acceptance: string[]; retryReason: string | null; assignedBy: number; requiresDelivery: boolean; dependencies?: ActivityRecord['dependencies'] }) {
    return this.transaction(() => {
      const ledger = this.state.activityLedger!
      let activity = ledger.activities.find(a => a.missionId === input.missionId && a.key === input.key)
      if (activity) {
        const current = ledger.attempts.find(a => a.id === activity!.activeAttemptId)!
        const replay = input.retryReason ? ledger.attempts.find(a => a.activityId === activity!.id && a.retryReason === input.retryReason) : current
        if (replay) {
          if (replay.contractHash !== input.contractHash) throw new Error('O contrato ou critério da atividade mudou. Use retryReason com uma justificativa nova para criar uma revisão explícita.')
          return { activity: structuredClone(activity), attempt: structuredClone(replay), reused: true }
        }
        if (activity.contractHash !== input.contractHash) {
          activity.revision++
          activity.contractHash = input.contractHash
          activity.acceptance = [...input.acceptance]
        }
      } else activity = this.newActivity(input.missionId, input.key, input.title, input.contractHash, input.acceptance)
      activity.dependencies = structuredClone(input.dependencies ?? [])
      activity.verificationRequired = true
      activity.deliveryId = null
      const attempt = createAttempt(ledger, activity, this.state.nextPaneId++, input.retryReason)
      // A crash before opening the terminal still leaves required work, so ready cannot skip it.
      if (input.requiresDelivery) {
        const delivery: DeliveryObligation = { id: randomUUID(), missionId: input.missionId, paneId: attempt.paneId, assignedBy: input.assignedBy, title: input.title, acceptance: [...input.acceptance], status: 'pending', summary: '', createdAt: attempt.createdAt, updatedAt: attempt.createdAt, waiver: null, replacementId: null }
        this.state.deliveryObligations!.push(delivery)
        activity.deliveryId = delivery.id
        const mission = this.mission(input.missionId)
        if (mission) Object.assign(mission, { readyAt: null, readySummary: null })
      }
      return { activity: structuredClone(activity), attempt: structuredClone(attempt), reused: false }
    })
  }

  startingAttempt(id: string, seat: { cli: Pane['cli']; model: string | null; accountId: string | null; decision?: DecisionReceipt }): void {
    this.transaction(() => {
      const attempt = this.state.activityLedger!.attempts.find(a => a.id === id)
      if (!attempt || attempt.state !== 'reserved') throw new Error('Reserva de tentativa inválida')
      Object.assign(attempt, seat, { state: 'starting', updatedAt: Date.now() })
    })
  }

  failAttempt(id: string, error: unknown): void {
    this.transaction(() => {
      const attempt = this.state.activityLedger!.attempts.find(a => a.id === id)
      if (!attempt) return
      Object.assign(attempt, { state: 'stopped', error: String(error).slice(0, 1000), updatedAt: Date.now() })
      const activity = this.state.activityLedger!.activities.find(a => a.id === attempt.activityId)!
      activity.state = 'stopped'
    })
  }

  private ensureActivity(pane: Pane, delivery?: DeliveryObligation): ActivityRecord {
    const ledger = this.state.activityLedger!
    const attempt = ledger.attempts.findLast(a => a.paneId === pane.id)
    let activity = attempt && ledger.activities.find(a => a.id === attempt.activityId)
    if (!activity || (delivery && activity.deliveryId && activity.deliveryId !== delivery.id)) {
      activity = this.newActivity(pane.missionId, `assignment:${delivery?.id ?? randomUUID()}`, pane.title, contractHash({ accept: delivery?.acceptance }), delivery?.acceptance ?? [])
      createAttempt(ledger, activity, pane.id, null)
      syncAttempt(ledger, pane)
    }
    if (delivery) {
      activity.deliveryId = delivery.id
      if (delivery.status === 'waived') activity.state = 'waived'
    }
    const stored = this.pane(pane.id)
    if (stored) stored.activityAttemptId = activity.activeAttemptId
    return activity
  }

  private appendResult(pane: Pane, input: Pick<ActivityResult, 'status' | 'summary' | 'evidence' | 'details' | 'deliveredTo'> & Pick<Partial<ActivityResult>, 'source'>) {
    const ledger = this.state.activityLedger!
    const activity = this.ensureActivity(pane)
    const attempt = ledger.attempts.find(a => a.id === activity.activeAttemptId)!
    const payload = { ...input, activityId: activity.id, attemptId: attempt.id, activityRevision: attempt.activityRevision }
    const digest = resultDigest(payload)
    const existing = ledger.results.find(r => r.attemptId === attempt.id && r.digest === digest)
    if (existing) return { result: structuredClone(existing), duplicate: true }
    if (attempt.state === 'delivered' && input.status !== 'done') throw new Error('Esta tentativa já foi entregue. Progresso ou bloqueio atrasado não reabre o trabalho; peça uma nova atribuição.')
    const result: ActivityResult = { ...payload, id: randomUUID(), digest, state: input.status === 'auto' ? 'unverified' : 'submitted', createdAt: Date.now() }
    ledger.results.push(result)
    // "done" is a submission, never an independently validated result.
    if (input.status === 'done') {
      attempt.state = 'delivered'
      attempt.pane = { ...pane, handoffStatus: 'done', deliveredAt: result.createdAt }
      activity.state = 'awaiting_validation'
    } else if (attempt.state !== 'delivered') activity.state = input.status === 'blocked' ? 'blocked' : 'running'
    activity.updatedAt = result.createdAt
    return { result: structuredClone(result), duplicate: false }
  }

  commitActivityResult(pane: Pane, input: Pick<ActivityResult, 'status' | 'summary' | 'evidence' | 'details' | 'deliveredTo'> & Pick<Partial<ActivityResult>, 'source'>, event: Pick<MissionEvent, 'title' | 'body'>, notificationText?: string) {
    return this.transaction(() => {
      const committed = this.appendResult(pane, input)
      if (committed.duplicate) return { ...committed, event: null, notification: structuredClone(this.state.notifications?.find(n => n.resultId === committed.result.id) ?? null) }
      let notification: DeliveryNotice | null = null
      if (input.status !== 'progress' || input.deliveredTo !== null) {
        notification = makeNotice(committed.result, pane, this.noticeRecipient(input.deliveredTo), notificationText)
        this.state.notifications!.push(notification)
      }
      this.saveDelegationResult(pane.id, input)
      const stored = this.pane(pane.id)
      if (stored) Object.assign(stored, { handoffStatus: input.status, deliveredAt: input.status === 'progress' ? stored.deliveredAt : committed.result.createdAt })
      this.recordDelivery(pane, input.status, input.summary, false)
      if (notification?.recipient.kind === 'pane') {
        const target = this.pane(notification.recipient.paneId)
        if (target?.role === 'crew' && target.cli !== 'shell') {
          const next = { ...target, assignedBy: target.assignedBy ?? pane.assignedBy ?? pane.id, handoffStatus: null, deliveredAt: null }
          this.upsertPane(next)
          this.assignDeliveryRecord(next, this.currentPaneAttempt(target.id)?.acceptance ?? [])
          const mission = this.mission(pane.missionId)
          if (mission) Object.assign(mission, { readyAt: null, readySummary: null })
        }
      }
      const recorded = this.addEvent({ ...event, missionId: pane.missionId, paneId: pane.id, kind: 'handoff' })
      return { ...committed, event: recorded, notification: notification && structuredClone(notification) }
    })
  }

  saveInspection(input: Omit<ResultInspection, 'id' | 'createdAt'>): ResultInspection {
    return this.transaction(() => {
      const inspection = { ...structuredClone(input), id: randomUUID(), createdAt: Date.now() }
      this.state.inspections!.push(inspection)
      return structuredClone(inspection)
    })
  }
  inspection(missionId: string, id: string): ResultInspection | undefined {
    return structuredClone(this.state.inspections?.find(i => i.missionId === missionId && i.id === id))
  }
  verifications(missionId: string): VerificationRecord[] { return structuredClone(this.state.verifications?.filter(v => v.missionId === missionId) ?? []) }
  saveVerification(inspection: ResultInspection, result: ActivityResult, input: VerificationInput, readySummary?: string): VerificationRecord {
    return this.transaction(() => {
      if (readySummary !== undefined && (inspection.scope !== 'integration' || input.verdict !== 'accepted' || typeof readySummary !== 'string' || !readySummary.trim() || readySummary.length > 4000)) throw new Error('Conclusão exige integração aceita e resumo válido')
      const existing = this.state.verifications!.find(v => v.inspectionId === input.inspectionId)
      if (existing) {
        if (JSON.stringify([existing.verdict, existing.summary, existing.checks, existing.criteria]) !== JSON.stringify([input.verdict, input.summary, input.checks, input.criteria])) throw new Error('Esta inspeção já possui parecer; faça outra inspeção para mudar a decisão')
        if (readySummary === undefined) return structuredClone(existing)
      }
      const record: VerificationRecord = existing ?? { ...structuredClone(input), scope: inspection.scope, id: randomUUID(), missionId: inspection.missionId, resultId: result.id, activityId: result.activityId, activityRevision: result.activityRevision, attemptId: result.attemptId, reviewer: inspection.reviewer, source: inspection.source, integration: inspection.integration, contractDigest: inspection.contractDigest, provenance: 'independent-agent-report', createdAt: Date.now() }
      if (!existing) {
        this.state.verifications!.push(record)
        const activity = this.state.activityLedger!.activities.find(a => a.id === result.activityId)!
        if (inspection.scope === 'result') {
          activity.state = input.verdict === 'accepted' ? 'accepted' : 'awaiting_validation'
          activity.updatedAt = record.createdAt
        }
      }
      const mission = this.mission(record.missionId)
      if (readySummary !== undefined) {
        if (!mission) throw new Error('Missão inexistente')
        const summary = readySummary.trim()
        if (record.completion) {
          if (record.completion.summary !== summary || mission.readyAt !== record.completion.readyAt || mission.readySummary !== summary) throw new Error('Esta conclusão já possui outro resumo ou estado; faça outra inspeção')
        } else {
          const readyAt = Date.now()
          const event = this.addEvent({ missionId: mission.id, paneId: record.reviewer.paneId, kind: 'mission.ready', title: 'Missão pronta', body: summary })
          record.completion = { readyAt, summary, eventId: event.id }
          Object.assign(mission, { readyAt, readySummary: summary, updatedAt: readyAt })
        }
      } else if (mission) Object.assign(mission, { readyAt: null, readySummary: null })
      return structuredClone(record)
    })
  }

  /** Critical acknowledgements commit all projections in the same snapshot, or roll back. */
  private transaction<T>(mutate: () => T): T {
    const before = structuredClone(this.state)
    try {
      const result = mutate()
      this.flush()
      return result
    } catch (error) {
      this.state = before
      if (this.saveTimer) clearTimeout(this.saveTimer)
      this.saveTimer = null
      throw error
    }
  }

  accountSessionUsage(pane: Pane, next: TokenUsage, source: 'status' | 'rollout', at = Date.now()) {
    return this.transaction(() => {
      const { usage, delta } = accountReport(this.state.sessionBaselines ??= [], pane, next, source, at)
      const added = pane.cli === 'shell' ? undefined : this.addUsage(pane.missionId, pane.cli, delta, at)
      if (added && pane.cli !== 'shell') this.addLedger({ day: added.day.day, workspaceId: added.mission.workspaceId, missionId: pane.missionId, cli: pane.cli, model: pane.model, accountId: pane.accountId, tokens: delta.total, costUsd: next.costUsd === null ? null : delta.costUsd, costComplete: next.costUsd !== null })
      const stored = this.pane(pane.id)
      if (stored) stored.usage = usage
      return { usage, delta, added }
    })
  }

  snapshot(): Snapshot {
    const { workspaces, missions, panes, events, usageDays, limits, cards, templates, schedules, proposals } = this.state
    return structuredClone({ workspaces, missions, panes, events, squads: this.squads(), routing: this.routing(), usageDays, limits, accounts: this.accounts(), cards, templates, schedules, settings: this.settings(), proposals })
  }

  auxiliaryCalls(missionId: string): AuxiliaryCall[] { return structuredClone((this.state.auxiliaryCalls ?? []).filter(c => c.missionId === missionId)) }
  startAuxiliaryCall(input: Pick<AuxiliaryCall, 'missionId' | 'attemptId' | 'model' | 'promptBytes'>): AuxiliaryCall {
    return this.transaction(() => {
      if (this.mission(input.missionId)?.status !== 'active' || !this.activityAttempt(input.attemptId)) throw new Error('Missão/tentativa inválida para classificação')
      const record: AuxiliaryCall = { ...input, id: randomUUID(), kind: 'classifier', startedAt: Date.now(), finishedAt: null, observation: null }
      ;(this.state.auxiliaryCalls ??= []).push(record)
      return structuredClone(record)
    })
  }
  finishAuxiliaryCall(id: string, observation: AuxiliaryObservation) {
    return this.transaction(() => {
      const call = this.state.auxiliaryCalls?.find(c => c.id === id)
      if (!call) throw new Error('Chamada auxiliar não encontrada')
      if (call.observation) {
        if (JSON.stringify(call.observation) !== JSON.stringify(observation)) throw new Error('Chamada auxiliar já contabilizada com outro resultado')
        return { call: structuredClone(call), added: undefined }
      }
      call.observation = structuredClone(observation)
      call.finishedAt = Date.now()
      const u = observation.usage
      const added = this.addUsage(call.missionId, 'claude', { input: u.input ?? 0, output: u.output ?? 0, cacheRead: u.cacheRead ?? 0, cacheWrite: u.cacheWrite ?? 0, total: u.total ?? 0, costUsd: u.costUsd })
      if (added) this.addLedger({ day: added.day.day, workspaceId: added.mission.workspaceId, missionId: call.missionId, cli: 'claude', model: observation.reportedModels.length === 1 ? observation.reportedModels[0]! : call.model, accountId: null, tokens: u.total ?? 0, costUsd: u.costUsd, costComplete: u.costUsd !== null })
      return { call: structuredClone(call), added }
    })
  }

  /**
   * Adds what an agent used since its last report to its mission and to today's total.
   * Returns the updated mission and day, or nothing when there was nothing new.
   */
  addUsage(missionId: string, cli: AgentCliForRole, delta: TokenUsage, at = Date.now()): { mission: Mission; day: UsageDay } | undefined {
    if (delta.total <= 0 && !delta.costUsd) return undefined
    const mission = this.mission(missionId)
    if (!mission) return undefined
    mission.usage = addUsage(mission.usage, delta)
    const key = dayKey(at)
    let day = this.state.usageDays.find((d) => d.day === key)
    if (!day) {
      day = { day: key, ...Object.fromEntries(AGENT_CLIS.map((c) => [c, 0])) } as UsageDay
      this.state.usageDays.push(day)
      // A year and a bit is all the activity map shows.
      this.state.usageDays = this.state.usageDays.slice(-400)
    }
    day[cli] += delta.total
    this.save()
    return { mission: structuredClone(mission), day: { ...day } }
  }

  setLimits(limits: AccountLimits): AccountLimits[] {
    this.state.limits = [...this.state.limits.filter((l) => l.accountId !== limits.accountId), limits]
    this.save()
    return this.limits()
  }

  disabledCatalog(): string[] {
    return [...this.state.disabledCatalog]
  }

  setCatalogItem(id: string, enabled: boolean): string[] {
    const set = new Set(this.state.disabledCatalog)
    if (enabled) set.delete(id)
    else set.add(id)
    this.state.disabledCatalog = [...set].sort()
    this.save()
    return this.disabledCatalog()
  }

  limits(): AccountLimits[] {
    return structuredClone(this.state.limits)
  }

  accounts(): Account[] {
    return [...this.builtinAccounts(), ...this.state.customAccounts.map((a) => structuredClone(a))]
  }

  account(id: string): Account | undefined {
    return this.accounts().find((a) => a.id === id)
  }

  private builtinAccounts(): Account[] {
    return BUILTIN_ACCOUNTS.map((a) => ({ ...a, auto: this.state.builtinAuto[a.id] ?? true }))
  }

  saveAccount(account: Account): void {
    const index = this.state.customAccounts.findIndex((a) => a.id === account.id)
    if (index === -1) this.state.customAccounts.push(account)
    else this.state.customAccounts[index] = account
    this.save()
  }

  /** Built-in accounts only change whether Orbit may pick them by itself. */
  setBuiltinAuto(id: string, auto: boolean): void {
    this.state.builtinAuto = { ...this.state.builtinAuto, [id]: auto }
    this.save()
  }

  deleteAccount(id: string): void {
    this.state.customAccounts = this.state.customAccounts.filter((a) => a.id !== id)
    this.state.limits = this.state.limits.filter((l) => l.accountId !== id)
    this.save()
  }

  routing(): Routing {
    const routing = structuredClone(this.state.routing ?? DEFAULT_ROUTING)
    return { ...routing, revision: routingRevision(routing) }
  }

  /** null restores the default table. */
  settings(): OrbitSettings {
    return { ...this.state.settings }
  }

  saveSettings(settings: OrbitSettings): OrbitSettings {
    const profile = settings?.agentToolProfile ?? this.state.settings.agentToolProfile ?? 'orbit'
    if (profile !== 'orbit' && profile !== 'inherit') throw new Error('Perfil de ferramentas inválido')
    this.state.settings = { resumeOnStart: settings?.resumeOnStart === true, smartClassify: settings?.smartClassify === true, agentsInEnglish: settings?.agentsInEnglish !== false, agentToolProfile: profile }
    this.save()
    return this.settings()
  }

  memory(workspaceId: string): MemoryEntry[] {
    return structuredClone(this.memories[workspaceId] ?? [])
  }

  /** Adds or replaces an entry; the oldest unpinned ones go when the memory is full. */
  saveMemory(workspaceId: string, entry: MemoryEntry): MemoryEntry[] {
    const list = (this.memories[workspaceId] ??= [])
    const at = list.findIndex((e) => e.id === entry.id)
    if (at >= 0) list[at] = entry
    else list.push(entry)
    while (list.length > MEMORY_LIMITS.entries) {
      const oldest = list.findIndex((e) => !e.pinned)
      if (oldest < 0) break
      list.splice(oldest, 1)
    }
    this.save()
    return this.memory(workspaceId)
  }

  deleteMemory(workspaceId: string, entryId: string): MemoryEntry[] {
    this.memories[workspaceId] = (this.memories[workspaceId] ?? []).filter((e) => e.id !== entryId)
    this.save()
    return this.memory(workspaceId)
  }

  proposals(): RoutingProposal[] {
    return structuredClone(this.state.proposals)
  }

  proposal(id: string): RoutingProposal | undefined {
    return this.state.proposals.find((p) => p.id === id)
  }

  addProposal(input: Omit<RoutingProposal, 'id' | 'status' | 'createdAt'>): RoutingProposal {
    const proposal: RoutingProposal = { ...input, id: randomUUID(), status: 'pendente', createdAt: Date.now() }
    // Decided ones age out; pending ones stay until decided.
    const decided = this.state.proposals.filter((p) => p.status !== 'pendente')
    const drop = new Set(decided.slice(0, Math.max(0, this.state.proposals.length + 1 - PROPOSALS_KEPT)).map((p) => p.id))
    this.state.proposals = [...this.state.proposals.filter((p) => !drop.has(p.id)), proposal]
    this.save()
    return proposal
  }

  decideProposal(id: string, status: 'aceita' | 'recusada'): RoutingProposal | undefined {
    const proposal = this.proposal(id)
    if (!proposal) return undefined
    proposal.status = status
    this.save()
    return { ...proposal }
  }

  acceptRoutingProposal(id: string, routing: Routing): void {
    this.transaction(() => {
      const proposal = this.proposal(id)
      if (!proposal || proposal.status !== 'pendente') throw new Error('Proposta não está pendente')
      if (proposal.baseRevision !== this.routing().revision) throw new Error('A tabela mudou desde esta proposta; gere uma proposta atualizada')
      this.state.routing = { lead: routing.lead, taskTypes: routing.taskTypes }
      proposal.status = 'aceita'
    })
  }

  saveRouting(routing: Routing | null): void {
    this.transaction(() => {
      if (routing?.revision !== undefined && routing.revision !== this.routing().revision) throw new Error('A tabela mudou em outra edição; recarregue e reconcilie as alterações')
      this.state.routing = routing ? { lead: routing.lead, taskTypes: routing.taskTypes } : null
    })
  }

  squads(): Squad[] {
    return [...BUILTIN_SQUADS, ...this.state.customSquads].map((s) => structuredClone(s))
  }

  squad(id: string): Squad | undefined {
    const squad = BUILTIN_SQUADS.find((s) => s.id === id) ?? this.state.customSquads.find((s) => s.id === id)
    return squad && structuredClone(squad)
  }

  customSquadIds(): Set<string> {
    return new Set(this.state.customSquads.map((s) => s.id))
  }

  saveSquad(squad: Squad): void {
    const index = this.state.customSquads.findIndex((s) => s.id === squad.id)
    if (index === -1) this.state.customSquads.push(squad)
    else this.state.customSquads[index] = squad
    this.save()
  }

  deleteSquad(id: string): boolean {
    const before = this.state.customSquads.length
    this.state.customSquads = this.state.customSquads.filter((s) => s.id !== id)
    this.save()
    return this.state.customSquads.length !== before
  }

  /** A single-folder workspace: reuses the one whose only folder is `path`. */
  openWorkspace(path: string): Workspace {
    const existing = this.state.workspaces.find((w) => w.folders.length === 1 && w.path === path)
    if (existing) {
      existing.lastOpenedAt = Date.now()
      this.save()
      return structuredClone(existing)
    }
    return this.createWorkspace('', [path])
  }

  /** `folders` are validated by the caller; the first one is the main folder. */
  createWorkspace(name: string, folders: string[]): Workspace {
    const workspace: Workspace = { id: randomUUID(), path: folders[0]!, folders: [...folders], name: name || defaultName(folders), lastOpenedAt: Date.now(), instructions: '' }
    this.state.workspaces.push(workspace)
    this.save()
    return structuredClone(workspace)
  }

  updateWorkspace(id: string, patch: { name?: string; folders?: string[]; instructions?: string }): Workspace | undefined {
    const workspace = this.workspace(id)
    if (!workspace) return undefined
    if (patch.instructions !== undefined) workspace.instructions = patch.instructions
    if (patch.folders) Object.assign(workspace, { folders: [...patch.folders], path: patch.folders[0] })
    if (patch.name !== undefined) workspace.name = patch.name || defaultName(workspace.folders)
    this.save()
    return structuredClone(workspace)
  }

  workspace(id: string): Workspace | undefined {
    return this.state.workspaces.find((w) => w.id === id)
  }

  createMission(input: { workspaceId: string; title: string; objective: string; mode: MissionMode; squadId: string | null; allowedClis?: Mission['allowedClis']; budget?: Mission['budget'] }, git: (id: string) => Mission['git'] = () => null, scheduleId: string | null = null): Mission {
    const now = Date.now()
    const id = randomUUID()
    const mission: Mission = { id, status: 'active', createdAt: now, updatedAt: now, usage: { ...EMPTY_USAGE }, git: git(id), scheduleId, readyAt: null, readySummary: null, notes: [], ...input, allowedClis: input.allowedClis?.length ? input.allowedClis : ['claude', 'codex'], budget: input.budget ?? null }
    this.state.missions.push(mission)
    this.save()
    return { ...mission }
  }

  mission(id: string): Mission | undefined {
    return this.state.missions.find((m) => m.id === id)
  }

  updateMission(id: string, patch: Partial<Pick<Mission, 'status' | 'title' | 'objective' | 'git' | 'readyAt' | 'readySummary' | 'budget' | 'notes'>>): Mission | undefined {
    const mission = this.mission(id)
    if (!mission) return undefined
    Object.assign(mission, patch, { updatedAt: Date.now() })
    this.save()
    return { ...mission }
  }

  allocatePaneId(): number {
    const id = this.state.nextPaneId++
    this.save()
    return id
  }

  pane(id: number): Pane | undefined {
    return this.state.panes.find((p) => p.id === id)
  }

  upsertPane(pane: Pane): void {
    pane = { ...pane, activityAttemptId: this.currentPaneAttempt(pane.id)?.id ?? pane.activityAttemptId }
    const index = this.state.panes.findIndex((p) => p.id === pane.id)
    if (index === -1) this.state.panes.push({ ...pane })
    else this.state.panes[index] = { ...pane }
    // A reused terminal can get new work; completed activities keep their own final state.
    for (const record of this.state.delegations ?? []) if (record.pane.id === pane.id && record.pane.handoffStatus !== 'done') record.pane = { ...pane }
    if (this.state.activityLedger) syncAttempt(this.state.activityLedger, pane)
    this.save()
  }

  delegation(missionId: string, key: string): DelegationRecord | undefined {
    const record = this.state.delegations?.find((d) => d.missionId === missionId && d.key === key)
    return record && structuredClone(record)
  }

  delegations(missionId: string): DelegationRecord[] {
    return structuredClone((this.state.delegations ?? []).filter((d) => d.missionId === missionId))
  }

  saveDelegation(record: DelegationRecord): void {
    this.state.delegations = [...(this.state.delegations ?? []).filter((d) => d.missionId !== record.missionId || d.key !== record.key), structuredClone(record)]
    this.save()
  }

  saveDelegationResult(paneId: number, result: NonNullable<DelegationRecord['result']>): void {
    for (const record of this.state.delegations ?? []) {
      if (record.pane.id === paneId && record.result?.status !== 'done') record.result = { ...result }
    }
    this.save()
  }

  deliveries(missionId: string): DeliveryObligation[] {
    return structuredClone((this.state.deliveryObligations ?? []).filter(d => d.missionId === missionId))
  }

  /** Start or continue required work; completed assignments remain immutable history. */
  assignDelivery(pane: Pane, acceptance: string[]): void {
    this.transaction(() => this.assignDeliveryRecord(pane, acceptance))
  }

  private assignDeliveryRecord(pane: Pane, acceptance: string[]): void {
    const records = (this.state.deliveryObligations ??= [])
    const current = records.findLast(d => d.missionId === pane.missionId && d.paneId === pane.id)
    if (current && deliveryPending(current)) {
      Object.assign(current, { assignedBy: pane.assignedBy, status: 'pending', title: pane.title, updatedAt: Date.now() })
    } else {
      const record = newDelivery(pane, acceptance)
      if (record) records.push(record)
    }
    const delivery = records.findLast(d => d.missionId === pane.missionId && d.paneId === pane.id)
    this.ensureActivity(pane, delivery)
  }

  recordDelivery(pane: Pane, status: Pane['handoffStatus'], summary: string, persist = true): void {
    let record = this.state.deliveryObligations?.findLast(d => d.missionId === pane.missionId && d.paneId === pane.id)
    if (!record) {
      const created = newDelivery(pane)
      if (!created) return
      const records = (this.state.deliveryObligations ??= [])
      records.push(created)
      record = created
    }
    // A delayed report cannot reopen waived work. Reassignment explicitly creates a new record.
    if (record.status === 'waived' || record.status === 'superseded' || (record.status === 'done' && status !== 'done')) return
    Object.assign(record, { status: deliveryStatus(status), summary, updatedAt: Date.now() })
    if (persist) this.flush()
  }

  waiveDeliveries(missionId: string, by: number, reason: string): DeliveryObligation[] {
    const changed = (this.state.deliveryObligations ?? []).filter(d => d.missionId === missionId && deliveryPending(d))
    const at = Date.now()
    for (const record of changed) Object.assign(record, { status: 'waived', updatedAt: at, waiver: { by, reason, at } })
    for (const activity of this.state.activityLedger!.activities) if (changed.some(d => d.id === activity.deliveryId)) activity.state = 'waived'
    return structuredClone(changed)
  }

  waiveActivities(missionId: string, ids: string[], by: number, reason: string): void {
    this.transaction(() => {
      const at = Date.now()
      for (const activity of this.state.activityLedger!.activities.filter(a => a.missionId === missionId && ids.includes(a.id))) {
        activity.state = 'waived'
        const delivery = this.state.deliveryObligations?.find(d => d.id === activity.deliveryId)
        if (delivery) Object.assign(delivery, { status: 'waived', waiver: { by, reason, at }, updatedAt: at })
      }
    })
  }

  reassignDeliveries(missionId: string, previous: number, next: number): void {
    for (const record of this.state.deliveryObligations ?? []) {
      if (record.missionId === missionId && record.assignedBy === previous && deliveryPending(record)) record.assignedBy = next
    }
    this.flush()
  }

  /** An explicit retry replaces unresolved work; keep its history and point to the new owner. */
  replaceDelivery(missionId: string, previousPaneId: number, nextPaneId: number, by: number, reason: string): void {
    const records = this.state.deliveryObligations ?? []
    const replacement = records.findLast(d => d.missionId === missionId && d.paneId === nextPaneId)
    if (!replacement) return
    const at = Date.now()
    for (const record of records) {
      if (record.missionId === missionId && record.paneId === previousPaneId && deliveryPending(record)) {
        Object.assign(record, { status: 'superseded', replacementId: replacement.id, updatedAt: at, waiver: { by, reason, at } })
      }
    }
    this.flush()
  }

  removePane(id: number): void {
    this.clearExecution(id)
    this.state.panes = this.state.panes.filter((p) => p.id !== id)
    delete this.state.paneSpecs[String(id)]
    this.save()
  }

  /** A mission's cards, column by column in their order. */
  cards(missionId: string): Card[] {
    const rank = { afazer: 0, fazendo: 1, feito: 2 } as const
    return this.state.cards.filter((c) => c.missionId === missionId).sort((a, b) => rank[a.column] - rank[b.column] || a.order - b.order).map((c) => ({ ...c }))
  }

  card(id: string): Card | undefined {
    const card = this.state.cards.find((c) => c.id === id)
    return card && { ...card }
  }

  cardByNumber(missionId: string, number: number): Card | undefined {
    const card = this.state.cards.find((c) => c.missionId === missionId && c.number === number)
    return card && { ...card }
  }

  addCard(input: Pick<Card, 'missionId' | 'title' | 'notes' | 'column' | 'assignee' | 'createdBy'>): Card {
    const mine = this.state.cards.filter((c) => c.missionId === input.missionId)
    const now = Date.now()
    const card: Card = {
      ...input,
      id: randomUUID(),
      number: Math.max(0, ...mine.map((c) => c.number)) + 1,
      order: Math.max(-1, ...mine.filter((c) => c.column === input.column).map((c) => c.order)) + 1,
      createdAt: now,
      updatedAt: now,
    }
    this.state.cards.push(card)
    this.save()
    return { ...card }
  }

  updateCard(id: string, patch: Partial<Pick<Card, 'title' | 'notes' | 'assignee'>>): Card | undefined {
    const card = this.state.cards.find((c) => c.id === id)
    if (!card) return undefined
    Object.assign(card, patch, { updatedAt: Date.now() })
    this.save()
    return { ...card }
  }

  /** Puts a card at `index` of `column` and renumbers that column; returns every card that moved. */
  moveCard(id: string, column: CardColumn, index?: number): Card[] {
    const card = this.state.cards.find((c) => c.id === id)
    if (!card) return []
    const others = this.state.cards.filter((c) => c.missionId === card.missionId && c.column === column && c.id !== id).sort((a, b) => a.order - b.order)
    const at = index === undefined ? others.length : Math.max(0, Math.min(others.length, Math.floor(index)))
    others.splice(at, 0, card)
    card.column = column
    card.updatedAt = Date.now()
    const changed: Card[] = []
    others.forEach((c, i) => {
      if (c.order !== i || c === card) changed.push(c)
      c.order = i
    })
    this.save()
    return changed.map((c) => ({ ...c }))
  }

  deleteCard(id: string): boolean {
    const before = this.state.cards.length
    this.state.cards = this.state.cards.filter((c) => c.id !== id)
    this.save()
    return this.state.cards.length !== before
  }

  /** Adds to the ledger line of that day, mission and agent setup. */
  addLedger(entry: UsageEntry): void {
    if (entry.tokens <= 0 && (entry.costUsd ?? 0) <= 0) return
    const line = this.state.usageLog.find((e) => e.day === entry.day && e.missionId === entry.missionId && e.cli === entry.cli && e.model === entry.model && e.accountId === entry.accountId)
    if (line) {
      line.tokens += entry.tokens
      line.costUsd = line.costUsd === null && entry.costUsd === null ? null : Math.round(((line.costUsd ?? 0) + (entry.costUsd ?? 0)) * 1e6) / 1e6
      line.costComplete = line.costComplete !== false && entry.costComplete !== false && entry.costUsd !== null
    } else {
      this.state.usageLog.push({ ...entry, costComplete: entry.costComplete !== false && entry.costUsd !== null })
      // A year and a bit, like the activity map.
      const oldest = dayKey(Date.now() - 400 * 86_400_000)
      if (this.state.usageLog.length % 100 === 0) this.state.usageLog = this.state.usageLog.filter((e) => e.day >= oldest)
    }
    this.save()
  }

  /** Ledger lines of a month (YYYY-MM). */
  ledger(month: string): UsageEntry[] {
    return this.state.usageLog.filter((e) => e.day.startsWith(`${month}-`)).map((e) => ({ ...e }))
  }

  schedules(): Schedule[] {
    return structuredClone(this.state.schedules)
  }

  schedule(id: string): Schedule | undefined {
    const schedule = this.state.schedules.find((s) => s.id === id)
    return schedule && structuredClone(schedule)
  }

  saveSchedule(schedule: Schedule): void {
    const index = this.state.schedules.findIndex((s) => s.id === schedule.id)
    if (index === -1) this.state.schedules.push(structuredClone(schedule))
    else this.state.schedules[index] = structuredClone(schedule)
    this.save()
  }

  deleteSchedule(id: string): boolean {
    const before = this.state.schedules.length
    this.state.schedules = this.state.schedules.filter((s) => s.id !== id)
    this.save()
    return this.state.schedules.length !== before
  }

  template(id: string): MissionTemplate | undefined {
    const template = this.state.templates.find((t) => t.id === id)
    return template && structuredClone(template)
  }

  templateCount(): number {
    return this.state.templates.length
  }

  saveTemplate(template: MissionTemplate): void {
    const index = this.state.templates.findIndex((t) => t.id === template.id)
    if (index === -1) this.state.templates.push(template)
    else this.state.templates[index] = template
    this.save()
  }

  deleteTemplate(id: string): boolean {
    const before = this.state.templates.length
    this.state.templates = this.state.templates.filter((t) => t.id !== id)
    this.save()
    return this.state.templates.length !== before
  }

  setPaneSpec(id: number, spec: SpawnPaneRequest): void {
    this.state.paneSpecs[String(id)] = structuredClone(spec)
    this.save()
  }

  paneSpec(id: number): SpawnPaneRequest | undefined {
    const spec = this.state.paneSpecs[String(id)]
    return spec && structuredClone(spec)
  }

  // ---- deleting for good ----

  /** Forgets an agent: its record, how it was opened, and its lines in the mission flow. */
  forgetPane(id: number): void {
    this.clearExecution(id)
    this.state.delegations = (this.state.delegations ?? []).filter((d) => d.pane.id !== id)
    this.state.panes = this.state.panes.filter((p) => p.id !== id)
    delete this.state.paneSpecs[String(id)]
    this.state.events = this.state.events.filter((e) => e.paneId !== id)
    this.save()
  }

  /**
   * Forgets a mission and everything Orbit kept about it: agents, flow, board, proposals, usage
   * lines and, with `memory`, what it left in the project memory. Schedules forget their link to it.
   */
  forgetMission(id: string, memory: boolean): void {
    const mission = this.mission(id)
    if (!mission) return
    for (const pane of this.state.panes.filter(p => p.missionId === id)) this.clearExecution(pane.id)
    const activityIds = new Set(this.state.activityLedger!.activities.filter(a => a.missionId === id).map(a => a.id))
    for (const attempt of this.state.activityLedger!.attempts.filter(a => activityIds.has(a.activityId))) this.clearExecution(attempt.paneId)
    this.state.notifications = this.state.notifications?.filter(n => n.missionId !== id)
    this.state.inspections = this.state.inspections?.filter(i => i.missionId !== id)
    this.state.verifications = this.state.verifications?.filter(v => v.missionId !== id)
    this.state.auxiliaryCalls = this.state.auxiliaryCalls?.filter(c => c.missionId !== id)
    this.state.delegations = (this.state.delegations ?? []).filter((d) => d.missionId !== id)
    this.state.deliveryObligations = (this.state.deliveryObligations ?? []).filter(d => d.missionId !== id)
    const activities = new Set(this.state.activityLedger!.activities.filter(a => a.missionId === id).map(a => a.id))
    this.state.activityLedger!.activities = this.state.activityLedger!.activities.filter(a => !activities.has(a.id))
    this.state.activityLedger!.attempts = this.state.activityLedger!.attempts.filter(a => !activities.has(a.activityId))
    this.state.activityLedger!.results = this.state.activityLedger!.results.filter(a => !activities.has(a.activityId))
    this.state.sessionBaselines = (this.state.sessionBaselines ?? []).filter(b => {
      b.missionIds = b.missionIds.filter(m => m !== id)
      return b.missionIds.length > 0
    })
    const panes = new Set(this.state.panes.filter((p) => p.missionId === id).map((p) => String(p.id)))
    this.state.panes = this.state.panes.filter((p) => p.missionId !== id)
    for (const key of panes) delete this.state.paneSpecs[key]
    this.state.events = this.state.events.filter((e) => e.missionId !== id)
    this.state.cards = this.state.cards.filter((c) => c.missionId !== id)
    this.state.proposals = this.state.proposals.filter((p) => p.missionId !== id)
    this.state.usageLog = this.state.usageLog.filter((e) => e.missionId !== id)
    for (const schedule of this.state.schedules) if (schedule.lastMissionId === id) schedule.lastMissionId = null
    if (memory && this.memories[mission.workspaceId]) this.memories[mission.workspaceId] = this.memories[mission.workspaceId]!.filter((e) => e.source?.missionId !== id)
    this.state.missions = this.state.missions.filter((m) => m.id !== id)
    this.save()
  }

  /** Forgets a workspace: its missions, memory, templates and schedules. Its folders are not touched. */
  forgetWorkspace(id: string): void {
    for (const mission of this.state.missions.filter((m) => m.workspaceId === id)) this.forgetMission(mission.id, false)
    delete this.memories[id]
    this.state.templates = this.state.templates.filter((t) => t.workspaceId !== id)
    this.state.schedules = this.state.schedules.filter((s) => s.workspaceId !== id)
    this.state.workspaces = this.state.workspaces.filter((w) => w.id !== id)
    this.save()
  }

  addEvent(input: Omit<MissionEvent, 'id' | 'at'>): MissionEvent {
    const event: MissionEvent = { id: randomUUID(), at: Date.now(), ...input }
    this.state.events.push(event)
    const forMission = this.state.events.filter((e) => e.missionId === event.missionId)
    if (forMission.length > EVENTS_PER_MISSION) {
      const drop = new Set(forMission.slice(0, forMission.length - EVENTS_PER_MISSION).map((e) => e.id))
      this.state.events = this.state.events.filter((e) => !drop.has(e.id))
    }
    this.save()
    return { ...event }
  }

  /** Writes pending changes now; call on shutdown. */
  flush(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    const tmp = `${this.file}.tmp`
    const fd = openSync(tmp, 'w', 0o600)
    try {
      writeFileSync(fd, JSON.stringify(this.state, null, 2))
      fsyncSync(fd)
    } finally { closeSync(fd) }
    renameSync(tmp, this.file)
  }

  private save(): void {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => this.flush(), 250)
  }

  private load(): PersistedState {
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as PersistedState
      if (parsed.version === 1) return parsed
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    return { version: 1, nextPaneId: 1, workspaces: [], missions: [], panes: [], events: [], customSquads: [], routing: null, usageDays: [], limits: [], customAccounts: [], builtinAuto: {}, disabledCatalog: [], paneSpecs: {}, cards: [], templates: [], schedules: [], settings: { ...DEFAULT_SETTINGS }, proposals: [], usageLog: [] }
  }
}

/** "app" for one folder, "app + 2" for three. */
function defaultName(folders: string[]): string {
  const first = basename(folders[0] ?? '') || folders[0] || 'workspace'
  return folders.length > 1 ? `${first} + ${folders.length - 1}` : first
}

function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    total: a.total + b.total,
    costUsd: a.costUsd === null && b.costUsd === null ? null : Math.round(((a.costUsd ?? 0) + (b.costUsd ?? 0)) * 1e6) / 1e6,
  }
}

/** Local calendar day, YYYY-MM-DD. */
export function dayKey(at: number): string {
  const d = new Date(at)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
