// Wire contract between the Orbit UI and the sidecar (JSON over one WebSocket).

/** Isolated input translation; independent of agent routing and execution settings. */
export const TRANSLATION_MODEL = 'gpt-6-luna'
export const TRANSLATION_EFFORT = 'low'
export const TRANSLATION_LABEL = `Codex / ${TRANSLATION_MODEL} / ${TRANSLATION_EFFORT}`

export type MissionMode = 'livre' | 'squad' | 'agentica'
export type MissionStatus = 'active' | 'archived'

export interface Workspace {
  id: string
  /** The main folder: agents start here. Always `folders[0]`. */
  path: string
  /** Every folder in the workspace, main first. Agents get access to all of them. */
  folders: string[]
  name: string
  lastOpenedAt: number
  /** What every agent of this workspace is told: conventions, test commands, what to avoid. */
  instructions: string
}

/** What a project's memory holds: a decision that should stick, a fact, a lesson, a finished mission. */
export type MemoryKind = 'decisao' | 'fato' | 'licao' | 'missao'
export const MEMORY_KINDS: readonly MemoryKind[] = ['decisao', 'fato', 'licao', 'missao']
export const MEMORY_KIND_LABEL: Record<MemoryKind, string> = { decisao: 'Decisão', fato: 'Fato', licao: 'Lição', missao: 'Missão' }

/** One thing a workspace remembers across missions; written by leads, by Orbit or by the person. */
export interface MemoryEntry {
  id: string
  kind: MemoryKind
  text: string
  at: number
  /** Where it came from; null = written by the person. */
  source: { missionId: string; missionTitle: string; paneId: number | null } | null
  /** Always given to new leads first. */
  pinned: boolean
}

export const MEMORY_LIMITS = { entries: 200, text: 1500 } as const

/** A mission to start again: its setup, its lead and the board's cards. */
export interface MissionTemplate {
  id: string
  name: string
  /** Only offered in this workspace; null = any. */
  workspaceId: string | null
  title: string
  objective: string
  mode: MissionMode
  squadId: string | null
  isolation: 'worktrees' | null
  lead: { cli: AgentCli; model: string | null; effort: Effort | null }
  /** Titles of the cards the board starts with. */
  cards: string[]
  budget: { tokens: number | null; costUsd: number | null } | null
  createdAt: number
  updatedAt: number
}

export type MissionTemplateInput = Omit<MissionTemplate, 'id' | 'createdAt' | 'updatedAt' | 'budget'> & { id?: string; budget?: MissionTemplate['budget'] }

/** When a scheduled mission runs (local time). Days: 0 = domingo … 6 = sábado; none = every day. */
export type ScheduleWhen =
  | { kind: 'once'; at: number }
  | { kind: 'daily'; time: string; days: number[] }
  | { kind: 'interval'; hours: number }

/** A template started by itself, while Orbit is open. */
export interface Schedule {
  id: string
  name: string
  templateId: string
  workspaceId: string
  when: ScheduleWhen
  enabled: boolean
  /** Skip a run while the previous mission of this schedule still has agents working. */
  skipIfRunning: boolean
  /** Explicit Codex subscription used to translate each scheduled objective. */
  translationAccountId?: string
  /** Human consent to run the original objective without translation. */
  allowOriginal?: boolean
  nextRunAt: number | null
  lastRunAt: number | null
  lastMissionId: string | null
  /** What happened at the last run ("Missão iniciada", "Pulada: …", an error). */
  lastResult: string | null
  createdAt: number
}

export type ScheduleInput = Pick<Schedule, 'name' | 'templateId' | 'workspaceId' | 'when' | 'enabled' | 'skipIfRunning' | 'translationAccountId' | 'allowOriginal'> & { id?: string }

export const SCHEDULE_LIMITS = { schedules: 30, name: 60, maxHours: 168 } as const

/** A mission's limit: tokens and/or cost (cost counts Claude only; Codex does not report it). */
export interface MissionBudget {
  tokens: number | null
  costUsd: number | null
  /** 80% reached (warned once). */
  warned: boolean
  /** 100% reached: agents were interrupted and Claude's tools are refused until it is raised. */
  exceeded: boolean
}

export const BUDGET_WARN_AT = 0.8

/** Tokens and cost one agent setup spent on one day in one mission (the usage ledger). */
export interface UsageEntry {
  day: string
  workspaceId: string
  missionId: string
  cli: AgentCliForRole
  model: string | null
  accountId: string | null
  tokens: number
  /** Known subtotal; null means no USD amount was reported. */
  costUsd: number | null
  /** False when some usage in this row lacks a reported cost. Absent on legacy rows. */
  costComplete?: boolean
}

/** A mission whose agents each work in their own git worktree and branch. */
export interface MissionGit {
  /** Repository root of the workspace's main folder. */
  repo: string
  /** The main folder inside it ('' at the root); agents start there in their copy. */
  sub: string
  /** Branch the mission started from, and the PR's base. */
  base: string
  /** The lead's branch, where the helpers' work is merged. */
  branch: string
  /** The lead's working copy. */
  leadPath: string
  pr: { number: number; url: string } | null
}

/** What a mission branch has, for the PR. */
export interface GitSummary {
  base: string
  branch: string
  commits: Array<{ sha: string; subject: string }>
  files: Array<{ path: string; added: number | null; removed: number | null }>
  /** Each agent's branch: commits the mission branch does not have yet, and uncommitted files. */
  agents: Array<{ paneId: number; title: string; branch: string; ahead: number; dirty: string[] }>
  remote: boolean
}

export interface PrStatus {
  number: number
  url: string
  state: 'OPEN' | 'MERGED' | 'CLOSED'
  draft: boolean
  checks: Array<{ name: string; state: 'ok' | 'fail' | 'pending' | 'skip' }>
  checkedAt: number
}

export interface Mission {
  id: string
  workspaceId: string
  title: string
  objective: string
  mode: MissionMode
  /** The squad a `squad` mission follows. */
  squadId: string | null
  /** Tokens and cost of every agent the mission has had (closed ones included). */
  usage: TokenUsage & {costComplete?: boolean}
  /** Set when each agent works in its own branch (git worktree). */
  git: MissionGit | null
  /** The schedule that started it by itself, if any. */
  scheduleId: string | null
  /** CLIs the maestro may give helpers (and fall back to when one is used up). */
  allowedClis: AgentCliForRole[]
  /** When the lead declared the objective met (mission_ready); cleared when work starts again. */
  readyAt: number | null
  /** The lead's closing summary. */
  readySummary: string | null
  /** Decisions the leads wrote down (mission_note); they pass from one lead to the next. */
  notes: MissionNote[]
  /** Tokens/cost limit the person set; null = none. */
  budget: MissionBudget | null
  status: MissionStatus
  createdAt: number
  updatedAt: number
}

export type AgentCli = 'claude' | 'codex' | 'gemini' | 'antigravity' | 'shell'

/** A decision or fact a lead wrote down so it survives a change of lead. */
export interface MissionNote {
  at: number
  /** The lead that wrote it. */
  paneId: number
  text: string
}

export const NOTE_LIMITS = { notes: 60, text: 1000 } as const

/** Who leads next: a new agent, or a helper already in the mission. */
export type LeadTarget =
  | { kind: 'new'; cli: AgentCliForRole; model: string | null; effort: Effort | null; accountId: string | null }
  | { kind: 'promote'; paneId: number }
/** CLIs that can fill a squad role (a plain terminal cannot follow a brief). */
export type AgentCliForRole = Exclude<AgentCli, 'shell'>

/** The agent CLIs Orbit can run, in the order it shows them. */
export const AGENT_CLIS: readonly AgentCliForRole[] = ['claude', 'codex', 'gemini', 'antigravity']

/** What each agent CLI is and how Orbit talks to it. */
export interface AgentInfo {
  /** Short name in pickers and chips. */
  label: string
  /** The product, for the picker's second line. */
  product: string
  /** Executable on the PATH. */
  bin: string
  /**
   * How the agent reaches Orbit's tools: `mcp`, an MCP server given per session; `command`, the
   * `orbit` command in its terminal (CLIs whose MCP config cannot be given per session).
   */
  tools: 'mcp' | 'command'
  /** Reports its turns and tool calls to Orbit through hooks (status, handoff, refusals). */
  hooks: boolean
  /** Can carry on a conversation later. */
  resume: boolean
}

export const AGENT_INFO: Record<AgentCliForRole, AgentInfo> = {
  claude: { label: 'Claude', product: 'Claude Code · Anthropic', bin: 'claude', tools: 'mcp', hooks: true, resume: true },
  codex: { label: 'Codex', product: 'Codex CLI · OpenAI', bin: 'codex', tools: 'mcp', hooks: false, resume: true },
  gemini: { label: 'Gemini', product: 'Gemini CLI · Google', bin: 'gemini', tools: 'mcp', hooks: true, resume: true },
  antigravity: { label: 'Antigravity', product: 'Antigravity CLI · Google', bin: 'agy', tools: 'command', hooks: false, resume: true },
}

/** "Claude", "Codex", "Gemini", "Antigravity" or "Terminal". */
export const CLI_NAME: Record<AgentCli, string> = { claude: 'Claude', codex: 'Codex', gemini: 'Gemini', antigravity: 'Antigravity', shell: 'Terminal' }
export type PaneRole = 'lead' | 'crew'
/** A helper's own report: finished, stuck, or still at it. */
export type HandoffStatus = 'done' | 'blocked' | 'progress'
/** `auto` = the helper ended its turn without a handoff, and Orbit delivered its last message. */
export type PaneHandoff = HandoffStatus | 'auto'
/** `waiting` = the agent needs a human; set by hook reports, not by output heuristics. */
export type PaneStatus = 'starting' | 'running' | 'idle' | 'waiting' | 'exited'

/** Durable work identity; terminals are replaceable views of its attempts. */
export interface ActivityRecord {
  id: string
  missionId: string
  key: string
  title: string
  revision: number
  contractHash: string
  acceptance: string[]
  state: 'reserved' | 'running' | 'stopped' | 'blocked' | 'awaiting_validation' | 'accepted' | 'waived'
  /** Absent on historical work; never invent independent acceptance during migration. */
  verificationRequired?: boolean
  dependencies?: Array<{ activityId: string; revision: number; attemptId: string; resultId: string }>
  activeAttemptId: string
  deliveryId: string | null
  createdAt: number
  updatedAt: number
}

export interface ActivityAttempt {
  id: string
  activityId: string
  activityRevision: number
  contractHash: string
  /** Exact normalized helper request; absent on pre-continuity attempts, never inferred. */
  requestHash?: string
  acceptance: string[]
  paneId: number
  executionEpoch?: string | null
  state: 'reserved' | 'starting' | 'running' | 'stopped' | 'delivered'
  cli: AgentCli | null
  model: string | null
  accountId: string | null
  sessionId: string | null
  retryReason: string | null
  error: string | null
  decision?: DecisionReceipt
  /** A retained view for idempotent replies after the terminal is closed. */
  pane: Pane | null
  createdAt: number
  updatedAt: number
}

/** Submitted evidence is retained independently of the bounded mission event feed. */
export interface ActivityResult {
  id: string
  activityId: string
  attemptId: string
  activityRevision: number
  digest: string
  status: PaneHandoff
  state: 'submitted' | 'unverified'
  summary: string
  evidence: string
  details: string
  deliveredTo: number | null
  createdAt: number
  source?: SourceRevision | null
}

export interface ExecutionPolicy {
  /** Persisted after spawn; an unknown PID never proves that a process has stopped. */
  pid?: number
  missionId: string
  epoch: string
  readOnly: boolean
  /** Canonical physical copies, not file-level filesystem permissions. */
  roots: string[]
}
export interface SourceRevision {
  version: 1
  digest: string
  roots: Array<{ root: string; kind: 'git' | 'files'; head: string | null; digest: string; files: number }>
}
export type HarnessModule = 'inspect' | 'recover' | 'reproduce' | 'implement' | 'review' | 'verify' | 'deliver'
export interface HarnessCandidate {
  cli: AgentCliForRole
  model: string
  effort: Effort
  cliVersion: string
  catalogRevision: string
}
export interface HarnessStrategy {
  version: 1
  policyVersion: string
  key: string
  stratum: string
  modules: HarnessModule[]
  optionalContextBytes: number
  readOnly: boolean
  requireReadOnlySandbox: boolean
  independentReviewRequired: true
  qualityFloor: number
}
export interface HarnessDecision {
  strategy: HarnessStrategy
  status: 'measured' | 'fallback' | 'explicit'
  selected: HarnessCandidate | null
  /** Effective requested seat; identity still needs confirmation from provider evidence. */
  executed?: HarnessCandidate | null
  executionMode?: 'live' | 'simulated'
  samples: number
  qualityLowerBound: number | null
  tokens: number | null
  costUsd: number | null
  durationMs: number | null
  evidenceDigest: string | null
  reasons: string[]
}

export interface DecisionReceipt {
  version: 1
  policyRevision: string
  catalogRevision: string | null
  source: 'explicit' | 'rule' | 'classifier' | 'fallback' | 'benchmark'
  requested: { cli: AgentCli | null; model: string | null; effort: Effort | null }
  effective: { cli: AgentCli; model: string | null; effort: Effort | null; accountId: string | null }
  reasons: string[]
  capabilityLimits: string[]
  /** Composed strategy and comparable evidence; absent on historical attempts. */
  harness?: HarnessDecision
  at: number
}
export interface ResultInspection {
  scope: 'result' | 'integration'
  id: string
  missionId: string
  resultId: string
  reviewer: { paneId: number; epoch: string; attemptId: string | null }
  source: SourceRevision
  integration: SourceRevision
  contractDigest: string
  createdAt: number
}
export interface VerificationInput {
  inspectionId: string
  verdict: 'accepted' | 'changes_required' | 'unverified'
  summary: string
  checks: Array<{ command: string; exitCode: number; summary: string }>
  criteria: Array<{ item: number; met: boolean; how: string }>
}
export interface VerificationRecord extends VerificationInput {
  /** Explicit final integration acceptance and mission-ready state committed together. */
  completion?: { readyAt: number; summary: string; eventId: string }
  scope: 'result' | 'integration'
  id: string
  missionId: string
  resultId: string
  activityId: string
  activityRevision: number
  attemptId: string
  reviewer: ResultInspection['reviewer']
  source: SourceRevision
  integration: SourceRevision
  contractDigest: string
  provenance: 'independent-agent-report'
  createdAt: number
}

export interface Pane {
  /** Launch facts only; provider observations are independent and may arrive later. */
  executionConfig?: {
    decision: DecisionReceipt
    applied: { model: string | null; effort: Effort | null }
  }
  reportedEfforts?: Effort[]
  identityObservedAt?: number
  identityEvidence?: 'execution-context' | 'response' | 'unknown'
  /** Model IDs observed in the current provider session, not inferred from launch defaults. */
  reportedModels?: string[]
  /** Effective external MCP profile for this process; legacy panes inherited their CLI config. */
  toolProfile?: AgentToolProfile
  id: number
  /** Changes on every process opening, independently of the resumed provider session. */
  executionEpoch?: string
  /** Assignment captured with an agent request; changes when a terminal receives new work. */
  activityAttemptId?: string
  missionId: string
  role: PaneRole
  /** Squad role this helper plays (e.g. "Revisor"), when opened from a squad. */
  squadRole: string | null
  /** Task type it was routed by (e.g. "Correção de bug"), in agentic missions. */
  taskType: string | null
  cli: AgentCli
  model: string | null
  effort: Effort | null
  /** Account it runs as; null for terminals and for agents from before accounts existed. */
  accountId: string | null
  /** The CLI's conversation id (Claude's hooks, Codex's session file), to resume it later. */
  sessionId: string | null
  /** Its own branch, in missions where each agent has a worktree. */
  branch: string | null
  title: string
  cwd: string
  status: PaneStatus
  /** Why the agent needs a human, from its hook (e.g. a permission prompt) or its question. */
  attention: string | null
  /** Answers the agent offered with its question (ask_user), shown as buttons. */
  choices: string[] | null
  /** Last time this helper delivered its result (done, blocked, or Orbit delivering for it). */
  deliveredAt: number | null
  /** What its last handoff said; null while it owes one. */
  handoffStatus: PaneHandoff | null
  /** The agent that gave it work and waits for its handoff (usually the lead). */
  assignedBy: number | null
  /** Session totals reported by the CLI (status line for Claude, session file for Codex). */
  usage: TokenUsage | null
  /** How full the model's context window is, 0–100, when the CLI says. */
  contextPercent: number | null
  contextUsage?: ContextUsage
  pid: number | null
  exitCode: number | null
  createdAt: number
}

export interface DeliveryNotice {
  id: string
  missionId: string
  resultId: string
  recipient: { kind: 'lead' } | { kind: 'pane'; paneId: number }
  text: string
  state: 'persisted' | 'pty_accepted' | 'agent_acknowledged'
  deliveries: Array<{ paneId: number; executionEpoch: string; at: number }>
  acknowledgedBy: { paneId: number; executionEpoch: string; at: number } | null
  createdAt: number
}

/** A read-only observation for the visible mission; no model calls or acceptance mutation. */
export interface MissionProgress {
  missionId: string
  observedAt: number
  activities: ActivityRecord[]
  attempts: ActivityAttempt[]
  results: ActivityResult[]
  verifications: VerificationRecord[]
  deliveries: Array<Omit<DeliveryNotice, 'text'>>
  validation: Array<{ activityId: string; resultId: string | null; valid: boolean; reason: string | null }>
  integration: {
    state: 'none' | 'pending' | 'current' | 'stale' | 'unknown'
    reviewId: string | null
    reason: string | null
    checkedAt: number | null
  }
}

/** Current occupied context is separate from cumulative billed/session tokens. */
export interface ContextUsage {
  kind: 'measured' | 'estimated' | 'unavailable'
  usedTokens: number | null
  capacityTokens: number | null
  percent: number | null
  categories: Array<{ name: string; tokens: number }>
  source: string
  observedAt: number
}

/** Partial known cost is a lower bound; it cannot certify budget coverage. */
export function budgetStatus(usage: {total:number;costUsd:number|null;costComplete?:boolean}, budget:{tokens:number|null;costUsd:number|null}) {
  const shares: number[] = []
  if (budget.tokens) shares.push(usage.total / budget.tokens)
  const cost = usage.costUsd === null ? 'unavailable' as const : usage.costComplete === true ? 'reported' as const : 'partial' as const
  if (budget.costUsd && cost === 'reported') shares.push(usage.costUsd! / budget.costUsd)
  return {share:shares.length ? Math.max(...shares) : null,cost,knownCostUsd:usage.costUsd}
}

/** Tokens an agent (or a mission, or a day) used. `total` counts every kind. */
export interface TokenUsage {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  total: number
  /** Only Claude reports cost; null when unknown. */
  costUsd: number | null
}

export const EMPTY_USAGE: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, costUsd: null }

/** A usage limit window of the person's account (e.g. 5 hours, 7 days). */
export interface RateWindow {
  usedPercent: number
  /** Epoch ms. */
  resetsAt: number
  windowMinutes: number
}

/** The limits an account's CLI last reported. */
export interface ResetCredits {
  availableCount: number
  credits: Array<{ id: string; resetType: 'codexRateLimits'; expiresAt: number | null }> | null
}
export interface AccountLimits {
  /** Provider-reported promotional benefits. null/absent means unknown, never zero. */
  resetCredits?: ResetCredits | null
  accountId: string
  cli: AgentCliForRole
  fiveHour: RateWindow | null
  weekly: RateWindow | null
  plan: string | null
  updatedAt: number
  /** Last refresh attempt, distinct from the successful observation timestamp. */
  checkedAt?: number
  source?: 'provider' | 'session'
  refreshError?: string | null
}

/** Tokens used on one local day (YYYY-MM-DD), per CLI. */
/** Tokens of one day, per agent CLI. */
export type UsageDay = { day: string } & Record<AgentCliForRole, number>

/** One seat in a squad: who fills it and what they are told to do. */
export interface SquadRole {
  readOnly?: boolean
  /** Stable slug the lead uses to open the role, e.g. `revisor`. */
  id: string
  name: string
  cli: AgentCliForRole
  model: string | null
  /** Instructions appended to the helper's role prompt. */
  brief: string
  /** Skills this role uses, by name. */
  skills: string[]
  /** Only `skills` may be used (Claude is blocked by hook; Codex is told). */
  onlySkills: boolean
}

/** A team with a script (roteiro) the lead follows. */
export interface Squad {
  id: string
  name: string
  description: string
  /** Shipped with Orbit: read-only, can be duplicated. */
  builtin: boolean
  lead: { cli: AgentCliForRole; model: string | null }
  /** The script: how the lead runs the team, step by step. */
  playbook: string
  roles: SquadRole[]
  updatedAt: number
}

export type SquadInput = Omit<Squad, 'builtin' | 'updatedAt'>

/**
 * How hard the model thinks, weakest first. Claude: `--effort`; Codex: `model_reasoning_effort`.
 * Which levels apply depends on the CLI and the model: see `Catalog`.
 */
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra'
export const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra']
export const EFFORT_LABEL: Record<Effort, string> = { low: 'baixo', medium: 'médio', high: 'alto', xhigh: 'muito alto', max: 'máximo', ultra: 'ultra' }

/** A model an agent CLI offers, with the effort levels it accepts. */
export interface ModelInfo {
  id: string
  label: string
  description: string
  efforts: Effort[]
  defaultEffort: Effort | null
  capabilities?: { effort: boolean | null; fast: boolean | null; auto: boolean | null }
}

export interface CliCatalog {
  models: ModelInfo[]
  /** Levels the CLI accepts when the model is not in the list (its own default model, an alias…). */
  efforts: Effort[]
  /** `cli`: read from the installed CLI; `builtin`: Orbit's list, when the CLI cannot be asked. */
  source: 'cli' | 'builtin'
  accountId?: string
  origin?: string
  reason?: string
  observedAt?: number
  expiresAt?: number
  /** The model the CLI uses when none is chosen, when Orbit can tell (Codex's config.toml). */
  defaultModel?: string | null
  /** Effective effort configured by the user, before the model's own default. */
  defaultEffort?: Effort | null
}

export type Catalog = Record<AgentCliForRole, CliCatalog>

/** Effort levels valid for this CLI and model. */
export function effortsFor(catalog: Catalog | null, cli: AgentCli, model: string | null): readonly Effort[] {
  if (cli === 'shell') return []
  if (!catalog) return []
  const entry = catalog[cli]
  return entry.models.find((m) => m.id === (model ?? entry.defaultModel))?.efforts ?? (model === null ? entry.efforts : [])
}

/** An installed agent CLI as Orbit sees it. */
export interface CliStatus {
  cli: AgentCliForRole
  installed: boolean
  /** Where `command -v` points, resolved through symlinks. */
  path: string | null
  version: string | null
  /** How it was installed, which decides how Orbit updates it. */
  method: 'npm' | 'native' | 'brew' | 'unknown'
  latest: string | null
  checkedAt: number | null
  busy: 'checking' | 'updating' | null
  /** Outcome of the last check or update, for the person. */
  message: string | null
  ok: boolean | null
}

/** One row of "who does each task": the agent an agentic lead gets for that kind of work. */
export interface TaskType {
  /** Opt in to quota/model selection. Missing in older customized rows means fixed. */
  automatic?: boolean
  /** Slug the lead passes as `kind`, e.g. `bug`. */
  id: string
  name: string
  /** When this row applies; shown to the lead so it can classify the work. */
  description: string
  cli: AgentCliForRole
  model: string | null
  effort: Effort | null
  /** Skills the helper is told to use, by name. */
  skills: string[]
  /** Only `skills` may be used (Claude is blocked by hook; Codex is told). */
  onlySkills: boolean
  /** How to do this kind of work, told to the helper whatever its CLI (e.g. "reproduce first"). */
  method: string
  /** Reads and reports, never edits files (Claude's edit tools are refused; Codex is told). */
  readOnly: boolean
  /**
   * The same work on another CLI: the maestro sends it there when this row's CLI is much busier
   * (its accounts' use plus the agents already on them), or used up.
   */
  alt: AgentSeat | null
}

/** How hard an activity is: simple ones go to a cheaper model, hard ones to a stronger one or more effort. */
export type Difficulty = 'simples' | 'normal' | 'dificil'
export const ATTACHMENT_LIMITS = { files: 8, bytes: 4 * 1024 * 1024, totalBytes: 8 * 1024 * 1024 } as const
export interface Attachment {
  id: string
  name: string
  mime: string
  size: number
  path: string
}
export const DIFFICULTIES: readonly Difficulty[] = ['simples', 'normal', 'dificil']

/** A CLI, model and effort that can take a kind of work. */
export interface AgentSeat {
  /** Human choice: keep this model/effort, including a deliberate CLI default. */
  pinned?: boolean
  cli: AgentCliForRole
  model: string | null
  effort: Effort | null
}

/** Agentic missions: the lead's default and the task table it routes helpers through. */
export interface Routing {
  /** Optimistic edit token supplied by the engine; absent on factory/legacy inputs. */
  revision?: string
  /** Explicit account; null/absent chooses automatically within the selected CLI. */
  lead: { cli: AgentCliForRole; model: string | null; effort: Effort | null; accountId?: string | null }
  taskTypes: TaskType[]
}

/**
 * Who an agent runs as. `assinatura`: a Claude or ChatGPT login, each in its own config folder
 * (the built-in ones are the CLIs' own login on this Mac). `api`: an API key, for Claude
 * optionally on an Anthropic-compatible provider (OpenRouter, a proxy…).
 */
export type AccountKind = 'assinatura' | 'api'

export interface Account {
  /** `claude` and `codex` are the built-in accounts. */
  id: string
  cli: AgentCliForRole
  name: string
  kind: AccountKind
  builtin: boolean
  /** Claude API accounts: Anthropic-compatible base URL; null = Anthropic's own API. */
  baseUrl: string | null
  /** Default model on this account (e.g. a provider's model id); also used for the aliases. */
  model: string | null
  /** A key is stored (only its last four characters ever leave the sidecar). */
  keyHint: string | null
  /** Taken into account when Orbit picks an account by itself. */
  auto: boolean
  createdAt: number
}

/** What the CLI says about an account's login. */
export interface AccountStatus {
  accountId: string
  loggedIn: boolean | null
  /** "claude.ai", "ChatGPT", "chave de API"… */
  method: string | null
  email: string | null
  plan: string | null
  checkedAt: number | null
  busy: 'checking' | 'login' | null
  /** Terminal running the login, while it is open. */
  loginPaneId: number | null
  message: string | null
}

export interface AccountInput {
  /** Omit to create. */
  id?: string
  cli: AgentCliForRole
  name: string
  kind: AccountKind
  baseUrl?: string | null
  model?: string | null
  /** New key; omit to keep the stored one. Never sent back. */
  key?: string
  auto?: boolean
}

export const ACCOUNT_LIMITS = { accounts: 12, name: 40, key: 512, url: 300 } as const
/** Only an exhausted provider window blocks the account; headroom is not exhaustion. */
export const ACCOUNT_FULL_PERCENT = 100

/** The mission's browser: one page agents and the person look at together. */
export interface MissionBrowser {
  missionId: string
  url: string
  title: string
  loading: boolean
  /** Who moved it last: "você" or "#3". */
  lastActor: string | null
  error: string | null
}

/** Size of the page agents see (CSS pixels); the person's view is scaled from it. */
export const BROWSER_VIEWPORT = { width: 1280, height: 800 } as const

export type BrowserInput =
  | { kind: 'click'; x: number; y: number }
  | { kind: 'scroll'; x: number; y: number; dy: number }
  | { kind: 'type'; text: string }
  | { kind: 'key'; key: string }

/** Keys the person (and agents) can press in the page besides typing text. */
export const BROWSER_KEYS = ['Enter', 'Tab', 'Backspace', 'Delete', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'] as const

/** What the CLIs have installed that agents can call. */
export type CatalogKind = 'skill' | 'agent' | 'mcp'

export interface CatalogItem {
  /** `cli:kind:name` */
  id: string
  cli: AgentCliForRole
  kind: CatalogKind
  /** As the agent calls it: `oc-route`, `plugin:skill`, an MCP server name. */
  name: string
  description: string
  /** Where it comes from: "pessoal", "sistema", "plugin x", "projeto app". */
  source: string
  /** The CLI's own config already turns it off. */
  offInCli: boolean
  /** Read-only text resource. Discovery does not execute or load its instructions into an agent. */
  resource?: {
    path: string
    root: string
    sha256: string
    bytes: number
    version: string | null
    origin: 'bundled' | 'personal' | 'system' | 'project' | 'plugin'
    projectRoot: string | null
    role: string | null
    compatibility: AgentCliForRole[]
  }
}

export const catalogId = (cli: AgentCliForRole, kind: CatalogKind, name: string) => `${cli}:${kind}:${name}`

/** A file that differs from the last commit. */
export interface FileChange {
  /** Relative to its folder. */
  path: string
  /** Former path, for renames. */
  from: string | null
  kind: 'modificado' | 'novo' | 'apagado' | 'renomeado' | 'conflito'
  /** Already in the index (git add). */
  staged: boolean
  added: number | null
  removed: number | null
  /** Agents seen editing it (Claude's Edit/Write), newest last. */
  by: number[]
}

/** Git state of one workspace folder. */
export interface FolderStatus {
  folder: string
  /** False when the folder is not inside a git repository. */
  git: boolean
  branch: string | null
  ahead: number
  behind: number
  changes: FileChange[]
  error: string | null
}

export const FILES_LIMITS = { tree: 5000, read: 512 * 1024, diff: 400 * 1024 } as const

/** What the last look for a new Orbit release found. */
export interface UpdateStatus {
  repo: string
  checkedAt: number | null
  /** Tag of the latest release, if any. */
  latest: string | null
  error: string | null
}

/** The mission's board: what is planned, in progress and done. */
export type CardColumn = 'afazer' | 'fazendo' | 'feito'
export const CARD_COLUMNS: readonly CardColumn[] = ['afazer', 'fazendo', 'feito']
export const CARD_COLUMN_LABEL: Record<CardColumn, string> = { afazer: 'A fazer', fazendo: 'Fazendo', feito: 'Feito' }
export const CARD_LIMITS = { perMission: 200, title: 140, notes: 4000 } as const

export interface Card {
  id: string
  missionId: string
  /** Short number in the mission (T1, T2…) that people and agents use. */
  number: number
  title: string
  notes: string
  column: CardColumn
  /** Position inside the column, ascending. */
  order: number
  /** Agent working on it. */
  assignee: number | null
  /** "você" or "#3". */
  createdBy: string
  createdAt: number
  updatedAt: number
}

export type MissionEventKind = 'mission.created' | 'mission.ready' | 'proposal' | 'lead.changed' | 'pane.spawned' | 'pane.exited' | 'pane.waiting' | 'handoff' | 'browser' | 'budget'

export interface MissionEvent {
  id: string
  missionId: string
  kind: MissionEventKind
  at: number
  title: string
  body: string
  paneId: number | null
}

export interface Snapshot {
  workspaces: Workspace[]
  missions: Mission[]
  panes: Pane[]
  events: MissionEvent[]
  squads: Squad[]
  routing: Routing
  usageDays: UsageDay[]
  limits: AccountLimits[]
  accounts: Account[]
  cards: Card[]
  templates: MissionTemplate[]
  schedules: Schedule[]
  settings: OrbitSettings
  proposals: RoutingProposal[]
}

/** Choices that change how Orbit behaves, kept with its data. */
export type AgentToolProfile = 'orbit' | 'inherit'
export interface OrbitSettings {
  /** Claude/Codex external MCP visibility on the next opening or resume; native tools remain. */
  agentToolProfile?: AgentToolProfile
  /** When Orbit opens, bring back the agents of active missions in their conversations. */
  resumeOnStart: boolean
  /** When no keyword tells an activity's type, a small model (Claude Haiku) decides. */
  smartClassify: boolean
  /** Agents work in English among themselves and answer the person in Portuguese. */
  agentsInEnglish: boolean
}

/** What a lead may suggest changing in a row of the task table. */
export type RoutingChange = Partial<Pick<TaskType, 'cli' | 'model' | 'effort' | 'method' | 'readOnly'>>

/** A lead's suggestion to change the task table; the person accepts or refuses it. */
export interface RoutingProposal {
  /** Legacy proposals lack a base and must be proposed again before acceptance. */
  baseRevision?: string
  id: string
  missionId: string
  paneId: number
  /** The row (task type id) it changes. */
  kind: string
  change: RoutingChange
  reason: string
  status: 'pendente' | 'aceita' | 'recusada'
  createdAt: number
}

export interface SpawnPaneRequest {
  readOnly?: boolean
  requireReadOnlySandbox?: boolean
  missionId: string
  role: PaneRole
  cli: AgentCli
  model: string | null
  title: string
  /** First prompt handed to the agent when it starts. */
  task?: string | null
  /** Squad role to play; its CLI, model and brief apply. */
  squadRoleId?: string | null
  /** Task type from the routing table; its CLI, model, effort and skills apply. */
  taskTypeId?: string | null
  effort?: Effort | null
  /** Account to run as; omitted or null = the one with the most room left. */
  accountId?: string | null
  /** One of the workspace's folders to start in (default: the main one). */
  folder?: string | null
}

export type ClientMessage =
  /** Read a creation receipt without translating or starting any agent. */
  | { type: 'mission.check'; workspaceId: string; requestId: string }
  | { type: 'mission.progress'; missionId: string; requestId: string }
  | { type: 'workspace.open'; path: string }
  /** A workspace made of several folders; the first is the main one. */
  | { type: 'workspace.create'; name: string; folders: string[]; requestId?: string }
  /** Rename, replace the folder list or the instructions (new agents get them). */
  | { type: 'workspace.update'; workspaceId: string; name?: string; folders?: string[]; instructions?: string; requestId?: string }
  /** `isolation: 'worktrees'` gives every agent its own git worktree and branch. */
  | { type: 'mission.create'; requestId?: string; translationAccountId?: string; allowOriginal?: boolean; workspaceId: string; title: string; objective: string; mode: MissionMode; adaptiveLead?: boolean; squadId?: string | null; isolation?: 'worktrees' | null; lead: Omit<SpawnPaneRequest, 'missionId' | 'role'>; cards?: string[]; allowedClis?: AgentCliForRole[]; budget?: { tokens: number | null; costUsd: number | null } | null }
  /** Sets (or clears, with both null) a mission's budget. */
  | { type: 'mission.budget'; missionId: string; tokens: number | null; costUsd: number | null }
  /** The usage ledger of a month, YYYY-MM (answered to this connection). */
  | { type: 'ledger.get'; month: string }
  /** The mission's report in Markdown (answered to this connection). */
  | { type: 'report.get'; missionId: string }
  /** Writes the report to a .md file the person picked. */
  | { type: 'report.save'; missionId: string; path: string }
  | { type: 'schedule.save'; schedule: ScheduleInput }
  | { type: 'schedule.delete'; scheduleId: string }
  /** Starts the scheduled mission now (the schedule keeps its next run). */
  | { type: 'schedule.run'; scheduleId: string }
  /** Creates or replaces a mission template. */
  | { type: 'template.save'; template: MissionTemplateInput }
  | { type: 'template.delete'; templateId: string }
  | { type: 'mission.archive'; missionId: string }
  /** Deletes an agent for good: its terminal, its lines in the flow and, with `conversation`, its CLI conversation. */
  | { type: 'pane.delete'; paneId: number; conversation: boolean }
  /** Deletes a mission and everything Orbit kept about it; options reach the CLIs' conversations, the project memory and the git branches. */
  | { type: 'mission.delete'; missionId: string; conversations: boolean; memory: boolean; branches: boolean }
  /** Deletes a workspace from Orbit with all its missions, memory, templates and schedules. Its folders stay. */
  | { type: 'workspace.delete'; workspaceId: string; conversations: boolean; branches: boolean }
  /** Hands the mission's lead to another agent, with everything that happened so far. */
  | { type: 'mission.lead.change'; missionId: string; to: LeadTarget }
  /** A workspace's memory (answered to this connection). */
  | { type: 'memory.get'; workspaceId: string }
  /** Adds (no id) or changes an entry the person wrote or kept. */
  | { type: 'memory.save'; workspaceId: string; entry: { id?: string; kind: MemoryKind; text: string; pinned?: boolean } }
  | { type: 'memory.delete'; workspaceId: string; entryId: string }
  | { type: 'pane.spawn'; request: SpawnPaneRequest; requestId?: string; expiresAt?: number }
  /** A terminal view mounted: send me this pane's current screen, then its live output. */
  | { type: 'pane.attach'; paneId: number }
  /** Raw keystrokes from the terminal view. */
  | { type: 'pane.input'; paneId: number; data: string }
  /** A whole message typed elsewhere (the command bar): pasted, then submitted with Enter. */
  | { type: 'pane.submit'; paneId: number; text: string; attachments?: string[]; requestId?: string; translationAccountId?: string; allowOriginal?: boolean }
  | { type: 'attachment.add'; paneId: number; requestId: string; name: string; mime: string; data: string }
  | { type: 'pane.conversation'; paneId: number }
  | { type: 'pane.resize'; paneId: number; cols: number; rows: number }
  /** Kills the process if alive and removes the pane from the mission. */
  | { type: 'pane.close'; paneId: number }
  | { type: 'pane.rename'; paneId: number; title: string }
  /** Opens the agent again with the same settings: a new conversation, or (resume) the same one. */
  | { type: 'pane.restart'; paneId: number; resume: boolean }
  /** Another helper with the same settings, without a task. */
  | { type: 'pane.duplicate'; paneId: number }
  /** Commits, files and agents' branches of a worktree mission (answered to this connection). */
  | { type: 'git.summary'; missionId: string }
  /** Pushes the mission branch and opens its PR with gh. */
  | { type: 'git.pr.create'; missionId: string; title: string; body: string; draft: boolean }
  | { type: 'git.pr.status'; missionId: string }
  | { type: 'card.add'; missionId: string; title: string; notes?: string; column?: CardColumn; assignee?: number | null }
  | { type: 'card.update'; cardId: string; title?: string; notes?: string; assignee?: number | null }
  /** To `column`, at `index` among its cards (end when omitted). */
  | { type: 'card.move'; cardId: string; column: CardColumn; index?: number }
  | { type: 'card.delete'; cardId: string }
  /** Creates or replaces a custom squad (builtins cannot be changed). */
  | { type: 'squad.save'; squad: SquadInput }
  | { type: 'squad.delete'; squadId: string }
  | { type: 'routing.save'; routing: Routing }
  /** Look up installed versions, the latest releases and the model catalogs again. */
  | { type: 'cli.check' }
  | { type: 'cli.update'; cli: AgentCliForRole }
  /** Back to the table Orbit ships with. */
  | { type: 'routing.reset' }
  | { type: 'settings.save'; settings: OrbitSettings }
  /** Accept (apply to the table) or refuse a lead's proposal. */
  | { type: 'proposal.decide'; proposalId: string; accept: boolean }
  | { type: 'account.save'; account: AccountInput }
  | { type: 'account.delete'; accountId: string }
  /** Ask each CLI about its accounts' logins again. */
  | { type: 'account.reset'; accountId: string; requestId: string; creditId: string; confirmed: true }
  | { type: 'account.check' }
  | { type: 'limits.refresh' }
  /** Opens a terminal running the CLI's login for this account. */
  | { type: 'account.login'; accountId: string }
  /** Git status of each folder of the workspace (answered to this connection only). */
  | { type: 'files.status'; workspaceId: string; missionId?: string | null }
  | { type: 'files.tree'; workspaceId: string; folder: string; missionId?: string | null }
  | { type: 'files.diff'; workspaceId: string; folder: string; path: string; missionId?: string | null }
  | { type: 'files.read'; workspaceId: string; folder: string; path: string; missionId?: string | null }
  /** Read the installed skills, agents and MCP servers again. */
  | { type: 'catalog.scan' }
  /** Lets Orbit's agents use an item, or not. */
  | { type: 'catalog.toggle'; id: string; enabled: boolean }
  /** Opens (or moves) the mission's browser. */
  | { type: 'browser.navigate'; missionId: string; url: string }
  | { type: 'browser.history'; missionId: string; action: 'back' | 'forward' | 'reload' }
  | { type: 'browser.input'; missionId: string; input: BrowserInput }
  /** Start or stop receiving the page's frames on this connection. */
  | { type: 'browser.watch'; missionId: string; on: boolean }
  | { type: 'browser.close'; missionId: string }

export interface StartupTask {
  id: 'recovery' | 'catalog' | 'accounts' | 'clis' | 'skills'
  state: 'pending' | 'running' | 'ready' | 'error'
  message?: string
}

export type ServerMessage =
  | { type: 'mission.checked'; requestId: string; state: 'missing' | 'pending' | 'failed' | 'acked'; message: string; missionId?: string }
  | { type: 'workspace.saved'; requestId: string; workspace: Workspace }
  | { type: 'workspace.error'; requestId: string; message: string }
  | { type: 'engine.startup'; tasks: StartupTask[] }
  | { type: 'mission.progress'; requestId: string; progress: MissionProgress }
  | { type: 'mission.progress.error'; requestId: string; missionId: string; message: string }
  | { type: 'attachment.added'; requestId: string; attachment: Attachment }
  | { type: 'attachment.error'; requestId: string; message: string }
  | { type: 'account.reset.result'; requestId: string; accountId: string; outcome: string; message: string }
  | { type: 'account.reset.error'; requestId: string; message: string }
  | { type: 'pane.spawned'; requestId: string; pane: Pane }
  | { type: 'pane.spawn.error'; requestId: string; message: string }
  | { type: 'pane.submitted'; requestId: string; paneId: number; executionEpoch?: string; acceptedAt?: number }
  | { type: 'pane.submit.error'; requestId: string; message: string; pending?: boolean }
  | { type: 'mission.created'; requestId: string; mission: Mission }
  | { type: 'mission.create.error'; requestId: string; message: string; pending?: boolean }
  | { type: 'pane.conversation'; paneId: number; turns: Array<{ role: 'pessoa' | 'agente'; text: string }> }
  | { type: 'snapshot'; snapshot: Snapshot }
  /**
   * The pane's screen and scrollback, serialized at the PTY's real size. Replaying raw output at
   * another width scrambles TUIs, so views start from this and then apply `pane.data`.
   */
  | { type: 'pane.snapshot'; paneId: number; data: string; cols: number; rows: number }
  | { type: 'pane.data'; paneId: number; data: string }
  /** The PTY changed size (from any view). Views adopt it so they never draw at another width. */
  | { type: 'pane.resized'; paneId: number; cols: number; rows: number }
  | { type: 'workspace.updated'; workspace: Workspace }
  | { type: 'mission.updated'; mission: Mission }
  | { type: 'pane.updated'; pane: Pane }
  | { type: 'pane.removed'; paneId: number }
  | { type: 'event.added'; event: MissionEvent }
  | { type: 'squad.updated'; squad: Squad }
  | { type: 'squad.removed'; squadId: string }
  | { type: 'routing.updated'; routing: Routing }
  | { type: 'settings.updated'; settings: OrbitSettings }
  | { type: 'proposals'; proposals: RoutingProposal[] }
  | { type: 'memory'; workspaceId: string; entries: MemoryEntry[] }
  | { type: 'catalog'; catalog: Catalog; accounts?: Record<string, CliCatalog> }
  | { type: 'usage.day'; day: UsageDay }
  | { type: 'limits'; limits: AccountLimits[] }
  | { type: 'cli.status'; clis: CliStatus[] }
  | { type: 'accounts'; accounts: Account[] }
  | { type: 'account.status'; statuses: AccountStatus[] }
  | { type: 'files.status'; workspaceId: string; folders: FolderStatus[] }
  | { type: 'update.status'; status: UpdateStatus }
  | { type: 'report'; missionId: string; markdown: string }
  | { type: 'report.saved'; missionId: string; path: string }
  | { type: 'ledger'; month: string; entries: UsageEntry[] }
  | { type: 'schedule.updated'; schedule: Schedule }
  | { type: 'schedule.removed'; scheduleId: string }
  | { type: 'template.updated'; template: MissionTemplate }
  | { type: 'template.removed'; templateId: string }
  | { type: 'card.updated'; card: Card }
  | { type: 'card.removed'; cardId: string }
  | { type: 'git.summary'; missionId: string; summary: GitSummary }
  | { type: 'git.pr'; missionId: string; status: PrStatus }
  /** A files.* or git.* question failed (answered to the asking connection). */
  | { type: 'files.error'; message: string }
  /** Files of a folder (tracked and new, without what .gitignore hides). */
  | { type: 'files.tree'; workspaceId: string; folder: string; files: string[]; truncated: boolean }
  | { type: 'files.diff'; workspaceId: string; folder: string; path: string; diff: string; truncated: boolean }
  /** `text` is null for binary or oversized files. */
  | { type: 'files.content'; workspaceId: string; folder: string; path: string; text: string | null; size: number; reason: string | null }
  /** Installed skills, agents and MCP servers, and which ones Orbit's agents may not use. */
  | { type: 'skills'; items: CatalogItem[]; disabled: string[]; scannedAt: number | null }
  /** Which installed Chromium browser Orbit drives; null = none found. */
  | { type: 'browser.engine'; name: string | null }
  | { type: 'browser.state'; browser: MissionBrowser }
  | { type: 'browser.closed'; missionId: string }
  /** A JPEG of the page, for connections watching it. */
  | { type: 'browser.frame'; missionId: string; data: string; width: number; height: number }
  | { type: 'error'; message: string }

/** Conversation ids reach a command line too: UUIDs and similar only. */
export const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/

/** Model ids reach a shell command line, so only plain identifiers are accepted (`/` for providers' ids). */
export const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}(?:\[1m\])?$/
/** Squad and role ids. */
export const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/

export const SQUAD_LIMITS = { name: 60, description: 280, playbook: 8000, brief: 4000, roles: 8 } as const
export const WORKSPACE_LIMITS = { folders: 10, name: 60, instructions: 8000 } as const
export const TEMPLATE_LIMITS = { templates: 50, name: 60, cards: 30 } as const
export const ROUTING_LIMITS = { taskTypes: 16, name: 40, description: 200, method: 1500, skills: 6, skill: 40 } as const
