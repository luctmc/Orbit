import { InputJournal, inputFingerprint, translateCodex, UncertainTranslation, RESPONSE_LANGUAGE, type InputRecord, type Translate } from './inputLanguage.ts'
import { readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { needsDelivery, noticeText } from './deliveryQueue.ts'
import { claudeHook, claudeStatus } from './adapters/claude.ts'
import { codexRollout, freshCodexTurn } from './adapters/codex.ts'
import { geminiHook, geminiAnswer } from './adapters/gemini.ts'
import { adapterCapabilities } from './adapters/types.ts'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ATTACHMENT_LIMITS, ACCOUNT_LIMITS, BUDGET_WARN_AT, CLI_NAME, AGENT_CLIS, AGENT_INFO, CARD_COLUMNS, CARD_LIMITS, MODEL_ID, SCHEDULE_LIMITS, TEMPLATE_LIMITS, type MissionBudget, type MissionTemplate, type MissionTemplateInput, EFFORT_LABEL, EFFORTS, SESSION_ID, type Card, type CardColumn, WORKSPACE_LIMITS, effortsFor, type Account, type AccountInput, type AccountStatus, type AgentCli, type BrowserInput, type CatalogItem, type GitSummary, type HandoffStatus, type RoutingChange, type RoutingProposal, type LeadTarget, type MissionNote, type MemoryEntry, type MemoryKind, MEMORY_KINDS, MEMORY_LIMITS, type Difficulty, type AgentSeat, NOTE_LIMITS, CARD_COLUMN_LABEL, type MissionGit, type PrStatus, type Schedule, type ScheduleInput, type AgentCliForRole, type Catalog, type CliStatus, type ClientMessage, type Effort, type Mission, type MissionEvent, type MissionEventKind, type MissionMode, type Pane, type ServerMessage, type SpawnPaneRequest, type Squad, type TaskType } from '@orbit/protocol'
import { Attachments } from './attachments.ts'
import { BrowserHost, findBrowser, type BrowserEngine } from './browser.ts'
import { AccountFiles, blankAccountStatus, keyHint, normalizeAccount, pickAccount, userConfigDir, validKey } from './accounts.ts'
import { bundledCatalog, codexDisabledMcp, gateTool, missionSkills, readSkill, scanCatalog, type SkillPolicy } from './skills.ts'
import { SkillSessions } from './skillSessions.ts'
import { projectDesignContext, selectDesignSkills, designSkillDelivery } from './designSkills.ts'
import { automaticTaskSeat, designWork } from './taskPolicy.ts'
import { accountRooms, BALANCE_GAP, chooseAccount, classifyTask, assessDifficulty, cliLoad, LIVE_WEIGHT, seatForDifficulty, decisionReceipt, type AccountRoom } from './maestro.ts'
import { dueSchedules, nextRun, normalizeWhen } from './schedules.ts'
import { fileDiff, folderStatus, folderTree, readFile } from './files.ts'
import { Updates } from './updates.ts'
import { missionReport } from './report.ts'
import { addWorktree, BRANCH, commitsAhead, deleteBranches, forceRemoveWorktree, dirtyFiles, filesChanged, hasRemote, pushBranch, removeWorktree, repoInfo } from './git.ts'
import { slugify } from './squads.ts'
import { normalizeRouting, routingRevision } from './routing.ts'
import { decideTaskType, decisionPrompt, DECIDER_MODEL } from './decider.ts'
import { performance } from 'node:perf_hooks'
import { composeHarness, harnessNote, selectHarnessCandidate } from './harness.ts'
import { harnessAccounts, harnessCandidates } from './harnessEligibility.ts'
import { HarnessMeasurements, type AuxiliaryObservation } from './measurements.ts'
import { CodexUsageReader, type ExecutionIdentity } from './adapters/codexUsage.ts'
import { ClaudeUsageReader } from './adapters/claudeUsage.ts'
import type { MissionProgress } from '@orbit/protocol'
import { CLAUDE_USAGE_COMMAND, parseClaudeUsage, usageText } from './claudeUsage.ts'
import { LimitRefreshGate, parseCodexAccountLimits } from './accountLimits.ts'
import { codexHome, findCodexRolloutById, codexSessionId, findCodexRollout, fromCodexRollout, fromClaudeStatus, readTail, type UsageReport } from './usage.ts'
import { contractHash, normalizedAcceptance } from './activityLedger.ts'
import { blankStatus, inspectCli, latestVersion, loadCatalog, loginShellRunner, runUpdate, type Run } from './clis.ts'
import { hookCommand, removeAgentFiles, writeAgentFiles } from './agentFiles.ts'
import { shellQuote, type AgentLaunch, type PaneCommand } from './command.ts'
import { claudeTranscript, claudeTurns, codexTurns, deleteClaudeConversation, tailTurns, turnsMarkdown, type Turn } from './transcripts.ts'
import { statusFromHook, type HookPayload } from './hooks.ts'
import { PaneManager, type PaneSnapshot } from './panes.ts'
import { acceptanceNote, commandToolsNote, crewRole, projectMemoryNote, HANDOFF_NUDGE, instructionsNote, leadRole, objectiveTask, workspaceNote, worktreeNote } from './prompts.ts'
import { normalizeSquad } from './squads.ts'
import { dayKey, Store } from './store.ts'
import { deliveryPending } from './deliveryLedger.ts'
import { buildContextPack, ContextLibrary, type ContextSection } from './contextPack.ts'
import { assertNoDependencyCycle, copyRoots } from './scheduler.ts'
import { sourceRevision, validateReview } from './verification.ts'
import type { ActivityRecord, ActivityResult, ExecutionPolicy, VerificationInput, DecisionReceipt, ResultInspection } from '@orbit/protocol'

const CLIS: readonly AgentCli[] = [...AGENT_CLIS, 'shell']
const MODES: readonly MissionMode[] = ['livre', 'squad', 'agentica']
const CLI_LABEL = CLI_NAME
const HOOK_SCRIPT = process.env.ORBIT_HOOK_SCRIPT ?? fileURLToPath(new URL('../hooks/report.mjs', import.meta.url))
/** Lives next to the hook script, in dev and in the app bundle. */
const STATUS_SCRIPT = join(dirname(HOOK_SCRIPT), 'statusline.mjs')
const ORBIT_CLI_SCRIPT = join(dirname(HOOK_SCRIPT), 'orbit-cli.mjs')
/** How often live Codex agents' session files are read for usage. */
const CODEX_POLL_MS = 5000
/** How often the accounts' room is read again when no agent reports it. */
const USAGE_WATCH_MS = 30_000
const CODEX_LIMITS_SCRIPT = join(dirname(HOOK_SCRIPT), 'read-codex-limits.mjs')
/** Time for a CLI to stop its turn after Esc before new orders are typed. */
const INTERRUPT_SETTLE_MS = 700
const HANDOFF_STATUSES: readonly HandoffStatus[] = ['done', 'blocked', 'progress']
const HANDOFF_LABEL: Record<HandoffStatus, string> = { done: 'concluído', blocked: 'bloqueado', progress: 'em andamento' }
/** Messages typed into a terminal go as one line. */
const oneLine = (text: string) => text.replace(/\s*\n\s*/g, ' / ').trim()
/** Sub-helpers a helper may have open at once (they cannot open their own). */
const MAX_CHILDREN = 2
// Claude Code's and Gemini CLI's file-editing tools.
const EDIT_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'write_file', 'replace']
const RESUME_NOTE = 'O Orbit foi reaberto. Continue a tarefa de onde parou e, ao terminar, entregue com handoff_submit.'

export interface HelperRequest {
  title: string; task: string; cli?: AgentCli; model: string | null; effort?: Effort | null
  squadRoleId?: string | null; taskTypeId?: string | null; accept?: string[]; folder?: string | null
  difficulty?: Difficulty | null; retryReason?: string; activityId?: string
  dependsOn?: string[]
  requireReadOnlySandbox?: boolean
  readOnly?: boolean
}

export type Broadcast = (message: ServerMessage) => void

export interface CoreOptions {
  /** Tests inject an offline translator; production always uses isolated Codex. */
  translate?: Translate
  /** Opt-in local benchmark measurement; never calls a model or stores message content. */
  measurements?: HarnessMeasurements
  /** Benchmark-only control: include optional context eagerly, within the same byte budget. */
  benchmarkEagerContext?: boolean
  dataDir: string
  shell: string
  broadcast: Broadcast
  /** Tests replace the real agent CLIs with a stand-in command. */
  agentCommand?: (launch: AgentLaunch, shell: string) => PaneCommand
  /** Runs probes and updates of the agent CLIs; tests replace it. Default: the login shell. */
  run?: Run
  /** Browser the missions' pages open in; default: the first installed Chromium browser. */
  browser?: BrowserEngine | null
}

/** Orbit's domain logic: UI messages, MCP tool calls and hook reports all land here. */
export class OrbitCore {
  private readonly inputJournal: InputJournal
  private readonly translate: Translate
  private readonly inputInFlight = new Map<string, Promise<void>>()
  private readonly measurements?: HarnessMeasurements
  private readonly benchmarkEagerContext: boolean
  private readonly harnessMode: 'live' | 'simulated'
  private readonly claudeUsage = new ClaudeUsageReader()
  private readonly codexUsage = new CodexUsageReader()
  readonly store: Store
  private readonly panes: PaneManager
  private readonly broadcast: Broadcast
  private readonly dataDir: string
  private readonly attachments: Attachments
  private readonly contexts: ContextLibrary
  private readonly skillSessions: SkillSessions
  /** Per-pane secret used by that agent's MCP client and hooks. Lives only in memory. */
  private readonly paneTokens = new Map<string, number>()
  private readonly sendingNotices = new Set<string>()
  private readonly deliveryTimer: NodeJS.Timeout
  private endpoint = ''
  private readonly delegating = new Map<string, Promise<{ pane: Pane; receipt: string[] }>>()
  private readonly run: Run
  /** Models and effort levels per CLI; null until first loaded. */
  private catalog: Catalog | null = null
  private readonly clis = new Map<AgentCliForRole, CliStatus>(AGENT_CLIS.map((cli) => [cli, blankStatus(cli)]))
  /** Codex agent → its session file, once found. */
  private readonly codexRollouts = new Map<number, string>()
  /** The last Codex turn already handled per agent, so each turn end is seen once. */
  /** Codex helpers already asked once to deliver since their last assignment. */
  private readonly nudged = new Set<number>()
  /** Acceptance criteria each helper must answer when it delivers done. */
  private readonly acceptance = new Map<number, string[]>()
  /** Helpers whose task type only reads (Claude's edit tools are refused). */
  private readonly readOnly = new Set<number>()
  private codexTimer: NodeJS.Timeout | null = null
  private usageTimer: NodeJS.Timeout | null = null
  private readonly limitRefreshes = new LimitRefreshGate()
  private readonly accountFiles: AccountFiles
  /** Login state per account, from the CLIs; kept in memory and asked again on start. */
  private readonly accountStatus = new Map<string, AccountStatus>()
  /** Terminals running a CLI login → the account they log in. Not part of any mission. */
  private readonly loginPanes = new Map<number, string>()
  /** One headless page per mission, shared by its agents and the person. */
  readonly browser: BrowserHost
  /** New releases of Orbit itself, read with the person's gh login. */
  readonly updates: Updates
  /** Installed skills, subagents and MCP servers; empty until the first scan. */
  private readonly designContexts = new Map<string, string>()
  private catalogItems: CatalogItem[] = []
  private catalogScannedAt: number | null = null
  private scanning: Promise<void> | null = null
  /** Agents limited to their role's skills. */
  private readonly skillPolicies = new Map<number, SkillPolicy>()
  /** Files Claude agents edited (real path → who, in order), from their PostToolUse hooks. */
  private readonly touched = new Map<string, Array<{ paneId: number; missionId: string }>>()

  constructor({ dataDir, shell, broadcast, agentCommand, run, browser, measurements, benchmarkEagerContext, translate }: CoreOptions) {
    this.harnessMode = agentCommand ? 'simulated' : 'live'
    this.measurements = measurements
    this.benchmarkEagerContext = benchmarkEagerContext === true
    this.broadcast = broadcast
    this.run = run ?? loginShellRunner(shell)
    this.dataDir = dataDir
    this.inputJournal = new InputJournal(dataDir)
    this.translate = translate ?? translateCodex
    this.attachments = new Attachments(dataDir)
    this.contexts = new ContextLibrary(join(dataDir, 'context'))
    this.skillSessions = new SkillSessions(join(dataDir, 'skill-sessions'))
    this.store = new Store(dataDir)
    this.accountFiles = new AccountFiles(dataDir)
    this.updates = new Updates(this.run, join(dataDir, 'updates'))
    this.browser = new BrowserHost(join(dataDir, 'browser'), browser === undefined ? findBrowser() : browser)
    this.browser.on('state', (state) => this.broadcast({ type: 'browser.state', browser: state }))
    this.browser.on('closed', (missionId) => this.broadcast({ type: 'browser.closed', missionId }))
    this.browser.on('frame', (missionId, data, width, height) => this.broadcast({ type: 'browser.frame', missionId, data, width, height }))
    removeAgentFiles(join(dataDir, 'panes'))
    this.panes = new PaneManager(shell, agentCommand)
    this.panes.on('terminated', (id, epoch) => this.store.releaseExecution(id, epoch))
    this.panes.on('receiptError', () => { /* Keep the persisted notice pending for a later dispatch. */ })
    this.deliveryTimer = setInterval(() => this.dispatchDeliveries(), 2000)
    this.deliveryTimer.unref()
    this.panes.on('data', (paneId, data) => {
      const epoch = this.store.pane(paneId)?.executionEpoch
      if (epoch) this.measurements?.output(epoch)
      this.broadcast({ type: 'pane.data', paneId, data })
    })
    this.panes.on('resized', (paneId, cols, rows) => this.broadcast({ type: 'pane.resized', paneId, cols, rows }))
    this.panes.on('status', (pane, previous) => {
      if (this.loginPanes.has(pane.id)) return
      this.syncPane(pane)
      if (pane.status === 'waiting' && previous !== 'waiting') {
        this.event(pane.missionId, 'pane.waiting', `#${pane.id} espera você`, pane.attention ?? 'O agente precisa de você.', pane.id)
      }
    })
    this.panes.on('exit', (pane) => {
      const login = this.loginPanes.get(pane.id)
      if (login) {
        // The terminal stays on screen (it may show an error) until the person closes it.
        void this.checkAccount(login)
        return
      }
      if (!this.store.pane(pane.id)) return // closed by the user
      // Publish the process state before applying its final counters. Otherwise this stale exit
      // snapshot would overwrite the newer usage baseline that applyReport just persisted.
      this.syncPane(pane)
      // Last word from a Codex session before it is gone.
      if (pane.cli === 'claude') this.applyClaudeConsumption(pane)
      const rollout = this.codexRollouts.get(pane.id)
      if (rollout) {
        try {
          this.applyReport(pane.id, codexRollout(readTail(rollout)).report, 'rollout')
        } catch {
          // nothing more to count
        }
      }
      this.event(pane.missionId, 'pane.exited', `#${pane.id} encerrou`, `Processo terminou com código ${pane.exitCode ?? '?'}.`, pane.id)
      if (this.owesHandoff(pane)) this.tellAssigner(pane, `[Orbit] #${pane.id} (${pane.title}) encerrou sem entregar o retorno (código ${pane.exitCode ?? '?'}). Retome com agent_resume ou abra outro ajudante.`)
    })
  }

  /** Base URL agents use to reach this sidecar; known once the server listens. */
  setEndpoint(endpoint: string): void {
    this.endpoint = endpoint
  }

  /** What a newly connected client needs; terminal contents come per view via `pane.attach`. */
  welcome(): ServerMessage[] {
    const messages: ServerMessage[] = [
      { type: 'snapshot', snapshot: this.store.snapshot() },
      { type: 'cli.status', clis: [...this.clis.values()] },
      { type: 'account.status', statuses: this.statuses() },
      this.skillsMessage(),
      { type: 'update.status', status: this.updates.status },
      { type: 'browser.engine', name: this.browser.engine?.name ?? null },
      ...this.browser.states().map((browser): ServerMessage => ({ type: 'browser.state', browser })),
    ]
    if (this.catalog) messages.push({ type: 'catalog', catalog: this.catalog })
    return messages
  }

  /** Model catalogs, read from the CLIs in the background; agents can open before it arrives. */
  async refreshCatalog(): Promise<void> {
    this.catalog = await loadCatalog(this.run)
    this.broadcast({ type: 'catalog', catalog: this.catalog })
  }

  private setCli(cli: AgentCliForRole, patch: Partial<CliStatus>): void {
    this.clis.set(cli, { ...this.clis.get(cli)!, ...patch })
    this.broadcast({ type: 'cli.status', clis: [...this.clis.values()] })
  }

  /** Which CLIs are installed and their versions, without asking the network (at startup, for the pickers). */
  async inspectClis(): Promise<void> {
    await Promise.all(AGENT_CLIS.map(async (cli) => {
      if (this.clis.get(cli)!.busy || this.clis.get(cli)!.checkedAt !== null) return
      try {
        const found = await inspectCli(this.run, cli)
        this.setCli(cli, { ...found, checkedAt: Date.now(), ok: found.installed, message: found.installed ? null : 'Não encontrado no PATH do seu shell.' })
      } catch {
        // the full check (Ajustes › Agentes e CLIs) says what went wrong
      }
    }))
  }

  /** Installed version, install method and latest release of each CLI, plus the catalogs. */
  async checkClis(): Promise<void> {
    await Promise.all(AGENT_CLIS.map(async (cli) => {
      if (this.clis.get(cli)!.busy) return
      this.setCli(cli, { busy: 'checking' })
      try {
        const [found, latest] = await Promise.all([inspectCli(this.run, cli), latestVersion(this.run, cli)])
        this.setCli(cli, { ...found, latest, checkedAt: Date.now(), busy: null, ok: found.installed, message: found.installed ? null : 'Não encontrado no PATH do seu shell.' })
      } catch (error) {
        this.setCli(cli, { busy: null, ok: false, message: error instanceof Error ? error.message : String(error) })
      }
    }))
    await this.refreshCatalog()
  }

  /** Updates one CLI the way it was installed, then checks it again. */
  async updateCli(cli: AgentCliForRole): Promise<void> {
    const status = this.clis.get(cli)!
    if (status.busy) return
    this.setCli(cli, { busy: 'updating', message: null, ok: null })
    const { ok, output } = await runUpdate(this.run, status)
    const found = await inspectCli(this.run, cli)
    const works = ok && found.installed && found.version !== null
    this.setCli(cli, { ...found, busy: null, ok: works, checkedAt: Date.now(), message: works ? `Atualizado para ${found.version}.` : output || 'A atualização falhou.' })
    if (cli !== 'claude') await this.refreshCatalog()
  }

  // ---- git: a worktree and branch per agent ----

  /** The working copy an agent of a worktree mission is in (its cwd without the subfolder). */
  private worktreeOf(pane: Pane, git: MissionGit): string {
    return git.sub && pane.cwd.endsWith(`/${git.sub}`) ? pane.cwd.slice(0, -(git.sub.length + 1)) : pane.cwd
  }

  /** Commits and files of the mission branch against its base, and every agent's branch. */
  gitSummary(missionId: string): GitSummary {
    const git = this.store.mission(missionId)?.git
    if (!git) throw new Error('Esta missão não usa um branch por agente')
    const agents = this.missionPanes(missionId)
      .filter((p) => p.branch && p.branch !== git.branch)
      .map((p) => ({ paneId: p.id, title: p.title, branch: p.branch!, ahead: safe(() => commitsAhead(git.repo, git.branch, p.branch!).length, 0), dirty: safe(() => dirtyFiles(this.worktreeOf(p, git)), []) }))
    return {
      base: git.base,
      branch: git.branch,
      commits: safe(() => commitsAhead(git.repo, git.base, git.branch), []),
      files: safe(() => filesChanged(git.repo, git.base, git.branch), []),
      agents,
      remote: safe(() => hasRemote(git.repo), false),
    }
  }

  /** Pushes the mission branch and opens the PR with the person's gh. */
  private async createPr(missionId: string, rawTitle: string, body: string, draft: boolean): Promise<PrStatus> {
    const mission = this.store.mission(missionId)
    const git = mission?.git
    if (!mission || !git) throw new Error('Esta missão não usa um branch por agente')
    if (git.pr) return this.prStatus(missionId)
    const title = requireText(rawTitle, 'título do PR', 200)
    if (!hasRemote(git.repo)) throw new Error('O repositório não tem um remoto "origin" para enviar o branch')
    if (commitsAhead(git.repo, git.base, git.branch).length === 0) throw new Error(`O branch ${git.branch} ainda não tem commits além de ${git.base}`)
    pushBranch(git.leadPath, git.branch)
    const bodyFile = join(this.dataDir, 'worktrees', missionId, 'pr-body.md')
    writeFileSync(bodyFile, String(body ?? '').slice(0, 60_000), { mode: 0o600 })
    const created = await this.run(`cd ${shellQuote(git.leadPath)} && gh pr create --base ${shellQuote(git.base)} --head ${shellQuote(git.branch)} --title ${shellQuote(title)} --body-file ${shellQuote(bodyFile)}${draft ? ' --draft' : ''}`, 120_000)
    const url = /https:\/\/\S+\/pull\/(\d+)/.exec(created.stdout)
    if (created.code !== 0 || !url) throw new Error((created.stderr || created.stdout).trim().slice(-400) || 'O gh não criou o PR')
    const updated = this.store.updateMission(missionId, { git: { ...git, pr: { number: Number(url[1]), url: url[0] } } })
    if (updated) this.broadcast({ type: 'mission.updated', mission: updated })
    this.event(missionId, 'handoff', `PR #${url[1]} aberto`, url[0], null)
    return this.prStatus(missionId)
  }

  /** The PR's state and CI checks, from gh. */
  async prStatus(missionId: string): Promise<PrStatus> {
    const git = this.store.mission(missionId)?.git
    if (!git?.pr) throw new Error('Esta missão ainda não tem PR')
    const result = await this.run(`cd ${shellQuote(git.leadPath)} && gh pr view ${git.pr.number} --json number,url,state,isDraft,statusCheckRollup`, 60_000)
    if (result.code !== 0) throw new Error((result.stderr || result.stdout).trim().slice(-300) || 'O gh não respondeu')
    return parsePrStatus(result.stdout)
  }

  /** On archive: working copies with nothing uncommitted go away; branches (and their commits) stay. */
  private cleanWorktrees(missionId: string): void {
    const mission = this.store.mission(missionId)
    const git = mission?.git
    if (!git) return
    const root = join(this.dataDir, 'worktrees', missionId)
    const kept: string[] = []
    for (const entry of safe(() => readdirSync(root), [] as string[])) {
      const path = join(root, entry)
      if (!statSync(path).isDirectory()) continue
      if (!safe(() => removeWorktree(git.repo, path), false)) kept.push(entry === 'lider' ? 'do líder' : `de #${entry}`)
    }
    if (kept.length) this.event(missionId, 'pane.exited', 'Cópias mantidas', `Ficaram mudanças sem commit nas cópias ${kept.join(', ')}, em ${root}. Os branches continuam no repositório.`, null)
  }

  // ---- missions ----

  /** A new mission: its branch (if each agent gets one), the template's cards, and its lead at work. */
  private startMission(message: Omit<Extract<ClientMessage, { type: 'mission.create' }>, 'type'>, schedule?: Schedule): Mission {
    const startedBy = schedule?.name
    if (!this.store.workspace(message.workspaceId)) throw new Error('Workspace desconhecido')
    if (!MODES.includes(message.mode)) throw new Error(`Modo inválido: ${message.mode}`)
    const title = requireText(message.title, 'título', 120)
    const squad = message.mode === 'squad' ? this.store.squad(message.squadId ?? '') : undefined
    if (message.mode === 'squad' && !squad) throw new Error('Escolha um squad para a missão')
    const workspace = this.store.workspace(message.workspaceId)!
    // Each agent in its own worktree: the mission branch starts from the main folder's branch.
    let git: ((id: string) => MissionGit) | undefined
    if (message.isolation === 'worktrees') {
      const info = repoInfo(workspace.path)
      if (!info.branch) throw new Error('A pasta principal está fora de um branch (HEAD solto); troque para um branch antes')
      const branch = `orbit/${slugify(title).slice(0, 40)}-${randomBytes(2).toString('hex')}`
      if (!BRANCH.test(branch)) throw new Error(`Não consegui montar um nome de branch para "${title}"`)
      git = (id) => ({ repo: info.top, sub: info.sub, base: info.branch!, branch, leadPath: join(this.dataDir, 'worktrees', id, 'lider'), pr: null })
    }
    const mission = this.store.createMission({
      workspaceId: message.workspaceId,
      title,
      objective: (message.objective ?? '').trim().slice(0, 4000),
      mode: message.mode,
      squadId: squad?.id ?? null,
      allowedClis: allowedClis(message.allowedClis),
      budget: freshBudget(budgetLimits(message.budget)),
    }, git, schedule?.id ?? null)
    this.broadcast({ type: 'mission.updated', mission })
    const opening = squad ? `Squad ${squad.name}. ${mission.objective || 'Sem objetivo descrito.'}` : mission.objective || 'Sem objetivo descrito.'
    this.event(mission.id, 'mission.created', startedBy ? `Missão agendada iniciada (${startedBy})` : 'Missão iniciada', opening, null)
    // Cards from a template are on the board before the lead looks at it.
    for (const card of templateCards(message.cards)) this.addCard(mission.id, 'modelo', { title: card })
    // Agentic and squad leads start working on the objective right away.
    const task = mission.mode !== 'livre' && mission.objective ? `${objectiveTask(mission)}\n\n${RESPONSE_LANGUAGE}` : null
    const assessment = assessDifficulty(mission.title, mission.objective)
    const automatic = message.adaptiveLead === true && mission.mode === 'agentica'
    const lead = automatic ? { ...message.lead, ...this.store.routing().lead, accountId: null } : message.lead
    this.spawn({ ...lead, missionId: mission.id, role: 'lead', task }, automatic ? { tier: { difficulty: assessment.difficulty, by: assessment.why } } : {})
    return mission
  }

  // ---- budget ----

  /** Warns at 80% of the budget; at 100% interrupts the mission's agents (once). */
  private checkBudget(mission: Mission): Mission {
    const budget = mission.budget
    if (!budget || budget.exceeded) return mission
    const use = budgetUse(mission, budget)
    if (use >= 1) {
      const live = this.missionPanes(mission.id).filter((p) => p.cli !== 'shell' && this.panes.isAlive(p.id))
      // Esc stops the turn in Claude Code and in Codex; the hook then refuses Claude's next tools.
      for (const pane of live) {
        this.panes.write(pane.id, '\x1b')
        // An interrupted turn fires no Stop hook: say it stopped.
        this.panes.report(pane.id, 'idle', null)
      }
      this.event(mission.id, 'budget', 'Orçamento esgotado', `A missão chegou a ${budgetText(mission, budget)}. ${live.length ? `${live.length} ${live.length === 1 ? 'agente foi interrompido' : 'agentes foram interrompidos'}; ` : ''}aumente o orçamento para continuar.`, null)
      return this.store.updateMission(mission.id, { budget: { ...budget, warned: true, exceeded: true } }) ?? mission
    }
    if (use >= BUDGET_WARN_AT && !budget.warned) {
      this.event(mission.id, 'budget', `Orçamento em ${Math.floor(use * 100)}%`, `A missão está em ${budgetText(mission, budget)}.`, null)
      return this.store.updateMission(mission.id, { budget: { ...budget, warned: true } }) ?? mission
    }
    return mission
  }

  private budgetBlocks(missionId: string): boolean {
    return this.store.mission(missionId)?.budget?.exceeded === true
  }

  // ---- scheduled missions ----

  private normalizeSchedule(input: ScheduleInput, now: number): Schedule {
    const existing = typeof input?.id === 'string' ? this.store.schedule(input.id) : undefined
    if (!existing && this.store.schedules().length >= SCHEDULE_LIMITS.schedules) throw new Error(`No máximo ${SCHEDULE_LIMITS.schedules} agendamentos`)
    if (!this.store.template(input.templateId)) throw new Error('Escolha um modelo de missão que exista')
    if (!this.store.workspace(input.workspaceId)) throw new Error('Escolha um workspace que exista')
    const when = normalizeWhen(input.when, now)
    const enabled = input.enabled !== false
    return {
      id: existing?.id ?? randomBytes(6).toString('hex'),
      name: requireText(input.name, 'nome do agendamento', SCHEDULE_LIMITS.name),
      templateId: input.templateId,
      workspaceId: input.workspaceId,
      when,
      enabled,
      skipIfRunning: input.skipIfRunning !== false,
      translationAccountId: input.translationAccountId || undefined,
      allowOriginal: input.allowOriginal === true,
      nextRunAt: enabled ? nextRun(when, now) : null,
      lastRunAt: existing?.lastRunAt ?? null,
      lastMissionId: existing?.lastMissionId ?? null,
      lastResult: existing?.lastResult ?? null,
      createdAt: existing?.createdAt ?? now,
    }
  }

  /** Starts a schedule's mission from its template; returns what happened. */
  private readonly scheduleInFlight = new Map<string, Promise<Schedule>>()

  private runSchedule(schedule: Schedule, now: number, manual: boolean): Promise<Schedule> {
    const active = this.scheduleInFlight.get(schedule.id)
    if (active) return active
    const run = this.executeSchedule(schedule, now, manual)
    this.scheduleInFlight.set(schedule.id, run)
    void run.finally(() => this.scheduleInFlight.delete(schedule.id))
    return run
  }

  private async executeSchedule(schedule: Schedule, now: number, manual: boolean): Promise<Schedule> {
    let result: string
    let missionId = schedule.lastMissionId
    let uncertain = false
    const previous = schedule.lastMissionId ? this.missionPanes(schedule.lastMissionId).filter((p) => this.panes.isAlive(p.id) && p.status !== 'idle') : []
    const template = this.store.template(schedule.templateId)
    if (!template) result = 'Não rodou: o modelo foi apagado'
    else if (!manual && schedule.skipIfRunning && previous.length > 0) result = `Pulada: a missão anterior ainda tem ${previous.length} ${previous.length === 1 ? 'agente trabalhando' : 'agentes trabalhando'}`
    else {
      try {
        const stamp = new Date(now).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
        // The due timestamp is stable across restarts; uncertain runs never translate/spawn twice.
        const scope = `schedule-${schedule.id}`
        const requestId = manual ? `manual-${randomBytes(12).toString('hex')}` : `due-${schedule.nextRunAt ?? now}`
        const record = await this.inputOnce(scope, requestId, inputFingerprint({ schedule, template }), template.objective, async record => {
          record.english = template.lead.cli === 'shell' ? template.objective : await this.englishInput(template.objective, schedule.translationAccountId, schedule.allowOriginal)
          if (record.english.length > 4000) throw new Error('O objetivo traduzido excedeu 4.000 caracteres. Reduza o objetivo do modelo; nenhum agente foi iniciado.')
          if (this.stopping || JSON.stringify(this.store.schedule(schedule.id)) !== JSON.stringify(schedule)) throw new Error('O agendamento mudou ou o Orbit está encerrando; nenhuma missão foi iniciada.')
          record.state = 'submitting'; this.inputJournal.save(scope, requestId, record)
          const mission = this.startMission({
            workspaceId: schedule.workspaceId,
            title: `${template.title} · ${stamp}`.slice(0, 120),
            objective: record.english,
            mode: template.mode,
            squadId: template.squadId,
            isolation: template.isolation,
            lead: { cli: template.lead.cli, model: template.lead.model, effort: template.lead.effort, title: '' },
            cards: template.cards,
            budget: template.budget,
          }, schedule)
          record.missionId = mission.id; record.state = 'acked'
          this.inputJournal.save(scope, requestId, record)
        })
        if (record.state !== 'acked' || !record.missionId) {
          uncertain = record.state !== 'failed'
          throw new Error(record.error ?? 'Resultado incerto após interrupção. Confira as missões; agendamento pausado para evitar duplicação.')
        }
        missionId = record.missionId
        result = manual ? 'Missão iniciada (na mão)' : 'Missão iniciada'
      } catch (error) {
        result = `Não rodou: ${error instanceof Error ? error.message : String(error)}`
      }
    }
    // A run Orbit missed while closed happens once; the schedule then moves on from now.
    const next = manual ? schedule.nextRunAt : schedule.when.kind === 'once' ? null : nextRun(schedule.when, now)
    if (JSON.stringify(this.store.schedule(schedule.id)) !== JSON.stringify(schedule)) return this.store.schedule(schedule.id) ?? schedule
    const updated: Schedule = { ...schedule, lastRunAt: now, lastMissionId: missionId, lastResult: uncertain ? `${result} Agendamento pausado; confira antes de reativar.` : result, nextRunAt: uncertain ? null : next, enabled: uncertain ? false : next === null && schedule.when.kind === 'once' ? false : schedule.enabled }
    this.store.saveSchedule(updated)
    this.broadcast({ type: 'schedule.updated', schedule: updated })
    return updated
  }

  private scheduleTimer: NodeJS.Timeout | null = null

  /** Checks the schedules now (runs missed while Orbit was closed) and every 30 s from then on. */
  startScheduler(): void {
    if (this.scheduleTimer) return
    this.tickSchedules()
    this.scheduleTimer = setInterval(() => this.tickSchedules(), 30_000)
    this.scheduleTimer.unref()
  }

  /** Runs every schedule that is due (tests pass their own clock). */
  tickSchedules(now = Date.now()): void {
    for (const schedule of dueSchedules(this.store.schedules(), now)) void this.runSchedule(schedule, now, false)
  }

  // ---- mission report ----

  /** Everything the mission did, as Markdown: setup, numbers, agents, board, deliveries, code. */
  async report(missionId: string): Promise<string> {
    const mission = this.store.mission(missionId)
    if (!mission) throw new Error('Missão desconhecida')
    const workspace = this.store.workspace(mission.workspaceId)
    const git = mission.git ? safe(() => this.gitSummary(missionId), null) : null
    const pr = mission.git?.pr ? await this.prStatus(missionId).catch(() => null) : null
    const by = (absolute: string) => [...new Set((this.touched.get(realPath(absolute)) ?? []).filter((t) => t.missionId === missionId).map((t) => t.paneId))]
    const folders = !mission.git && workspace ? await Promise.all(workspace.folders.map((f) => folderStatus(f, by).catch(() => null))) : []
    const accountNames = Object.fromEntries(this.store.accounts().filter((a) => !a.builtin).map((a) => [a.id, a.name]))
    return missionReport({
      mission,
      workspace,
      squad: this.missionSquad(missionId),
      panes: this.missionPanes(missionId).sort((a, b) => (a.role === b.role ? a.id - b.id : a.role === 'lead' ? -1 : 1)),
      accountNames,
      cards: this.store.cards(missionId),
      events: this.missionEvents(missionId),
      git,
      pr,
      folders: folders.filter((f): f is NonNullable<typeof f> => f !== null),
    })
  }

  // ---- mission templates ----

  private normalizeTemplate(input: MissionTemplateInput): MissionTemplate {
    const existing = typeof input?.id === 'string' ? this.store.template(input.id) : undefined
    if (!existing && this.store.templateCount() >= TEMPLATE_LIMITS.templates) throw new Error(`No máximo ${TEMPLATE_LIMITS.templates} modelos`)
    if (!MODES.includes(input.mode)) throw new Error(`Modo inválido: ${String(input.mode)}`)
    const workspaceId = input.workspaceId && this.store.workspace(input.workspaceId) ? input.workspaceId : null
    const squadId = input.mode === 'squad' ? input.squadId ?? null : null
    if (input.mode === 'squad' && (!squadId || !this.store.squad(squadId))) throw new Error('Escolha um squad que exista para o modelo')
    const lead = input.lead ?? { cli: 'claude', model: null, effort: null }
    if (!CLIS.includes(lead.cli)) throw new Error(`Agente inválido: ${String(lead.cli)}`)
    if (lead.model && !MODEL_ID.test(lead.model)) throw new Error(`Modelo inválido: ${lead.model}`)
    if (lead.effort && !EFFORTS.includes(lead.effort)) throw new Error(`Esforço inválido: ${lead.effort}`)
    const now = Date.now()
    return {
      id: existing?.id ?? randomBytes(6).toString('hex'),
      name: requireText(input.name, 'nome do modelo', TEMPLATE_LIMITS.name),
      workspaceId,
      title: requireText(input.title, 'título', 120),
      objective: typeof input.objective === 'string' ? input.objective.trim().slice(0, 4000) : '',
      mode: input.mode,
      squadId,
      isolation: input.isolation === 'worktrees' ? 'worktrees' : null,
      lead: { cli: lead.cli, model: lead.model || null, effort: lead.cli === 'shell' ? null : lead.effort ?? null },
      cards: templateCards(input.cards),
      budget: budgetLimits(input.budget),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
  }

  // ---- the mission's board ----

  private existingCard(id: string): Card {
    const card = typeof id === 'string' ? this.store.card(id) : undefined
    if (!card) throw new Error('Cartão não encontrado')
    return card
  }

  /** The assignee must be an agent of the card's mission. */
  private assignee(missionId: string, value: unknown): number | null {
    if (value === null || value === undefined) return null
    const pane = typeof value === 'number' ? this.store.pane(value) : undefined
    if (!pane || pane.missionId !== missionId) throw new Error(`#${String(value)} não é um agente desta missão`)
    return pane.id
  }

  private addCard(missionId: string, by: string, input: { title?: unknown; notes?: unknown; column?: unknown; assignee?: unknown }): Card {
    this.activeMission(missionId)
    if (this.store.cards(missionId).length >= CARD_LIMITS.perMission) throw new Error(`No máximo ${CARD_LIMITS.perMission} cartões por missão`)
    const column = input.column === undefined ? 'afazer' : cardColumn(input.column)
    const card = this.store.addCard({
      missionId,
      title: requireText(input.title, 'título do cartão', CARD_LIMITS.title),
      notes: typeof input.notes === 'string' ? input.notes.trim().slice(0, CARD_LIMITS.notes) : '',
      column,
      assignee: this.assignee(missionId, input.assignee),
      createdBy: by,
    })
    this.broadcast({ type: 'card.updated', card })
    return card
  }

  private updateCard(card: Card, input: { title?: unknown; notes?: unknown; assignee?: unknown }): Card {
    const patch: Partial<Pick<Card, 'title' | 'notes' | 'assignee'>> = {}
    if (input.title !== undefined) patch.title = requireText(input.title, 'título do cartão', CARD_LIMITS.title)
    if (input.notes !== undefined) patch.notes = typeof input.notes === 'string' ? input.notes.trim().slice(0, CARD_LIMITS.notes) : ''
    if (input.assignee !== undefined) patch.assignee = this.assignee(card.missionId, input.assignee)
    const updated = this.store.updateCard(card.id, patch)!
    this.broadcast({ type: 'card.updated', card: updated })
    return updated
  }

  private moveCard(card: Card, column: unknown, index?: unknown): Card {
    const to = cardColumn(column)
    for (const moved of this.store.moveCard(card.id, to, typeof index === 'number' && Number.isFinite(index) ? index : undefined)) this.broadcast({ type: 'card.updated', card: moved })
    return this.store.card(card.id)!
  }

  /** What agents see of the board. */
  boardList(caller: Pane) {
    return this.store.cards(caller.missionId).map(cardView)
  }

  boardAdd(caller: Pane, input: { title: string; notes?: string; column?: CardColumn; assignee?: number | null }) {
    return cardView(this.addCard(caller.missionId, `#${caller.id}`, input))
  }

  /** Change a card by its number (T3 = 3): text, assignee ("me" = the caller) and column. */
  boardUpdate(caller: Pane, number: number, input: { title?: string; notes?: string; assignee?: number | 'eu' | null; column?: CardColumn }) {
    const card = this.store.cardByNumber(caller.missionId, number)
    if (!card) throw new Error(`Não há o cartão T${number} nesta missão`)
    let current = this.updateCard(card, { title: input.title, notes: input.notes, assignee: input.assignee === 'eu' ? caller.id : input.assignee })
    if (input.column && input.column !== current.column) current = this.moveCard(current, input.column)
    return cardView(current)
  }

  // ---- deleting for good ----

  /** Deletes an agent's conversation from its CLI (Claude Code, Codex); the others keep theirs. */
  private forgetConversation(pane: Pane): void {
    if (!pane.sessionId) return
    const account = pane.accountId ? this.store.account(pane.accountId) : undefined
    const sessionId = pane.sessionId
    const drop = () => {
      if (pane.cli === 'claude') safe(() => deleteClaudeConversation((account && this.accountFiles.configDir(account)) ?? userConfigDir('claude'), sessionId), false)
      if (pane.cli === 'codex') {
        const file = this.codexRollouts.get(pane.id) ?? safe(() => findCodexRolloutById((account && this.accountFiles.configDir(account)) ?? codexHome(), sessionId), null)
        if (file) safe(() => rmSync(file, { force: true }), undefined)
      }
    }
    drop()
    // A CLI that was just stopped may still flush its last lines: once more, a moment later.
    setTimeout(drop, 1500).unref()
  }

  /** Deletes an agent for good: process, files, its lines in the flow and, if asked, its conversation. */
  private deletePane(paneId: number, conversation: boolean): void {
    const pane = this.store.pane(paneId)
    if (!pane) throw new Error(`#${paneId} não existe`)
    this.closePane(pane.id)
    if (conversation) this.forgetConversation(pane)
    this.store.forgetPane(pane.id)
    this.broadcast({ type: 'snapshot', snapshot: this.store.snapshot() })
  }

  /**
   * Deletes a mission for good: its agents, copies (worktrees), flow, board, proposals and usage
   * lines; if asked, the agents' conversations, what it left in the project memory and its
   * branches. The workspace's folders are never touched.
   */
  private deleteMission(missionId: string, options: { conversations: boolean; memory: boolean; branches: boolean }, quiet = false): void {
    const mission = this.store.mission(missionId)
    if (!mission) throw new Error('Missão não encontrada')
    const panes = this.store.snapshot().panes.filter((p) => p.missionId === missionId)
    for (const pane of panes) this.closePane(pane.id)
    void this.browser.close(missionId)
    if (mission.git) {
      const root = join(this.dataDir, 'worktrees', missionId)
      for (const entry of safe(() => readdirSync(root), [] as string[])) safe(() => forceRemoveWorktree(mission.git!.repo, join(root, entry)), undefined)
      safe(() => rmSync(root, { recursive: true, force: true }), undefined)
      if (options.branches) safe(() => deleteBranches(mission.git!.repo, mission.git!.branch), [])
    }
    if (options.conversations) for (const pane of panes) this.forgetConversation(pane)
    this.store.forgetMission(missionId, options.memory)
    this.attachments.remove(missionId)
    this.inputJournal.remove(missionId)
    this.contexts.remove(missionId)
    if (options.memory) this.broadcast({ type: 'memory', workspaceId: mission.workspaceId, entries: this.store.memory(mission.workspaceId) })
    if (!quiet) this.broadcast({ type: 'snapshot', snapshot: this.store.snapshot() })
  }

  /** Deletes a workspace from Orbit with all its missions, memory, templates and schedules. */
  private deleteWorkspace(workspaceId: string, options: { conversations: boolean; branches: boolean }): void {
    if (!this.store.workspace(workspaceId)) throw new Error('Workspace não encontrado')
    for (const mission of this.store.snapshot().missions.filter((m) => m.workspaceId === workspaceId)) this.deleteMission(mission.id, { ...options, memory: false }, true)
    this.store.forgetWorkspace(workspaceId)
    this.broadcast({ type: 'snapshot', snapshot: this.store.snapshot() })
  }

  // ---- project memory: what a workspace remembers across missions ----

  /** Adds an entry to a workspace's memory and tells every window. */
  private remember(workspaceId: string, input: { kind: MemoryKind; text: string; source: MemoryEntry['source']; pinned?: boolean; id?: string }): MemoryEntry[] {
    const text = input.text.trim().slice(0, MEMORY_LIMITS.text)
    if (!text) throw new Error('A anotação está vazia')
    if (!MEMORY_KINDS.includes(input.kind)) throw new Error('Tipo de anotação inválido')
    const entries = this.store.saveMemory(workspaceId, { id: input.id ?? randomBytes(6).toString('hex'), kind: input.kind, text, at: Date.now(), source: input.source, pinned: input.pinned === true })
    this.broadcast({ type: 'memory', workspaceId, entries })
    return entries
  }

  /** A lead writes down something every future mission of this project should know. */
  addProjectNote(caller: Pane, kind: MemoryKind, text: string): number {
    if (caller.role !== 'lead') throw new Error('Só o líder anota na memória do projeto')
    const mission = this.store.mission(caller.missionId)
    if (!mission) throw new Error('Missão inexistente')
    if (kind === 'missao') throw new Error('O resumo da missão entra sozinho quando ela fica pronta; use decisao, fato ou licao')
    return this.remember(mission.workspaceId, { kind, text, source: { missionId: mission.id, missionTitle: mission.title, paneId: caller.id } }).length
  }

  /**
   * The project's memory for a lead, within a budget: pinned entries first, then decisions,
   * facts and lessons (newest first), then the latest missions' summaries.
   */
  projectMemory(workspaceId: string, budget = 6000, scope: 'all' | 'required' | 'optional' = 'all'): string {
    const entries = this.store.memory(workspaceId).filter(e => scope === 'all' || ((e.pinned || !e.source) === (scope === 'required')))
    if (entries.length === 0) return ''
    const label: Record<MemoryKind, string> = { decisao: 'decision', fato: 'fact', licao: 'lesson', missao: 'mission' }
    const line = (e: MemoryEntry) => `- [${label[e.kind]}${e.pinned ? ', pinned' : ''}${e.source ? ` · ${e.source.missionTitle}` : ' · the user'} · ${new Date(e.at).toISOString().slice(0, 10)}] ${oneLine(e.text)}`
    const newest = (a: MemoryEntry, b: MemoryEntry) => b.at - a.at
    const ordered = [
      ...entries.filter((e) => e.pinned).sort(newest),
      ...entries.filter((e) => !e.pinned && e.kind !== 'missao').sort(newest),
      ...entries.filter((e) => !e.pinned && e.kind === 'missao').sort(newest).slice(0, Number.isFinite(budget) ? 8 : Infinity),
    ]
    const out: string[] = []
    let used = 0
    for (const e of ordered) {
      const text = line(e)
      if (used + text.length > budget) break
      out.push(text)
      used += text.length
    }
    const left = entries.length - out.length
    return `${out.join('\n')}${left > 0 ? `\n(${left} more in project_memory)` : ''}`
  }

  // ---- leadership: notes, the briefing, and handing the lead to another agent ----

  /** A lead writes a decision down; every lead after it reads it in the briefing. */
  addNote(caller: Pane, text: string): MissionNote[] {
    if (caller.role !== 'lead') throw new Error('Só o líder anota decisões da missão')
    const mission = this.store.mission(caller.missionId)
    if (!mission) throw new Error('Missão inexistente')
    const clean = text.trim().slice(0, NOTE_LIMITS.text)
    if (!clean) throw new Error('A nota está vazia')
    const notes = [...mission.notes, { at: Date.now(), paneId: caller.id, text: clean }].slice(-NOTE_LIMITS.notes)
    const updated = this.store.updateMission(mission.id, { notes })
    if (updated) this.broadcast({ type: 'mission.updated', mission: updated })
    return notes
  }

  /** The end of an agent's own conversation, read from the CLI's files (Claude, Codex). */
  private conversationOf(pane: Pane): Turn[] {
    if (!pane.sessionId) return []
    const account = pane.accountId ? this.store.account(pane.accountId) : undefined
    if (pane.cli === 'claude') {
      const dir = (account && this.accountFiles.configDir(account)) ?? userConfigDir('claude')
      const file = claudeTranscript(dir, pane.sessionId)
      return file ? tailTurns(file, claudeTurns) : []
    }
    if (pane.cli === 'codex') {
      const home = (account && this.accountFiles.configDir(account)) ?? codexHome()
      const file = this.codexRollouts.get(pane.id) ?? findCodexRolloutById(home, pane.sessionId)
      return file ? tailTurns(file, codexTurns) : []
    }
    return []
  }

  /**
   * Everything a lead needs to carry on a mission it did not start: objective, notes, board,
   * helpers and what they owe, handoffs, branches, the previous lead's last words and the flow.
   * Kept under a size the first prompt takes; `mission_briefing` returns it at any time.
   */
  missionBriefing(missionId: string, previous?: { pane: Pane; turns: Turn[] }): string {
    const mission = this.store.mission(missionId)
    if (!mission) throw new Error('Missão inexistente')
    const panes = this.missionPanes(missionId)
    const lead = panes.find((p) => p.role === 'lead')
    const who = (p: Pane) => [CLI_LABEL[p.cli], p.model].filter(Boolean).join(' · ')
    const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text)
    const out: string[] = [`# Mission briefing: "${mission.title}"`]
    if (previous) out.push(`You take over as lead from #${previous.pane.id} (${who(previous.pane)}). Read this briefing and any relevant context_read references before acting; reuse delivered work.`)
    out.push(`## Objective (written by the user)\n\n${mission.objective || '(no objective written: ask the user)'}`)
    const facts = [
      `mode ${mission.mode}`,
      mission.mode === 'agentica' && `CLIs allowed: ${mission.allowedClis.map((c) => CLI_LABEL[c]).join(', ')}`,
      mission.readyAt && `declared ready: ${oneLine(mission.readySummary ?? '').slice(0, 300)}`,
      mission.budget && `budget: ${mission.usage.total.toLocaleString('en-US')} tokens used${mission.budget.tokens ? ` of ${mission.budget.tokens.toLocaleString('en-US')}` : ''}${mission.budget.exceeded ? ' (used up)' : ''}`,
    ].filter(Boolean)
    out.push(`## State\n\n${facts.map((f) => `- ${f}`).join('\n')}`)
    const workspace = this.missionWorkspace(missionId)
    if (workspace?.instructions) out.push(`## User instructions\n\n${workspace.instructions}`)
    const requiredMemory = this.projectMemory(mission.workspaceId, Infinity, 'required')
    if (requiredMemory) out.push(`## Required project memory (pinned or written by the user)\n\n${requiredMemory}`)
    const memory = this.projectMemory(mission.workspaceId, Infinity, 'optional')
    if (memory) out.push(`## Project memory (from earlier missions and the user)\n\n${memory}`)
    if (mission.notes.length) out.push(`## Decisions the leads wrote down\n\n${mission.notes.map((n) => `- (#${n.paneId}) ${n.text}`).join('\n')}`)
    const cards = this.store.cards(missionId)
    if (cards.length) out.push(`## Board\n\n${cards.map((c) => `- [${c.column}] T${c.number} ${c.title}${c.assignee !== null ? ` (#${c.assignee})` : ''}`).join('\n')}`)
    const pending = this.pendingDeliveries(missionId)
    if (pending.length) out.push(`## Required results still pending (including closed terminals)\n\n${pending.map(d => `- ${d.id}: #${d.paneId} ${d.title} — ${d.status}${d.summary ? `; ${d.summary}` : ''}${d.acceptance.length ? `\n  Acceptance: ${d.acceptance.join('; ')}` : ''}`).join('\n')}`)
    const crew = panes.filter((p) => p.role === 'crew' && p.id !== lead?.id)
    if (crew.length) {
      // Whoever worked for the previous lead now works for the reader of this briefing.
      const owner = (id: number) => (previous && id === previous.pane.id ? `you (it was working for #${id})` : `#${id}`)
      const state = (p: Pane) => p.handoffStatus === null ? (p.assignedBy !== null ? `owes a result to ${owner(p.assignedBy)}` : 'no task from the lead') : p.handoffStatus === 'progress' ? 'in progress' : `delivered (${p.handoffStatus})`
      out.push(`## Helpers\n\n${crew.map((p) => `- #${p.id} ${p.title} — ${who(p)}${p.taskType ? `, ${p.taskType}` : ''}; ${p.status}; ${state(p)}`).join('\n')}`)
    }
    const archived = this.store.delegations(missionId).filter((d) => !panes.some((p) => p.id === d.pane.id))
    if (archived.length) out.push(`## Closed activities (reuse completed results)\n\n${archived.map((d) => `- #${d.pane.id} ${d.pane.title}: ${d.pane.handoffStatus ?? 'stopped without delivery'}${d.result ? `; ${d.result.summary}; evidence: ${d.result.evidence}` : ''}`).join('\n')}`)
    const history = this.store.activityHistory(missionId)
    const results = history.results.slice(-8)
    if (results.length) out.push(`## Results received (submitted evidence, not independent validation)\n\n${results.map(r => `### ${r.id} (${r.status})\n${[r.summary, r.evidence && `Evidence: ${r.evidence}`, r.details].filter(Boolean).join('\n\n')}`).join('\n\n')}`)
    else {
      const handoffs = this.missionEvents(missionId, 'handoff').slice(-8)
      if (handoffs.length) out.push(`## Results received\n\n${handoffs.map((e) => `### ${e.title}\n${clip(e.body, 1800)}`).join('\n\n')}`)
    }
    if (mission.git) {
      const summary = safe(() => this.gitSummary(missionId), null)
      if (summary) out.push(`## Branches\n\nMission on branch ${summary.branch} (base ${summary.base}), ${summary.commits.length} commit(s).${summary.agents.length ? `\n${summary.agents.map((a) => `- #${a.paneId} ${a.branch}: ${a.ahead} commit(s) to integrate, ${a.dirty.length} uncommitted file(s)`).join('\n')}` : ''}`)
    }
    if (previous?.turns.length) out.push(`## End of the previous lead's conversation (#${previous.pane.id})\n\n${turnsMarkdown(previous.turns, Infinity, Infinity)}`)
    const flow = this.missionEvents(missionId).filter((e) => e.kind !== 'handoff').slice(-25)
    if (flow.length) out.push(`## Recent flow\n\n${flow.map((e) => `- ${new Date(e.at).toISOString().slice(5, 16).replace('T', ' ')} ${e.title}`).join('\n')}`)
    out.push('## How to carry on\n\nHelpers that owe a result now deliver it to you. Write important decisions down with mission_note. Submitted results are not independently validated. Pending required results block mission_ready. Retrieve referenced details with context_read; handoff_list supports resultId and after cursors. To read this briefing again, call mission_briefing.')
    const optional = /^(## Project memory|## Board|## Closed activities|## Results received|## End of the previous|## Recent flow)/
    return this.contextPack(missionId, out.map((text, i) => ({ id: `briefing-${i}`, text, required: !optional.test(text), maxBytes: 3000 })), 18_000).text
  }

  private contextPack(missionId: string, sections: ContextSection[], budget: number) {
    return buildContextPack(this.benchmarkEagerContext ? sections.map(s => ({ ...s, maxBytes: Infinity })) : sections, budget, section => this.contexts.put(missionId, section))
  }

  readContext(caller: Pane, sha256: string, offset?: number, limit?: number) {
    this.assertCurrent(caller)
    const result = this.contexts.read(caller.missionId, sha256, offset, limit)
    this.measurements?.bytes(caller.executionEpoch!, 'contextReadBytes', result.text)
    return result
  }

  /**
   * Hands the lead to another agent without losing anything: a new agent (any CLI, model,
   * effort) or a helper already in the mission. The new lead gets the briefing; helpers who owe
   * the old lead now owe the new one; the old lead closes.
   */
  async changeLead(missionId: string, to: LeadTarget): Promise<Pane> {
    const mission = this.activeMission(missionId)
    const old = this.missionPanes(missionId).find((p) => p.role === 'lead')
    const previous = old ? { pane: old, turns: this.conversationOf(old) } : undefined
    let lead: Pane
    if (to.kind === 'promote') {
      const helper = this.store.pane(to.paneId)
      if (!helper || helper.missionId !== missionId || helper.role !== 'crew') throw new Error('Escolha um ajudante desta missão')
      if (helper.cli === 'shell' || !this.panes.isAlive(helper.id)) throw new Error(`#${helper.id} não é um agente rodando`)
      if (mission.mode !== 'livre' && !this.store.executionPolicy(helper.id)?.readOnly) throw new Error('Este ajudante é um writer. Abra um líder novo: promover o papel não altera o sandbox do processo existente.')
      if (mission.git && helper.branch !== mission.git.branch) throw new Error('Numa missão com um branch por agente, o líder trabalha no branch da missão: troque por um agente novo')
      this.panes.setSeat(helper.id, { role: 'lead', assignedBy: null })
      lead = this.store.pane(helper.id) ?? helper
    } else {
      if (!AGENT_CLIS.includes(to.cli)) throw new Error('Agente inválido')
      const briefing = this.missionBriefing(missionId, previous)
      lead = this.spawn({ missionId, role: 'lead', cli: to.cli, model: to.model, effort: to.effort, accountId: to.accountId, title: 'Líder', task: briefing }, { opened: (id) => `#${id} assumiu a liderança` })
    }
    // Who owed the old lead owes the new one; the old lead's conversation stays in its CLI.
    for (const p of this.missionPanes(missionId)) if (old && p.assignedBy === old.id && p.id !== lead.id) this.panes.setSeat(p.id, { assignedBy: lead.id })
    if (old) this.store.reassignDeliveries(missionId, old.id, lead.id)
    if (old) this.closePane(old.id)
    const from = old ? `#${old.id} (${[CLI_LABEL[old.cli], old.model].filter(Boolean).join(' · ')})` : 'ninguém'
    this.event(missionId, 'lead.changed', `Liderança: ${from} → #${lead.id}`, `${[CLI_LABEL[lead.cli], lead.model].filter(Boolean).join(' · ')} assumiu com o dossiê da missão${previous?.turns.length ? ` e o fim da conversa de #${previous.pane.id}` : ''}.`, lead.id)
    if (to.kind === 'promote') {
      this.submitTo(lead.id, `[Orbit] You are now the lead of this mission, taking over from ${from}. First of all, call mission_briefing from "orbit" and read the whole briefing: objective, decisions, board, helpers, results and the end of the previous lead's conversation. From now on you orchestrate: delegate with agent_spawn, do not execute, and results come to you. Answer the user in Brazilian Portuguese.`)
    }
    this.dispatchDeliveries(missionId)
    return this.store.pane(lead.id) ?? lead
  }

  // ---- updates ----

  /** The manifest the updater plugin asks for; null = nothing newer published. */
  async updateManifest(base: string): Promise<Record<string, unknown> | null> {
    try {
      return await this.updates.manifest(base)
    } finally {
      this.broadcast({ type: 'update.status', status: this.updates.status })
    }
  }

  // ---- files and changes ----

  /** Answers the asking connection about a workspace's folders: git status, tree, diffs, contents. */
  private async files(message: Extract<ClientMessage, { type: `files.${string}` }>, reply: (message: ServerMessage) => void): Promise<void> {
    const workspace = this.store.workspace(message.workspaceId)
    if (!workspace) throw new Error('Workspace desconhecido')
    // A mission with a branch per agent is looked at in the agents' copies, not the person's checkout.
    const mission = message.missionId ? this.store.mission(message.missionId) : undefined
    const copies = mission?.git ? [...new Set(this.missionPanes(mission.id).filter((p) => p.branch).sort((a, b) => (a.role === 'lead' ? -1 : b.role === 'lead' ? 1 : a.id - b.id)).map((p) => p.cwd))].filter(isDirectory) : []
    const folders = copies.length ? [...copies, ...workspace.folders.slice(1)] : workspace.folders
    if (message.type === 'files.status') {
      const missionId = message.missionId ?? null
      const by = (absolute: string) => {
        const seen = this.touched.get(realPath(absolute)) ?? []
        return [...new Set(seen.filter((t) => !missionId || t.missionId === missionId).map((t) => t.paneId))]
      }
      const statuses = await Promise.all(folders.map((folder) => folderStatus(folder, by).catch((error) => ({
        folder, git: false, branch: null, ahead: 0, behind: 0, changes: [], error: error instanceof Error ? error.message : String(error),
      }))))
      reply({ type: 'files.status', workspaceId: workspace.id, folders: statuses })
      return
    }
    if (!folders.includes(message.folder)) throw new Error('Essa pasta não é do workspace')
    if (message.type === 'files.tree') {
      reply({ type: 'files.tree', workspaceId: workspace.id, folder: message.folder, ...(await folderTree(message.folder)) })
    } else if (message.type === 'files.diff') {
      reply({ type: 'files.diff', workspaceId: workspace.id, folder: message.folder, path: message.path, ...(await fileDiff(message.folder, message.path)) })
    } else {
      reply({ type: 'files.content', workspaceId: workspace.id, folder: message.folder, path: message.path, ...readFile(message.folder, message.path) })
    }
  }

  /** Remembers which agent edited a file (Claude's Edit, Write, MultiEdit, NotebookEdit). */
  private noteEdit(pane: Pane, payload: HookPayload): void {
    if (payload.hook_event_name !== 'PostToolUse' || !['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(payload.tool_name ?? '')) return
    const input = (payload.tool_input ?? {}) as { file_path?: unknown; notebook_path?: unknown }
    const path = typeof input.file_path === 'string' ? input.file_path : typeof input.notebook_path === 'string' ? input.notebook_path : null
    if (!path || !path.startsWith('/')) return
    const key = realPath(path)
    const list = (this.touched.get(key) ?? []).filter((t) => t.paneId !== pane.id)
    list.push({ paneId: pane.id, missionId: pane.missionId })
    this.touched.set(key, list.slice(-6))
    if (this.touched.size > 5000) this.touched.delete(this.touched.keys().next().value!)
  }

  // ---- skills, subagents and MCP servers ----

  private skillsMessage(): ServerMessage {
    return { type: 'skills', items: this.catalogItems, disabled: this.store.disabledCatalog(), scannedAt: this.catalogScannedAt }
  }

  /** Reads what the CLIs have installed (personal, plugins and the workspaces' projects). */
  scanSkills(): Promise<void> {
    this.scanning ??= (async () => {
      try {
        const folders = [...new Set(this.store.snapshot().workspaces.flatMap((w) => w.folders))]
        this.catalogItems = await scanCatalog({ claudeDir: userConfigDir('claude'), codexDir: userConfigDir('codex'), folders, run: this.run })
        this.catalogScannedAt = Date.now()
        this.broadcast(this.skillsMessage())
      } finally {
        this.scanning = null
      }
    })()
    return this.scanning
  }

  /** What Orbit's agents are told about skills: what is switched off, and their role's own list. */
  private skillNote(cli: AgentCli, policy: SkillPolicy | undefined): string {
    if (cli === 'shell') return ''
    const off = this.store.disabledCatalog().filter((id) => id.startsWith(`${cli}:skill:`) || id.startsWith(`${cli}:agent:`))
    const names = off.map((id) => id.split(':').slice(2).join(':'))
    const lines: string[] = []
    if (policy?.only) lines.push(policy.only.length ? `In this role use only these skills: ${policy.only.join(', ')}.` : 'In this role do not use skills.')
    if (names.length) lines.push(`Switched off in Orbit (do not use): ${names.join(', ')}.`)
    lines.push('Use skill_catalog for eligible metadata and selected packages, then skill_load with the exact id and sha256 when relevant. Selection does not load instructions. Loading serves text; it does not prove compliance. Native CLI skill visibility filtering is unverified; Orbit enforces its resource tools separately.')
    return `${lines.join('\n')}\n\n`
  }

  private eligibleSkills(caller: Pane) {
    if (caller.cli === 'shell') return []
    const items = [...bundledCatalog(), ...this.catalogItems.filter(i => i.resource?.origin !== 'bundled')]
    return missionSkills(items, caller.cli, this.missionWorkspace(caller.missionId)?.folders ?? [], new Set(this.store.disabledCatalog()), this.skillPolicies.get(caller.id))
      .sort((a, b) => a.id.localeCompare(b.id))
  }

  skillCatalog(caller: Pane, cursor?: string, limit = 15) {
    this.assertCurrent(caller)
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new Error('Limite de catálogo inválido')
    const items = this.eligibleSkills(caller)
    const revision = createHash('sha256').update(JSON.stringify([caller.missionId, caller.id, caller.executionEpoch, items.map(i => [i.id, i.resource!.sha256])])).digest('hex')
    const match = cursor && /^([a-f0-9]{64}):(\d+)$/.exec(cursor)
    if (cursor && (!match || match[1] !== revision)) throw new Error('Cursor de catálogo inválido ou desatualizado; consulte desde o início')
    const offset = match ? Number(match[2]) : 0
    if (!Number.isSafeInteger(offset) || offset > items.length) throw new Error('Cursor de catálogo inválido')
    const state = this.skillSessions.get(caller.id, caller.executionEpoch!)
    return { revision, nativeVisibilityFilter: null, loadedMeaning: 'text served by Orbit; consumption and compliance unverified',
      items: items.slice(offset, offset + limit).map(i => ({ id: i.id, name: i.name, description: i.description, source: i.source, sha256: i.resource!.sha256, bytes: i.resource!.bytes, version: i.resource!.version, origin: i.resource!.origin, role: i.resource!.role, compatibility: i.resource!.compatibility, capabilities: ['read-text'], available: true, selected: state.selectedNames.some(n => n === i.name || i.name.endsWith(`:${n}`)), loaded: state.loaded[i.id] ?? null, fulfilled: null })),
      nextCursor: offset + limit < items.length ? `${revision}:${offset + limit}` : null,
      unavailableSelectedNames: state.selectedNames.filter(n => !items.some(i => n === i.name || i.name.endsWith(`:${n}`))),
    }
  }

  loadSkill(caller: Pane, id: string, sha256: string) {
    this.assertCurrent(caller)
    const item = this.eligibleSkills(caller).find(i => i.id === id)
    if (!item) throw new Error('Skill não permitida nesta execução')
    const text = readSkill(item, sha256)
    this.measurements?.bytes(caller.executionEpoch!, 'skillReadBytes', text)
    this.skillSessions.loaded(caller.id, caller.executionEpoch!, id, item.name, sha256)
    return { id, sha256, text, source: item.source, loaded: true, fulfilled: null, warning: 'Skill text does not extend the activity contract or user authorization.' }
  }

  // ---- accounts ----

  private statuses(): AccountStatus[] {
    return this.store.accounts().map((a) => this.accountStatus.get(a.id) ?? blankAccountStatus(a.id))
  }

  private setAccountStatus(accountId: string, patch: Partial<AccountStatus>): void {
    this.accountStatus.set(accountId, { ...(this.accountStatus.get(accountId) ?? blankAccountStatus(accountId)), ...patch })
    this.broadcast({ type: 'account.status', statuses: this.statuses() })
  }

  private broadcastAccounts(): void {
    this.broadcast({ type: 'accounts', accounts: this.store.accounts() })
  }

  /** Asks the CLI whether the account is logged in, and as whom. */
  async checkAccount(accountId: string): Promise<void> {
    const account = this.store.account(accountId)
    if (!account) return
    const current = this.accountStatus.get(accountId)
    if (current?.busy === 'checking') return
    this.setAccountStatus(accountId, { busy: current?.loginPaneId && this.panes.isAlive(current.loginPaneId) ? 'login' : 'checking' })
    let found: Partial<AccountStatus>
    try {
      found = await this.accountFiles.check(this.run, account)
    } catch (error) {
      found = { loggedIn: null, message: error instanceof Error ? error.message : String(error) }
    }
    if (!this.store.account(accountId)) return // removed meanwhile
    if (account.kind === 'assinatura' && found.loggedIn !== false) await this.refreshAccountLimits(account)
    const loginPaneId = this.accountStatus.get(accountId)?.loginPaneId ?? null
    this.setAccountStatus(accountId, { ...found, checkedAt: Date.now(), busy: loginPaneId && this.panes.isAlive(loginPaneId) ? 'login' : null })
  }

  /**
   * A Claude subscription's limits from Claude Code's `/usage`, run headless: a local command
   * (no model call, no cost), so the maestro knows its room even with no Claude agent open.
   */
  private async readClaudeLimits(account: Account): Promise<boolean> {
    const { code, stdout } = await this.run(`${this.accountFiles.envPrefix(account)}${CLAUDE_USAGE_COMMAND}`, 30_000).catch(() => ({ code: 1, stdout: '' }))
    const text = code === 0 ? usageText(stdout) : null
    const usage = text ? parseClaudeUsage(text) : null
    if (!usage || !this.store.account(account.id) || this.stopping) return false
    const known = this.store.limits().find((l) => l.accountId === account.id)
    const now = Date.now()
    this.broadcast({ type: 'limits', limits: this.store.setLimits({ accountId: account.id, cli: 'claude', fiveHour: usage.fiveHour, weekly: usage.weekly, plan: known?.plan ?? null, updatedAt: now, checkedAt: now, source: 'provider', refreshError: null }) })
    return true
  }

  /** Current provider quotas, including consumption outside Orbit. No model turns are started. */
  startUsageWatch(): void {
    if (this.usageTimer) return
    this.usageTimer = setInterval(() => {
      void this.refreshLimits()
    }, USAGE_WATCH_MS)
    this.usageTimer.unref()
  }

  private async readCodexLimits(account: Account): Promise<boolean> {
    const result = await this.run(`${this.accountFiles.envPrefix(account)}${shellQuote(process.execPath)} ${shellQuote(CODEX_LIMITS_SCRIPT)}`, 12000).catch(() => null)
    if (!result || result.code !== 0 || this.stopping || !this.store.account(account.id)) return false
    let limits
    try { limits = parseCodexAccountLimits(JSON.parse(result.stdout)) } catch { return false }
    if (!limits) return false
    this.broadcast({ type: 'limits', limits: this.store.setLimits({ ...limits, accountId: account.id }) })
    return true
  }

  /** Explicit free promotional reset only; no purchase/plan/credential operation is exposed. */
  private async resetAccount(message: Extract<ClientMessage, { type: 'account.reset' }>, reply: (m: ServerMessage) => void): Promise<void> {
    try {
      const account = this.store.account(message.accountId)
      if (!account || account.cli !== 'codex' || account.kind !== 'assinatura' || message.confirmed !== true) throw new Error('Reset direto disponível apenas para benefício gratuito de uma assinatura Codex confirmada')
      if (!/^[a-f0-9-]{36}$/.test(message.requestId) || typeof message.creditId !== 'string' || message.creditId.length > 256) throw new Error('Pedido de reset inválido')
      const known = this.store.limits().find(l => l.accountId === account.id)
      const credit = known?.resetCredits?.credits?.find(c => c.id === message.creditId)
      if (!credit || (credit.expiresAt !== null && credit.expiresAt <= Date.now())) throw new Error('Benefício não confirmado ou expirado; atualize os limites e confira o painel oficial')
      const result = await this.run(`${this.accountFiles.envPrefix(account)}${shellQuote(process.execPath)} ${shellQuote(CODEX_LIMITS_SCRIPT)} --reset-credit ${shellQuote(message.requestId)} ${shellQuote(message.creditId)}`, 12000)
      if (result.code !== 0) throw new Error('O provedor não confirmou o reset. Confira os limites; uma repetição usa o mesmo pedido.')
      const { outcome } = JSON.parse(result.stdout)
      const labels: Record<string, string> = { reset: 'Benefício gratuito aplicado pelo provedor.', nothingToReset: 'Os limites não precisavam de reset; benefício preservado.', noCredit: 'Nenhum benefício disponível nesta conta.', alreadyRedeemed: 'Este benefício já foi utilizado.' }
      if (!labels[outcome]) throw new Error('Resposta de reset desconhecida; confira o painel oficial')
      await this.readCodexLimits(account)
      reply({ type: 'account.reset.result', accountId: account.id, requestId: message.requestId, outcome, message: labels[outcome]! })
    } catch (error) {
      reply({ type: 'account.reset.error', requestId: message.requestId, message: error instanceof Error ? error.message : String(error) })
    }
  }

  private refreshAccountLimits(account: Account): Promise<void> {
    if (this.stopping || account.kind !== 'assinatura' || !['claude', 'codex'].includes(account.cli)) return Promise.resolve()
    return this.limitRefreshes.run(account.id, async () => {
      const ok = account.cli === 'claude' ? await this.readClaudeLimits(account) : await this.readCodexLimits(account)
      if (!ok && !this.stopping && this.store.account(account.id)) {
        const known = this.store.limits().find(l => l.accountId === account.id)
        this.broadcast({ type: 'limits', limits: this.store.setLimits({ ...(known ?? { accountId: account.id, cli: account.cli, fiveHour: null, weekly: null, plan: null, updatedAt: 0 }), checkedAt: Date.now(), refreshError: 'Não foi possível atualizar os limites. Uma nova tentativa será feita automaticamente.' }) })
      }
      return ok
    })
  }

  async refreshLimits(): Promise<void> {
    await Promise.all(this.store.accounts().filter(a => this.accountStatus.get(a.id)?.loggedIn !== false).map(a => this.refreshAccountLimits(a)))
  }

  async checkAccounts(): Promise<void> {
    await Promise.all(this.store.accounts().map((a) => this.checkAccount(a.id)))
  }

  private async saveAccount(input: AccountInput): Promise<void> {
    const existing = input.id ? this.store.account(input.id) : undefined
    if (input.id && !existing) throw new Error('Conta desconhecida')
    if (existing?.builtin) {
      // Built-in accounts are the CLIs' own login: only automatic use can change.
      if (typeof input.auto === 'boolean') this.store.setBuiltinAuto(existing.id, input.auto)
      this.broadcastAccounts()
      return
    }
    if (!existing && this.store.accounts().length >= ACCOUNT_LIMITS.accounts) throw new Error(`No máximo ${ACCOUNT_LIMITS.accounts} contas`)
    const base = normalizeAccount(input, existing, existing?.id ?? randomBytes(6).toString('hex'))
    const key = input.key === undefined || input.key === '' ? null : validKey(input.key)
    if (base.kind === 'api' && !key && !existing?.keyHint) throw new Error('Cole a chave de API da conta')
    const account: Account = { ...base, keyHint: key ? keyHint(key) : existing?.keyHint ?? null }
    this.accountFiles.prepare(account)
    if (key) this.accountFiles.saveKey(account, key)
    this.store.saveAccount(account)
    this.broadcastAccounts()
    if (key && account.cli === 'codex') {
      // Codex keeps its own copy of the key, in the account's folder.
      this.setAccountStatus(account.id, { busy: 'checking' })
      const { ok, message } = await this.accountFiles.codexKeyLogin(this.run, account)
      this.setAccountStatus(account.id, { busy: null, message: ok ? null : message })
    }
    await this.checkAccount(account.id)
  }

  private async deleteAccount(accountId: string): Promise<void> {
    const account = this.store.account(accountId)
    if (!account) return
    if (account.builtin) throw new Error('As contas deste Mac não podem ser removidas; desligue o uso automático')
    const login = this.accountStatus.get(accountId)?.loginPaneId
    if (login) this.closePane(login)
    this.store.deleteAccount(accountId)
    this.accountStatus.delete(accountId)
    this.broadcastAccounts()
    this.broadcast({ type: 'limits', limits: this.store.limits() })
    this.broadcast({ type: 'account.status', statuses: this.statuses() })
    try {
      await this.accountFiles.logout(this.run, account)
    } finally {
      this.accountFiles.remove(account)
    }
  }

  /** A terminal running the CLI's own login, as this account. */
  private startLogin(accountId: string): void {
    const account = this.store.account(accountId)
    if (!account) throw new Error('Conta desconhecida')
    if (account.kind === 'api') throw new Error('Contas de API entram com a chave; edite a conta para trocá-la')
    const previous = this.accountStatus.get(accountId)?.loginPaneId
    if (previous) this.closePane(previous)
    this.accountFiles.prepare(account)
    const id = this.store.allocatePaneId()
    this.panes.spawn({
      id,
      request: { missionId: '', role: 'crew', cli: account.cli, model: null, title: `Entrar: ${account.name}` },
      squadRole: null,
      taskType: null,
      cwd: this.dataDir,
      launch: { cli: account.cli, model: null, login: true },
      env: { ...this.accountFiles.env(account), DISABLE_AUTOUPDATER: '1' },
      hookDriven: false,
      accountId,
    })
    this.loginPanes.set(id, accountId)
    this.setAccountStatus(accountId, { busy: 'login', loginPaneId: id, message: null })
  }

  /** Agents running now, per account (every mission counts: they share the account's limits). */
  private liveByAccount(): Map<string, number> {
    const live = new Map<string, number>()
    for (const pane of this.store.snapshot().panes) {
      if (pane.accountId && this.panes.isAlive(pane.id)) live.set(pane.accountId, (live.get(pane.accountId) ?? 0) + 1)
    }
    return live
  }

  private rooms(cli: AgentCliForRole, live = this.liveByAccount()): AccountRoom[] {
    // Injected stand-ins run offline in tests. Production auto-routing needs observed CLI/auth,
    // rather than silently treating an unchecked or missing executable as available.
    const detected = this.clis.get(cli)
    if (this.harnessMode === 'live' && (!detected?.checkedAt || !detected.installed || detected.busy)) return []
    const rooms = accountRooms(cli, this.store.accounts(), this.statuses(), this.store.limits(), live)
    return this.harnessMode === 'live' ? rooms.filter(r => r.account.kind === 'api' || this.accountStatus.get(r.account.id)?.loggedIn === true) : rooms
  }

  /** What the lead sees with accounts_status: every usable account of each CLI the mission allows. */
  capacity(missionId: string) {
    const mission = this.store.mission(missionId)
    const live = this.liveByAccount()
    return (mission?.allowedClis ?? AGENT_CLIS).map((cli) => {
      const rooms = this.rooms(cli, live)
      return {
        cli,
        accounts: rooms.map((r) => ({
          account: r.account.builtin ? `${CLI_LABEL[cli]} deste Mac` : r.account.name,
          kind: r.account.kind,
          used: r.used === null ? 'sem leitura ainda' : `${Math.round(r.used)}%`,
          agentsNow: r.live,
          full: r.full,
          backIn: r.resetsAt ? untilText(r.resetsAt) : null,
        })),
        canOpen: !chooseAccount(rooms).exhausted,
      }
    })
  }

  /** The account a new agent runs as: the one asked for, or the one with the most room left. */
  private accountFor(cli: AgentCli, requested: string | null | undefined): Account | null {
    if (cli === 'shell') return null
    if (requested) {
      const account = this.store.account(requested)
      if (!account) throw new Error('Conta desconhecida')
      if (account.cli !== cli) throw new Error(`A conta ${account.name} é do ${CLI_LABEL[account.cli]}, não do ${CLI_LABEL[cli]}`)
      return account
    }
    return pickAccount(cli, this.store.accounts(), this.statuses(), this.store.limits())
  }

  /** A pane's screen for a view that just mounted (see the server's attach handling). */
  paneSnapshot(paneId: number): Promise<PaneSnapshot | null> {
    return this.panes.snapshot(paneId)
  }

  private async englishInput(text: string, accountId?: string, allowOriginal = false): Promise<string> {
    if (!this.store.settings().agentsInEnglish || allowOriginal || !text.trim()) return text
    if (!accountId) throw new Error('Escolha explicitamente uma conta Codex para traduzir o prompt para inglês.')
    const account = this.store.account(accountId)
    if (!account || account.cli !== 'codex' || account.kind !== 'assinatura') throw new Error('O tradutor aceita somente uma conta de assinatura Codex escolhida explicitamente. Nenhum outro provedor será usado.')
    const home = this.accountFiles.configDir(account) ?? userConfigDir('codex')
    return this.translate({ text, authFile: join(home, 'auth.json') })
  }

  /** A repeated request joins a live operation, or reads its durable receipt. Never reruns it. */
  private async inputOnce(scope: string, requestId: string, fingerprint: string, original: string, work: (record: InputRecord) => Promise<void>): Promise<InputRecord> {
    const key = `${scope}/${requestId}`
    const prior = this.inputJournal.get(scope, requestId)
    if (prior && prior.fingerprint !== fingerprint) throw new Error('Este pedido já foi usado com outros dados. Preserve o rascunho e confira o envio pendente.')
    const running = this.inputInFlight.get(key)
    if (running) { await running; return this.inputJournal.get(scope, requestId)! }
    if (prior) return prior
    const record: InputRecord = { fingerprint, original, state: 'translating' }
    this.inputJournal.save(scope, requestId, record)
    const promise = (async () => {
      try { await work(record) }
      catch (error) {
        // Once PTY paste/spawn begins, the result can be uncertain. Never repeat it.
        if (record.state !== 'submitting' && !(error instanceof UncertainTranslation)) record.state = 'failed'
        record.error = error instanceof Error ? error.message : String(error)
        this.inputJournal.save(scope, requestId, record)
      }
    })()
    this.inputInFlight.set(key, promise)
    try { await promise } finally { this.inputInFlight.delete(key) }
    return record
  }

  private async submitInput(message: Extract<ClientMessage, { type: 'pane.submit' }>, reply: (message: ServerMessage) => void): Promise<void> {
    let pending = false
    try {
      const pane = this.store.pane(message.paneId)
      if (!pane) throw new Error('Agente inexistente')
      if (!message.requestId) {
        // Literal CLI choice buttons are terminal controls, never free-form user prompts.
        if (pane.choices?.includes(message.text)) { this.activeMission(pane.missionId); this.panes.answered(pane.id); this.submitTo(pane.id, message.text); return }
        throw new Error('Envie requestId estável para evitar duplicação e translationAccountId de uma conta Codex explícita; para enviar sem tradução, autorize allowOriginal: true.')
      }
      const record = await this.inputOnce(pane.missionId, message.requestId, inputFingerprint(message), message.text, async record => {
        this.activeMission(pane.missionId)
        if (!this.panes.isAlive(pane.id)) throw new Error(`#${pane.id} não está rodando`)
        if (typeof message.text !== 'string' || message.text.length > 20_000) throw new Error('A mensagem pode ter até 20.000 caracteres')
        const ids = message.attachments ?? []
        if (!Array.isArray(ids) || ids.length > ATTACHMENT_LIMITS.files) throw new Error('Envie até 8 anexos por mensagem')
        if (ids.length && pane.cli === 'shell') throw new Error('Anexos precisam de um agente de IA')
        const files = [...new Set(ids)].map(id => this.attachments.get(pane.missionId, id))
        if (files.reduce((n, f) => n + f.size, 0) > ATTACHMENT_LIMITS.totalBytes) throw new Error('Os anexos da mensagem podem somar até 8 MB')
        if (!message.text.trim() && !files.length) throw new Error('Escreva uma mensagem ou adicione um anexo')
        record.english = pane.cli === 'shell' ? message.text : await this.englishInput(message.text, message.translationAccountId, message.allowOriginal)
        record.state = 'prepared'; this.inputJournal.save(pane.missionId, message.requestId!, record)
        const text = record.english + (files.length ? `\n\nUser attachments (local files; inspect using your file/image tools):\n${files.map(f => JSON.stringify({ name: f.name, path: f.path, mime: f.mime })).join('\n')}` : '') + (pane.cli === 'shell' ? '' : `\n\n${RESPONSE_LANGUAGE}`)
        record.state = 'submitting'; this.inputJournal.save(pane.missionId, message.requestId!, record)
        this.panes.answered(pane.id)
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('ACK do terminal pendente. Confira o mesmo pedido; não reenvie o texto.')), 5000)
          const queued = this.panes.submitWithReceipt(pane.id, text, () => {
            clearTimeout(timer); record.state = 'acked'; record.error = undefined
            this.inputJournal.save(pane.missionId, message.requestId!, record)
            if (pane.executionEpoch) this.measurements?.wakeup(pane.executionEpoch)
            resolve()
          })
          if (!queued) { clearTimeout(timer); reject(new Error('O terminal não confirmou o envio. Confira o pedido pendente.')) }
          else if (pane.executionEpoch) this.measurements?.bytes(pane.executionEpoch, 'submittedBytes', text)
        })
      })
      if (record.state !== 'acked') { pending = record.state !== 'failed'; throw new Error(record.error ?? 'Envio pendente após interrupção. Nenhuma chamada será repetida; confira o terminal.') }
      reply({ type: 'pane.submitted', requestId: message.requestId, paneId: pane.id })
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      if (!message.requestId) { reply({ type: 'error', message: detail }); return }
      reply({ type: 'pane.submit.error', requestId: message.requestId, pending, message: detail })
    }
  }

  private async createInputMission(message: Extract<ClientMessage, { type: 'mission.create' }>, reply: (message: ServerMessage) => void): Promise<void> {
    let pending = false
    try {
      if (!message.requestId) {
        if (this.store.settings().agentsInEnglish && message.objective?.trim() && !message.allowOriginal) throw new Error('A missão precisa de requestId estável e translationAccountId de uma conta Codex explícita para traduzir o objetivo; para preservar o original, autorize allowOriginal: true.')
        this.startMission(message); return
      }
      const scope = `new-${message.workspaceId}`
      const record = await this.inputOnce(scope, message.requestId, inputFingerprint(message), message.objective, async record => {
        record.english = await this.englishInput(message.objective, message.translationAccountId, message.allowOriginal)
        if (record.english.length > 4000) throw new Error('O objetivo traduzido excedeu 4.000 caracteres. Reduza o objetivo; nenhum agente foi iniciado.')
        record.state = 'submitting'; this.inputJournal.save(scope, message.requestId!, record)
        const mission = this.startMission({ ...message, objective: record.english })
        record.missionId = mission.id; record.state = 'acked'
        this.inputJournal.save(mission.id, message.requestId!, record)
        this.inputJournal.save(scope, message.requestId!, record)
      })
      if (record.state !== 'acked' || !record.missionId) { pending = record.state !== 'failed'; throw new Error(record.error ?? 'Criação pendente após interrupção; confira a lista de missões antes de qualquer nova abertura.') }
      const mission = this.store.mission(record.missionId)
      if (!mission) throw new Error('A missão deste pedido foi excluída; nenhum novo agente foi aberto.')
      reply({ type: 'mission.created', requestId: message.requestId, mission })
    } catch (error) {
      if (!message.requestId) throw error
      reply({ type: 'mission.create.error', requestId: message.requestId, pending, message: error instanceof Error ? error.message : String(error) })
    }
  }

  handle(message: ClientMessage, reply: (message: ServerMessage) => void = this.broadcast): void | Promise<void> {
    switch (message.type) {
      case 'mission.progress': {
        const requestId = typeof message.requestId === 'string' ? message.requestId.slice(0, 100) : ''
        try {
          if (!requestId || typeof message.missionId !== 'string') throw new Error('Consulta de progresso inválida')
          reply({ type: 'mission.progress', requestId, progress: this.missionProgress(message.missionId) })
        } catch (error) {
          reply({ type: 'mission.progress.error', requestId, missionId: message.missionId, message: error instanceof Error ? error.message : String(error) })
        }
        return
      }
      case 'files.status':
      case 'files.tree':
      case 'files.diff':
      case 'files.read':
        void this.files(message, reply).catch((error) => reply({ type: 'files.error', message: error instanceof Error ? error.message : String(error) }))
        return
      case 'workspace.open': {
        const [path] = validFolders([message.path])
        this.broadcast({ type: 'workspace.updated', workspace: this.store.openWorkspace(path!) })
        return
      }
      case 'workspace.create': {
        try {
          const folders = validFolders(message.folders)
          const workspace = this.store.createWorkspace(workspaceName(message.name), folders)
          this.broadcast({ type: 'workspace.updated', workspace })
          if (message.requestId) reply({ type: 'workspace.saved', requestId: message.requestId, workspace })
        } catch (error) {
          if (!message.requestId) throw error
          reply({ type: 'workspace.error', requestId: message.requestId, message: error instanceof Error ? error.message : String(error) })
        }
        return
      }
      case 'workspace.update': {
        try {
        if (!this.store.workspace(message.workspaceId)) throw new Error('Workspace desconhecido')
        const workspace = this.store.updateWorkspace(message.workspaceId, {
          name: message.name === undefined ? undefined : workspaceName(message.name),
          folders: message.folders === undefined ? undefined : validFolders(message.folders),
          instructions: message.instructions === undefined ? undefined : typeof message.instructions === 'string' ? message.instructions.trim().slice(0, WORKSPACE_LIMITS.instructions) : '',
        })
        if (workspace) {
          this.broadcast({ type: 'workspace.updated', workspace })
          if (message.requestId) reply({ type: 'workspace.saved', requestId: message.requestId, workspace })
        }
        } catch (error) {
          if (!message.requestId) throw error
          reply({ type: 'workspace.error', requestId: message.requestId, message: error instanceof Error ? error.message : String(error) })
        }
        return
      }
      case 'mission.create':
        return this.createInputMission(message, reply)
      case 'squad.save': {
        const squad = normalizeSquad(message.squad, this.store.customSquadIds())
        this.store.saveSquad(squad)
        this.broadcast({ type: 'squad.updated', squad })
        return
      }
      case 'squad.delete': {
        if (this.store.squad(message.squadId)?.builtin) throw new Error('Squads que vêm com o Orbit não podem ser apagados')
        if (this.store.deleteSquad(message.squadId)) this.broadcast({ type: 'squad.removed', squadId: message.squadId })
        return
      }
      case 'routing.save': {
        this.store.saveRouting({ ...normalizeRouting(message.routing), revision: message.routing.revision })
        this.broadcast({ type: 'routing.updated', routing: this.store.routing() })
        return
      }
      case 'cli.check':
        void this.checkClis()
        return
      case 'cli.update':
        if (!AGENT_CLIS.includes(message.cli)) throw new Error('CLI desconhecida')
        void this.updateCli(message.cli)
        return
      case 'account.save':
        void this.saveAccount(message.account).catch((error) => this.fail(error))
        return
      case 'account.delete':
        void this.deleteAccount(message.accountId).catch((error) => this.fail(error))
        return
      case 'account.reset':
        return this.resetAccount(message, reply)
      case 'account.check':
        void this.checkAccounts()
        return
      case 'limits.refresh':
        return this.refreshLimits()
      case 'account.login':
        this.startLogin(message.accountId)
        return
      case 'catalog.scan':
        void this.scanSkills().catch((error) => this.fail(error))
        return
      case 'catalog.toggle': {
        if (typeof message.id !== 'string' || !/^(claude|codex):(skill|agent|mcp):[^\s]{1,160}$/.test(message.id)) throw new Error('Item desconhecido')
        this.store.setCatalogItem(message.id, message.enabled === true)
        this.broadcast(this.skillsMessage())
        return
      }
      case 'browser.navigate':
        this.activeMission(message.missionId)
        void this.browser.navigate(message.missionId, message.url, 'você').catch((error) => this.fail(error))
        return
      case 'browser.history':
        void this.browser.history(message.missionId, message.action, 'você').catch((error) => this.fail(error))
        return
      case 'browser.input':
        void this.browserInput(message.missionId, message.input).catch((error) => this.fail(error))
        return
      case 'browser.watch':
        return // per-connection: handled by the server
      case 'browser.close':
        void this.browser.close(message.missionId)
        return
      case 'pane.delete':
        this.deletePane(message.paneId, message.conversation === true)
        return
      case 'mission.delete':
        this.deleteMission(message.missionId, { conversations: message.conversations === true, memory: message.memory === true, branches: message.branches === true })
        return
      case 'workspace.delete':
        this.deleteWorkspace(message.workspaceId, { conversations: message.conversations === true, branches: message.branches === true })
        return
      case 'memory.get':
        reply({ type: 'memory', workspaceId: message.workspaceId, entries: this.store.memory(message.workspaceId) })
        return
      case 'memory.save': {
        if (!this.store.workspace(message.workspaceId)) throw new Error('Workspace desconhecido')
        const old = message.entry.id ? this.store.memory(message.workspaceId).find((e) => e.id === message.entry.id) : undefined
        this.remember(message.workspaceId, { id: old?.id, kind: message.entry.kind, text: message.entry.text, pinned: message.entry.pinned, source: old ? old.source : null })
        return
      }
      case 'memory.delete':
        this.broadcast({ type: 'memory', workspaceId: message.workspaceId, entries: this.store.deleteMemory(message.workspaceId, message.entryId) })
        return
      case 'mission.lead.change':
        void this.changeLead(message.missionId, message.to).catch((error) => this.fail(error))
        return
      case 'proposal.decide':
        this.decideProposal(message.proposalId, message.accept === true)
        return
      case 'settings.save':
        this.broadcast({ type: 'settings.updated', settings: this.store.saveSettings(message.settings) })
        return
      case 'routing.reset':
        this.store.saveRouting(null)
        this.broadcast({ type: 'routing.updated', routing: this.store.routing() })
        return
      case 'mission.archive': {
        for (const pane of this.store.snapshot().panes.filter((p) => p.missionId === message.missionId)) {
          this.closePane(pane.id)
        }
        void this.browser.close(message.missionId)
        this.cleanWorktrees(message.missionId)
        const mission = this.store.updateMission(message.missionId, { status: 'archived' })
        if (mission) this.broadcast({ type: 'mission.updated', mission })
        return
      }
      case 'pane.spawn': {
        return (async () => {
        try {
          await this.prepareDesignContext(message.request)
          const key = message.requestId
          const fingerprint = createHash('sha256').update(JSON.stringify(message.request)).digest('hex')
          if (key) {
            if (typeof key !== 'string' || !key.trim() || key.length > 100) throw new Error('Identificador de abertura inválido')
            const receipt = this.store.uiSpawn(key)
            if (receipt) {
              if (receipt.fingerprint !== fingerprint) throw new Error('Este pedido de abertura já foi usado com outros dados')
              const pane = receipt.paneId === null ? undefined : this.store.pane(receipt.paneId)
              if (!pane) throw new Error('Abertura anterior sem agente disponível; confira a missão antes de iniciar um novo pedido')
              reply({ type: 'pane.spawned', requestId: key, pane }); return
            }
          }
          if (message.expiresAt !== undefined && (!Number.isFinite(message.expiresAt) || Date.now() > message.expiresAt)) throw new Error('Pedido expirou antes da abertura; nenhum novo agente foi criado')
          if (key) this.store.saveUiSpawn(key, { fingerprint, paneId: null })
          const pane = this.spawn(message.request, { ...(message.request.cli !== 'shell' ? { explicitCli: message.request.cli } : {}) })
          if (key) { this.store.saveUiSpawn(key, { fingerprint, paneId: pane.id }); reply({ type: 'pane.spawned', requestId: key, pane }) }
        } catch (error) {
          if (!message.requestId) throw error
          reply({ type: 'pane.spawn.error', requestId: message.requestId, message: error instanceof Error ? error.message : String(error) })
        }
        })()
      }
      case 'pane.attach':
        return // per-connection: handled by the server
      case 'pane.input':
        if (typeof message.data === 'string' && message.data.includes('\r')) this.panes.answered(message.paneId)
        this.panes.write(message.paneId, message.data)
        return
      case 'attachment.add': {
        try {
          const pane = this.store.pane(message.paneId)
          if (!pane || pane.cli === 'shell' || !this.panes.isAlive(pane.id)) throw new Error('Selecione um agente ativo para anexar arquivos')
          this.activeMission(pane.missionId)
          const attachment = this.attachments.add(pane.missionId, message)
          reply({ type: 'attachment.added', requestId: message.requestId, attachment })
        } catch (error) {
          reply({ type: 'attachment.error', requestId: message.requestId, message: error instanceof Error ? error.message : String(error) })
        }
        return
      }
      case 'pane.conversation': {
        const pane = this.store.pane(message.paneId)
        if (!pane) throw new Error('Agente inexistente')
        reply({ type: 'pane.conversation', paneId: pane.id, turns: this.conversationOf(pane).slice(-60).map((t) => ({ ...t, text: t.text.slice(0, 12_000) })) })
        return
      }
      case 'pane.submit':
        return this.submitInput(message, reply)
      case 'pane.resize':
        this.panes.resize(message.paneId, message.cols, message.rows)
        return
      case 'pane.close':
        this.closePane(message.paneId)
        return
      case 'pane.rename':
        this.renamePane(message.paneId, message.title)
        return
      case 'pane.restart':
        return this.restartPane(message.paneId, message.resume === true).then(() => {})
      case 'git.summary':
        reply({ type: 'git.summary', missionId: message.missionId, summary: this.gitSummary(message.missionId) })
        return
      case 'git.pr.create':
        void this.createPr(message.missionId, message.title, message.body, message.draft === true)
          .then((status) => reply({ type: 'git.pr', missionId: message.missionId, status }))
          .catch((error) => reply({ type: 'files.error', message: error instanceof Error ? error.message : String(error) }))
        return
      case 'git.pr.status':
        void this.prStatus(message.missionId)
          .then((status) => reply({ type: 'git.pr', missionId: message.missionId, status }))
          .catch((error) => reply({ type: 'files.error', message: error instanceof Error ? error.message : String(error) }))
        return
      case 'report.get':
        void this.report(message.missionId)
          .then((markdown) => reply({ type: 'report', missionId: message.missionId, markdown }))
          .catch((error) => reply({ type: 'files.error', message: error instanceof Error ? error.message : String(error) }))
        return
      case 'report.save':
        void this.report(message.missionId)
          .then((markdown) => {
            const path = typeof message.path === 'string' ? message.path : ''
            if (!isAbsolute(path) || !path.toLowerCase().endsWith('.md') || !isDirectory(dirname(path))) throw new Error('Escolha um arquivo .md numa pasta que exista')
            writeFileSync(path, markdown, { mode: 0o644 })
            reply({ type: 'report.saved', missionId: message.missionId, path })
          })
          .catch((error) => reply({ type: 'files.error', message: error instanceof Error ? error.message : String(error) }))
        return
      case 'mission.budget': {
        const mission = this.store.mission(message.missionId)
        if (!mission) throw new Error('Missão desconhecida')
        const limits = budgetLimits({ tokens: message.tokens, costUsd: message.costUsd })
        // A new limit is judged against what the mission already used: no warning twice.
        const budget = limits && { ...limits, warned: false, exceeded: false }
        const updated = this.store.updateMission(mission.id, { budget: budget && { ...budget, warned: budgetUse(mission, budget) >= BUDGET_WARN_AT, exceeded: budgetUse(mission, budget) >= 1 } })
        if (updated) this.broadcast({ type: 'mission.updated', mission: updated })
        return
      }
      case 'ledger.get': {
        const month = typeof message.month === 'string' && /^\d{4}-\d{2}$/.test(message.month) ? message.month : dayKey(Date.now()).slice(0, 7)
        reply({ type: 'ledger', month, entries: this.store.ledger(month) })
        return
      }
      case 'schedule.save': {
        const schedule = this.normalizeSchedule(message.schedule, Date.now())
        this.store.saveSchedule(schedule)
        this.broadcast({ type: 'schedule.updated', schedule })
        return
      }
      case 'schedule.delete':
        if (this.store.deleteSchedule(message.scheduleId)) this.broadcast({ type: 'schedule.removed', scheduleId: message.scheduleId })
        return
      case 'schedule.run': {
        const schedule = this.store.schedule(message.scheduleId)
        if (!schedule) throw new Error('Agendamento não encontrado')
        return this.runSchedule(schedule, Date.now(), true).then(() => {})
      }
      case 'template.save': {
        const template = this.normalizeTemplate(message.template)
        this.store.saveTemplate(template)
        this.broadcast({ type: 'template.updated', template })
        return
      }
      case 'template.delete':
        if (this.store.deleteTemplate(message.templateId)) this.broadcast({ type: 'template.removed', templateId: message.templateId })
        return
      case 'card.add':
        this.addCard(message.missionId, 'você', message)
        return
      case 'card.update':
        this.updateCard(this.existingCard(message.cardId), message)
        return
      case 'card.move':
        this.moveCard(this.existingCard(message.cardId), message.column, message.index)
        return
      case 'card.delete':
        if (this.store.deleteCard(this.existingCard(message.cardId).id)) this.broadcast({ type: 'card.removed', cardId: message.cardId })
        return
      case 'pane.duplicate': {
        const pane = this.store.pane(message.paneId)
        const spec = pane && this.store.paneSpec(message.paneId)
        if (!pane || !spec) throw new Error(`#${message.paneId} foi aberto antes desta versão do Orbit; abra um novo`)
        const input = { ...spec, role: 'crew' as const, title: `${pane.title} (cópia)`.slice(0, 120) }
        return this.prepareDesignContext(input).then(() => { this.spawn(input, { opened: (id) => `#${id} é uma cópia de #${pane.id}` }) })
      }
    }
  }

  // ---- Agent-facing API (MCP tools and hooks) ----

  /** The pane a bearer token belongs to, if it is still open. */
  identify(token: string | undefined): Pane | undefined {
    const id = token ? this.paneTokens.get(token) : undefined
    const pane = id === undefined ? undefined : this.store.pane(id)
    return pane && { ...pane, activityAttemptId: this.store.currentPaneAttempt(pane.id)?.id }
  }

  assertCurrent(caller: Pane): void {
    const current = this.store.pane(caller.id)
    const obsolete = !current || current.status === 'exited' || current.missionId !== caller.missionId
      || current.executionEpoch !== caller.executionEpoch || this.store.executionEpoch(caller.id) !== caller.executionEpoch
      || current.role !== caller.role
      || (caller.activityAttemptId !== undefined && caller.activityAttemptId !== this.store.currentPaneAttempt(caller.id)?.id)
    if (obsolete) throw new Error('Esta execução ou tentativa foi substituída ou encerrada. Consulte a execução atual antes de agir.')
  }

  dispatchDeliveries(missionId?: string): void {
    for (const notice of this.store.notifications(missionId, true)) {
      if (this.store.mission(notice.missionId)?.status !== 'active') continue
      const target = notice.recipient.kind === 'pane' ? this.store.pane(notice.recipient.paneId) : this.missionPanes(notice.missionId).find(p => p.role === 'lead')
      if (!target || target.missionId !== notice.missionId || !this.panes.canReceiveDelivery(target.id) || !needsDelivery(notice, target)) continue
      const key = `${notice.id}:${target.executionEpoch}`
      if (this.sendingNotices.has(key)) continue
      this.sendingNotices.add(key)
      const recipient = { ...target }
      const queued = this.panes.submitWithReceipt(target.id, noticeText(notice), () => {
        this.measurements?.wakeup(recipient.executionEpoch!)
        try { this.store.markNoticeAccepted(notice.id, recipient) }
        finally { this.sendingNotices.delete(key) }
      })
      if (queued) this.measurements?.bytes(target.executionEpoch!, 'submittedBytes', noticeText(notice))
      if (!queued) this.sendingNotices.delete(key)
    }
  }

  acknowledgeDelivery(caller: Pane, deliveryId: string, includeResult = false) {
    this.assertCurrent(caller)
    const notice = this.store.acknowledgeNotice(deliveryId, caller)
    if (!includeResult) return notice
    const history = this.store.activityHistory(caller.missionId)
    const result = history.results.find(r => r.id === notice.resultId)
    const activity = result && history.activities.find(a => a.id === result.activityId)
    const attempt = result && history.attempts.find(a => a.id === result.attemptId)
    const { text: _text, ...receipt } = notice
    // ACK is receipt only. Do not scan source, create an inspection or imply acceptance.
    if (!result || !activity || !attempt) return { ...receipt, context: null }
    const limits = { summary: 2000, evidence: 4000, details: 2000 }
    const truncatedFields = (Object.keys(limits) as Array<keyof typeof limits>).filter(key => result[key].length > limits[key])
    return { ...receipt, context: {
      current: activity.state !== 'waived' && activity.activeAttemptId === result.attemptId && activity.revision === result.activityRevision && history.results.findLast(r => r.attemptId === result.attemptId)?.id === result.id,
      sourceFreshness: 'not_checked' as const,
      result: { id: result.id, activityId: result.activityId, activityRevision: result.activityRevision, attemptId: result.attemptId, status: result.status, state: result.state,
        summary: result.summary.slice(0, limits.summary), evidence: result.evidence.slice(0, limits.evidence), details: result.details.slice(0, limits.details), acceptance: attempt.acceptance },
      activity: { id: activity.id, title: activity.title, revision: activity.revision, activeAttemptId: activity.activeAttemptId, state: activity.state },
      producer: { paneId: attempt.paneId, cli: attempt.cli, sessionId: attempt.sessionId },
      truncatedFields,
      more: { tool: 'handoff_list', arguments: { resultId: result.id, view: 'detail' } },
    } }
  }

  mission(id: string): Mission | undefined {
    return this.store.mission(id)
  }

  missionPanes(missionId: string): Pane[] {
    return this.store.snapshot().panes.filter((p) => p.missionId === missionId)
  }

  missionEvents(missionId: string, kind?: MissionEventKind): MissionEvent[] {
    return this.store.snapshot().events.filter((e) => e.missionId === missionId && (!kind || e.kind === kind))
  }

  routing() {
    return this.store.routing()
  }

  modelCatalog(missionId: string) {
    return this.store.mission(missionId)?.allowedClis.map((cli) => ({
      cli,
      adapter: adapterCapabilities(cli, this.clis.get(cli)?.version ?? null),
      source: this.catalog?.[cli].source ?? 'unavailable',
      models: this.catalog?.[cli].models.map((m) => ({ ...m, description: m.description.slice(0, 240) })) ?? [],
      selection: ['simples', 'normal', 'dificil'].map((difficulty) => ({
        difficulty,
        ...seatForDifficulty(cli, null, 'medium', difficulty as Difficulty, (model) => effortsFor(this.catalog, cli, model), this.catalog?.[cli]),
      })),
      costBasis: 'Relative model tiers; no live price quotes. Account limits and live agent load govern balancing.',
    })) ?? []
  }

  /** The workspace a mission runs in. */
  missionWorkspace(missionId: string) {
    const workspaceId = this.store.mission(missionId)?.workspaceId
    return workspaceId ? this.store.workspace(workspaceId) : undefined
  }

  /** The squad a mission follows, if any. */
  missionSquad(missionId: string): Squad | undefined {
    const squadId = this.store.mission(missionId)?.squadId
    return squadId ? this.store.squad(squadId) : undefined
  }

  /**
   * A helper opened by an agent. In agentic missions an activity without a role, type or explicit
   * CLI is classified by the maestro; the receipt says what was chosen and why.
   */
  delegationKey(input: HelperRequest): string {
    if (input.activityId) {
      if (!/^[a-zA-Z0-9_-]{1,100}$/.test(input.activityId)) throw new Error('Identificador da atividade inválido')
      return createHash('sha256').update(`activity:${input.activityId}`).digest('hex')
    }
    return createHash('sha256').update(JSON.stringify({ task: input.task.trim().replaceAll('\r\n', '\n'),
      folder: input.folder ?? null, role: input.squadRoleId ?? null, kind: input.taskTypeId ?? null,
      accept: (input.accept ?? []).map((c) => c.trim()).filter(Boolean).slice(0, 8), ...(input.dependsOn?.length ? { dependsOn: [...new Set(input.dependsOn)].sort() } : {}), ...(input.requireReadOnlySandbox ? { requireReadOnlySandbox: true } : {}), ...(input.readOnly ? { readOnly: true } : {}) })).digest('hex')
  }

  async spawnHelper(caller: Pane, input: HelperRequest): Promise<{ pane: Pane; receipt: string[] }> {
    this.assertCurrent(caller)
    this.activeMission(caller.missionId)
    // Receipts expose the ledger id; accepting it here keeps a resumed leader on the same work.
    const identified = input.activityId && this.store.activity(caller.missionId, input.activityId)
    const key = identified ? identified.key : this.delegationKey(input)
    const lock = `${caller.missionId}:${key}`
    const pending = this.delegating.get(lock)
    if (pending) {
      const result = await pending
      return { pane: result.pane, receipt: [`reutilizado: #${result.pane.id}, delegação já em abertura`] }
    }
    const retry = input.retryReason?.trim()
    if (input.retryReason !== undefined && !retry) throw new Error('Explique por que esta tarefa precisa ser executada novamente')
    const activity = this.store.activity(caller.missionId, key)
    const dependencies: NonNullable<ActivityRecord['dependencies']> = []
    if (!Array.isArray(input.dependsOn ?? []) || (input.dependsOn?.length ?? 0) > 16 || input.dependsOn?.some(id => typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id))) throw new Error('Dependências inválidas')
    for (const id of [...new Set(input.dependsOn ?? [])]) {
      const upstream = this.store.activity(caller.missionId, id) ?? this.store.activity(caller.missionId, this.delegationKey({ title: '', task: '', model: null, activityId: id }))
      if (!upstream) throw new Error(`Dependência ${id} não existe nesta missão`)
      const result = this.acceptedResult(caller.missionId, upstream.id, new Set(), true)
      dependencies.push({ activityId: upstream.id, revision: upstream.revision, attemptId: upstream.activeAttemptId, resultId: result.id })
    }
    if (activity) assertNoDependencyCycle(activity.id, dependencies.map(d => d.activityId), this.store.activityHistory(caller.missionId).activities)
    const previous = activity && this.store.activityAttempt(activity.activeAttemptId)
    if (retry && previous && retry !== previous.retryReason && previous.state !== 'delivered' && this.panes.isAlive(previous.paneId)) {
      throw new Error(`A atividade de #${previous.paneId} ainda está em execução. Interrompa e feche a tentativa antes de substituí-la, para evitar trabalho concorrente duplicado.`)
    }
    if (retry && previous?.state === 'delivered' && this.panes.isAlive(previous.paneId)) this.closeHelper(caller, previous.paneId, false)
    const ticket = this.store.reserveActivity({ missionId: caller.missionId, key, title: input.title, contractHash: contractHash(input), acceptance: normalizedAcceptance(input.accept), retryReason: retry ?? null, assignedBy: caller.id, requiresDelivery: input.cli !== 'shell', dependencies })
    if (ticket.reused) {
      const attempt = ticket.attempt
      const pane = attempt.state === 'delivered' ? attempt.pane : this.store.pane(attempt.paneId) ?? attempt.pane
      if (!pane || (attempt.state !== 'delivered' && !this.panes.isAlive(attempt.paneId))) throw new Error(`Tentativa de #${attempt.paneId} já reservada ou parada sem concluir. Confira o histórico e use agent_resume ou retryReason com uma justificativa nova.`)
      return { pane, receipt: [`reutilizado: #${pane.id} (${pane.handoffStatus ?? pane.status}); atividade ${ticket.activity.id}, tentativa ${attempt.id}`] }
    }
    const reservedMission = this.store.mission(caller.missionId)
    if (reservedMission) this.broadcast({ type: 'mission.updated', mission: reservedMission })
    const opening = (async () => {
      if (retry && previous) await this.panes.waitForExit(previous.paneId)
      this.assertCurrent(caller)
      return this.openHelper(caller, input, ticket.attempt)
    })().then((result) => {
      this.store.saveDelegation({ missionId: caller.missionId, key, pane: result.pane, acceptance: (input.accept ?? []).map((c) => c.trim()).filter(Boolean).slice(0, 8), retryReason: retry ?? null })
      if (previous && retry) this.store.replaceDelivery(caller.missionId, previous.paneId, result.pane.id, caller.id, retry)
      this.store.flush()
      return result
    }).catch(error => {
      this.store.failAttempt(ticket.attempt.id, error)
      throw error
    })
    this.delegating.set(lock, opening)
    try { return await opening } finally { this.delegating.delete(lock) }
  }

  private async openHelper(caller: Pane, input: HelperRequest, attempt: { id: string; paneId: number }): Promise<{ pane: Pane; receipt: string[] }> {
    const receipt: string[] = []
    const policyRevision = routingRevision(this.store.routing())
    let decisionSource: DecisionReceipt['source'] = input.cli || input.model || input.effort ? 'explicit' : 'rule'
    const mission = this.store.mission(caller.missionId)
    if (caller.role === 'crew') {
      const slots = this.childSlots(caller)
      if (slots === 0) throw new Error(this.missionPanes(caller.missionId).some((p) => p.assignedBy === caller.id && this.panes.isAlive(p.id)) ? `Você já tem ${MAX_CHILDREN} sub-ajudantes abertos. Feche um que já entregou (agent_close) antes de abrir outro.` : 'Sub-ajudantes não podem abrir ajudantes.')
    }
    let taskTypeId = input.taskTypeId ?? null
    const assessed = assessDifficulty(input.title, input.task)
    let difficulty: Difficulty = input.difficulty ?? assessed.difficulty
    let difficultyBy = input.difficulty ? 'líder' : assessed.why
    if ((mission?.mode === 'agentica' || caller.role === 'crew') && !taskTypeId && !input.squadRoleId && !input.cli && !input.model) {
      const text = `${input.title}\n${input.task}`
      const types = this.store.routing().taskTypes
      let { type, via, sure } = classifyTask(text, types, input.title)
      // No keyword, or two types close: a small model reads the activity against the table; the
      // keywords' answer stands if it fails.
      if (!sure && assessed.difficulty !== 'simples' && this.store.settings().smartClassify) {
        if (this.budgetBlocks(caller.missionId)) throw new Error('O orçamento desta missão acabou antes da classificação')
        const call = this.store.startAuxiliaryCall({ missionId: caller.missionId, attemptId: attempt.id, model: DECIDER_MODEL, promptBytes: Buffer.byteLength(decisionPrompt(text, types)) })
        let observation!: AuxiliaryObservation
        const decided = await decideTaskType(this.run, join(this.dataDir, 'decisor'), text, types, value => { observation = value }).catch(() => null)
        if (!observation) throw new Error('Classificador não iniciou nem reportou resultado; chamada permanece incompleta para diagnóstico')
        const accounted = this.store.finishAuxiliaryCall(call.id, observation)
        if (accounted.added) {
          this.broadcast({ type: 'mission.updated', mission: this.checkBudget(accounted.added.mission) })
          this.broadcast({ type: 'usage.day', day: accounted.added.day })
        }
        if (decided) {
          decisionSource = 'classifier';
          ({ type, via } = { type: decided.type, via: `decidido pelo Haiku${via === 'padrão' ? '' : ` (as palavras: ${via})`}: ${decided.why}` })
          if (!input.difficulty && assessed.difficulty === 'normal') [difficulty, difficultyBy] = [decided.difficulty, 'Haiku']
        }
        else via = `${via}; o decisor não respondeu`
      }
      taskTypeId = type.id
      receipt.push(`tipo: ${type.name} (o maestro classificou; ${via})`)
    } else if (taskTypeId) {
      const type = this.store.routing().taskTypes.find((t) => t.id === taskTypeId)
      if (type) receipt.push(`tipo: ${type.name} (escolhido pelo ${caller.role === 'lead' ? 'líder' : `ajudante #${caller.id}`})`)
    }
    const accept = (input.accept ?? []).map((c) => c.trim()).filter(Boolean).slice(0, 8)
    if (accept.length) receipt.push(`critérios de aceite: ${accept.length}`)
    if (input.folder) receipt.push(`pasta: ${input.folder}`)
    receipt.push(`complexidade: ${difficulty} (${difficultyBy})`)
    if (input.retryReason) receipt.push(`nova execução: ${input.retryReason.trim().slice(0, 600)}`)
    const children = caller.role === 'lead' && (mission?.mode === 'agentica' || mission?.mode === 'squad') ? MAX_CHILDREN : 0
    const { accept: _, difficulty: __, retryReason: ___, activityId: ____, ...request } = input
    // A model the lead named stays; otherwise the activity's difficulty picks the tier.
    const tier = difficulty !== 'normal' && !input.model && !input.squadRoleId ? { difficulty, by: difficultyBy } : undefined
    await this.prepareDesignContext({ ...request, missionId: caller.missionId, role: 'crew', cli: input.cli ?? 'claude' })
    // Classification may have awaited a model; enforce the sub-helper cap at launch too.
    if (caller.role === 'crew' && this.childSlots(caller) === 0) throw new Error('Não há vaga para outro sub-ajudante; aguarde ou feche um que entregou')
    this.assertCurrent(caller)
    if (policyRevision !== routingRevision(this.store.routing())) throw new Error('A tabela de roteamento mudou durante a classificação; confira e repita com uma nova justificativa')
    const activity = this.store.activityHistory(caller.missionId).activities.find(a => a.activeAttemptId === attempt.id)
    for (const dependency of activity?.dependencies ?? []) {
      if (this.acceptedResult(caller.missionId, dependency.activityId, new Set(), true).id !== dependency.resultId) throw new Error('A dependência mudou antes do lançamento')
    }
    const opened = this.spawn({ missionId: caller.missionId, role: 'crew', ...request, task: input.task + acceptanceNote(accept), cli: input.cli ?? 'claude', taskTypeId }, { receipt, boss: caller, children, tier, explicitCli: input.cli, id: attempt.paneId, attemptId: attempt.id, requireReadOnlySandbox: input.requireReadOnlySandbox, decisionSource, harnessTask: { difficulty, retry: !!input.retryReason } })
    if (accept.length) this.acceptance.set(opened.id, accept)
    this.assign(opened.id, caller.id)
    const pane = this.store.pane(opened.id) ?? opened
    receipt.push(`atividade: ${activity!.id}; tentativa: ${attempt.id}`)
    receipt.push(`abriu: ${[CLI_LABEL[pane.cli], pane.model ?? 'modelo padrão', pane.effort && `esforço ${EFFORT_LABEL[pane.effort]}`].filter(Boolean).join(' · ')}`)
    return { pane, receipt }
  }

  /** A lead suggests changing a row of the task table; the person decides in Settings. */
  proposeRouting(caller: Pane, input: { kind: string; change: RoutingChange; reason: string }): RoutingProposal {
    if (caller.role !== 'lead') throw new Error('Só o líder propõe mudanças na tabela')
    const routing = this.store.routing()
    const row = routing.taskTypes.find((t) => t.id === input.kind)
    if (!row) throw new Error(`Tipo "${input.kind}" não existe na tabela`)
    const change = Object.fromEntries(Object.entries(input.change).filter(([, v]) => v !== undefined)) as RoutingChange
    if (Object.keys(change).length === 0) throw new Error('Diga o que mudar: agent, model, effort, method ou readOnly')
    const reason = input.reason.trim().slice(0, 600)
    if (!reason) throw new Error('Explique o motivo: o usuário decide com base nele')
    // Must make a valid table (a model of the right CLI, an effort it takes…).
    normalizeRouting({ ...routing, taskTypes: routing.taskTypes.map((t) => (t.id === row.id ? { ...t, ...change, ...(change.cli && change.cli !== t.cli && !('model' in change) ? { model: null } : {}) } : t)) })
    if (this.store.proposals().filter((p) => p.missionId === caller.missionId && p.status === 'pendente').length >= 5) throw new Error('Já há 5 propostas desta missão esperando o usuário')
    const proposal = this.store.addProposal({ missionId: caller.missionId, paneId: caller.id, kind: row.id, change, reason, baseRevision: routing.revision })
    this.broadcast({ type: 'proposals', proposals: this.store.proposals() })
    this.event(caller.missionId, 'proposal', `Proposta para a tabela: ${row.name}`, `${describeChange(row, change)}\n\nMotivo: ${reason}\n\nDecida em Ajustes › Quem faz cada tarefa.`, caller.id)
    return proposal
  }

  /** The person's answer to a proposal: applied to the table when accepted; the lead is told. */
  private decideProposal(id: string, accept: boolean): void {
    const proposal = this.store.proposal(id)
    if (!proposal) throw new Error('Proposta não encontrada')
    if (proposal.status !== 'pendente') throw new Error('Essa proposta já foi decidida')
    const routing = this.store.routing()
    const row = routing.taskTypes.find((t) => t.id === proposal.kind)
    if (accept) {
      if (proposal.baseRevision !== routing.revision) throw new Error('A tabela mudou desde esta proposta. Peça uma proposta atualizada antes de aceitar.')
      if (!row) throw new Error('O tipo dessa proposta saiu da tabela')
      const { change } = proposal
      this.store.acceptRoutingProposal(id, normalizeRouting({ ...routing, taskTypes: routing.taskTypes.map((t) => (t.id === row.id ? { ...t, ...change, ...(change.cli && change.cli !== t.cli && !('model' in change) ? { model: null } : {}) } : t)) }))
      this.broadcast({ type: 'routing.updated', routing: this.store.routing() })
    }
    if (!accept) this.store.decideProposal(id, 'recusada')
    this.broadcast({ type: 'proposals', proposals: this.store.proposals() })
    const name = row?.name ?? proposal.kind
    this.event(proposal.missionId, 'proposal', `Proposta ${accept ? 'aceita' : 'recusada'}: ${name}`, describeChange(row, proposal.change), proposal.paneId)
    if (this.panes.isAlive(proposal.paneId)) this.panes.submit(proposal.paneId, `[Orbit] O usuário ${accept ? 'aceitou' : 'recusou'} sua proposta para a tabela (${name}: ${oneLine(describeChange(row, proposal.change))}).${accept ? ' Vale para os próximos ajudantes.' : ''}`)
  }

  /** How many more sub-helpers a helper may open now (only helpers the lead opened may). */
  childSlots(caller: Pane): number {
    if (caller.role !== 'crew' || caller.cli === 'shell' || caller.assignedBy === null) return 0
    const mode = this.store.mission(caller.missionId)?.mode
    if (this.store.pane(caller.assignedBy)?.role !== 'lead' || (mode !== 'agentica' && mode !== 'squad')) return 0
    const open = this.missionPanes(caller.missionId).filter((p) => p.assignedBy === caller.id && this.panes.isAlive(p.id)).length
    return Math.max(0, MAX_CHILDREN - open)
  }

  /** An agent asks the person: the pane waits, with the question and its choices, until answered. */
  askUser(caller: Pane, question: string, choices: string[]): void {
    const text = question.trim().slice(0, 600)
    if (!text) throw new Error('Escreva a pergunta')
    this.panes.ask(caller.id, text, choices.map((c) => c.trim().slice(0, 80)).filter(Boolean).slice(0, 6))
  }

  /** When Orbit opens: the agents that were running come back in their conversations. */
  async resumeCrews(): Promise<void> {
    if (!this.store.settings().resumeOnStart) return
    const ids = this.store.wasRunning.splice(0)
    const panes = ids.map((id) => this.store.pane(id)).filter((p): p is Pane => Boolean(p && p.cli !== 'shell' && p.sessionId && this.store.paneSpec(p.id) && this.store.mission(p.missionId)?.status === 'active'))
    // Leads first, so helpers that deliver find them running.
    panes.sort((a, b) => Number(b.role === 'lead') - Number(a.role === 'lead') || a.id - b.id)
    for (const pane of panes) {
      if (this.stopping) break
      try {
        await this.restartPane(pane.id, true, this.owesHandoff(pane) ? RESUME_NOTE : undefined)
      } catch (error) {
        this.event(pane.missionId, 'pane.exited', `#${pane.id} não voltou`, error instanceof Error ? error.message : String(error), pane.id)
      }
    }
  }

  /** Sends text to another agent of the same mission, as if typed by a person. */
  sendTo(caller: Pane, targetId: number, text: string): void {
    const target = this.sameMission(caller, targetId)
    if (!this.submitTo(target.id, `[Orbit] Mensagem de #${caller.id}: ${text}`)) throw new Error(`#${targetId} não está rodando`)
    // A message from the lead is new work: the helper owes a handoff again.
    if (caller.role === 'lead' && target.role === 'crew' && target.cli !== 'shell') this.assign(target.id, caller.id)
  }

  /** Stops what a helper is doing (Esc, as a person would) and, optionally, gives it new orders. */
  async interrupt(caller: Pane, targetId: number, message: string | null): Promise<void> {
    const target = this.sameMission(caller, targetId)
    if (!this.panes.isAlive(target.id) || target.cli === 'shell') throw new Error(`#${targetId} não é um agente rodando`)
    this.panes.write(target.id, '\x1b')
    this.panes.report(target.id, 'idle', null)
    if (!message?.trim()) return
    await new Promise((resolve) => setTimeout(resolve, INTERRUPT_SETTLE_MS))
    this.assertCurrent(caller)
    this.assertCurrent(target)
    this.sendTo(caller, targetId, message.trim())
  }

  /** Opens a helper again in the same conversation, with a message to carry on; returns the new agent. */
  async resumeHelper(caller: Pane, targetId: number, message: string | null): Promise<Pane> {
    const target = this.sameMission(caller, targetId)
    if (target.role !== 'crew' || target.cli === 'shell') throw new Error(`#${targetId} não é um ajudante`)
    if (this.panes.isAlive(target.id) && (target.status === 'running' || target.status === 'starting')) {
      throw new Error(`#${targetId} está trabalhando. Para mudar o rumo use agent_interrupt; para falar com ele, agent_send.`)
    }
    const pane = await this.restartPane(target.id, true, message?.trim() || 'Continue a tarefa de onde parou. Ao terminar, entregue com handoff_submit.')
    this.assertCurrent(caller)
    this.assign(pane.id, caller.id)
    return this.store.pane(pane.id) ?? pane
  }

  /** The lead declares the objective met: the mission shows as ready and the person is told. */
  pendingDeliveries(missionId: string) {
    return this.store.deliveries(missionId).filter(deliveryPending)
  }

  private currentResult(missionId: string, resultId: string) {
    const history = this.store.activityHistory(missionId)
    const result = history.results.find(r => r.id === resultId)
    const activity = result && history.activities.find(a => a.id === result.activityId)
    const attempt = result && history.attempts.find(a => a.id === result.attemptId)
    if (!result || !activity || !attempt || result.status !== 'done' || activity.state === 'waived' || activity.activeAttemptId !== result.attemptId || activity.revision !== result.activityRevision || history.results.findLast(r => r.attemptId === attempt.id && r.status === 'done')?.id !== result.id) throw new Error('Resultado não é a entrega atual desta atividade; confira tentativa e revisão')
    return { result, activity, attempt }
  }

  private refreshSource(result: ActivityResult) {
    if (!result.source) throw new Error('Resultado sem revisão de código capturada; entregue novamente antes de validar')
    const source = sourceRevision(result.source.roots.map(r => r.root), [this.dataDir])
    if (source.digest !== result.source.digest) throw new Error('O código foi alterado desde a entrega; novo resultado e revisão são necessários')
    return source
  }

  private integrationState(missionId: string) {
    const mission = this.store.mission(missionId)
    const workspace = this.missionWorkspace(missionId)
    if (!mission || !workspace) throw new Error('Missão ou workspace inexistente')
    const source = sourceRevision(copyRoots([mission.git?.leadPath ?? workspace.path, ...workspace.folders.slice(1)]), [this.dataDir])
    const history = this.store.activityHistory(missionId)
    const contracts = history.activities.filter(a => a.verificationRequired && a.state !== 'waived').map(a => [a.id, a.revision, a.contractHash, a.activeAttemptId, history.results.findLast(r => r.attemptId === a.activeAttemptId && r.status === 'done')?.id ?? null])
    return { source, contractDigest: createHash('sha256').update(JSON.stringify([mission.objective, workspace.instructions, contracts])).digest('hex') }
  }

  private acceptedResult(missionId: string, activityId: string, seen = new Set<string>(), currentSource = false): ActivityResult {
    if (seen.has(activityId)) throw new Error('Dependência circular na validação')
    seen.add(activityId)
    const history = this.store.activityHistory(missionId)
    const activity = history.activities.find(a => a.id === activityId)
    const result = activity && history.results.findLast(r => r.attemptId === activity.activeAttemptId && r.status === 'done')
    if (!activity || !result || activity.state === 'waived') throw new Error(`Falta validação da atividade ${activityId}`)
    this.currentResult(missionId, result.id)
    const reviews = this.store.verifications(missionId).filter(v => v.resultId === result.id && v.scope === 'result')
    if (reviews.some(v => v.verdict === 'changes_required')) throw new Error(`Resultado rejeitado da atividade ${activityId} exige nova entrega`)
    const review = reviews.at(-1)
    if (!review || review.verdict !== 'accepted' || review.source.digest !== result.source?.digest) throw new Error(`Falta revisão independente da atividade ${activityId}`)
    if (currentSource) this.refreshSource(result)
    for (const dependency of activity.dependencies ?? []) {
      const upstream = this.acceptedResult(missionId, dependency.activityId, new Set(seen))
      if (upstream.id !== dependency.resultId || upstream.attemptId !== dependency.attemptId || upstream.activityRevision !== dependency.revision) throw new Error('A dependência mudou depois da atribuição; revise o contrato da atividade')
    }
    return result
  }

  inspectResult(caller: Pane, resultId: string, scope: 'result' | 'integration' = 'result') {
    this.assertCurrent(caller)
    const { result, activity } = this.currentResult(caller.missionId, resultId)
    if (!['result', 'integration'].includes(scope)) throw new Error('Escopo de revisão inválido')
    const source = scope === 'result' ? this.refreshSource(result) : this.acceptedResult(caller.missionId, activity.id).source!
    const integration = this.integrationState(caller.missionId)
    const inspection = this.store.saveInspection({ scope, missionId: caller.missionId, resultId, source, integration: integration.source, contractDigest: integration.contractDigest, reviewer: { paneId: caller.id, epoch: caller.executionEpoch!, attemptId: this.store.currentPaneAttempt(caller.id)?.id ?? null } })
    const acceptance = scope === 'result' ? activity.acceptance : this.integrationAcceptance(caller.missionId)
    return { ...inspection, acceptance, result: { summary: result.summary, evidence: result.evidence, details: result.details }, provenance: 'Fingerprint observed by Orbit; check outcomes must be independently reported by the reviewer' }
  }

  private integrationAcceptance(missionId: string): string[] {
    const mission = this.store.mission(missionId)!
    return [`Mission objective: ${mission.objective || mission.title}`, 'All required activity results are integrated and their acceptance criteria remain satisfied in the final source.']
  }

  verifyResult(caller: Pane, input: VerificationInput, readySummary?: string) {
    this.assertCurrent(caller)
    if (readySummary !== undefined) {
      if (caller.role !== 'lead') throw new Error('Só o líder declara a missão pronta')
      if (typeof readySummary !== 'string' || !readySummary.trim() || readySummary.length > 4000) throw new Error('Escreva um resumo de conclusão válido, até 4000 caracteres')
      if (input.verdict !== 'accepted') throw new Error('Conclusão exige um parecer aceito de integração')
    }
    const inspection = this.store.inspection(caller.missionId, input.inspectionId)
    if (!inspection || inspection.reviewer.paneId !== caller.id || inspection.reviewer.epoch !== caller.executionEpoch || inspection.reviewer.attemptId !== (this.store.currentPaneAttempt(caller.id)?.id ?? null)) throw new Error('Inspeção não pertence a esta execução/atribuição')
    if (readySummary !== undefined && inspection.scope !== 'integration') throw new Error('Conclusão conjunta exige escopo de integração')
    const { result, activity, attempt } = this.currentResult(caller.missionId, inspection.resultId)
    if (attempt.paneId === caller.id) throw new Error('Revisão independente exige outro agente: o executor não aceita o próprio resultado')
    if (inspection.scope === 'result' && this.refreshSource(result).digest !== inspection.source.digest) throw new Error('O código mudou depois da inspeção')
    const integration = this.integrationState(caller.missionId)
    if (integration.source.digest !== inspection.integration.digest || integration.contractDigest !== inspection.contractDigest) throw new Error('A integração ou os contratos da missão mudaram depois da inspeção; faça outra inspeção')
    if (inspection.scope === 'integration' && input.verdict === 'accepted' && (this.pendingDeliveries(caller.missionId).length || this.verificationStatus(caller.missionId).some(v => !v.valid))) throw new Error('A revisão final exige todas as atividades entregues e aceitas primeiro')
    validateReview(input, inspection.scope === 'result' ? activity.acceptance : this.integrationAcceptance(caller.missionId))
    if (readySummary !== undefined) {
      const { pending, unverified, integrationReviewed } = this.readiness(caller.missionId, inspection)
      if (pending.length || unverified.length || !integrationReviewed) throw new Error('Conclusão exige todas as atividades e a integração atual aceitas, sem dispensa')
    }
    const alreadyCompleted = readySummary !== undefined && this.store.verifications(caller.missionId).some(v => v.inspectionId === input.inspectionId && v.completion)
    const record = this.store.saveVerification(inspection, result, input, readySummary)
    if (readySummary !== undefined && record.completion) {
      const mission = this.store.mission(caller.missionId)!
      this.broadcast({ type: 'mission.updated', mission: { ...mission } })
      if (!alreadyCompleted) {
        const event = this.store.snapshot().events.find(e => e.id === record.completion!.eventId)
        if (event) this.broadcast({ type: 'event.added', event })
      }
      // A replay can repair a missed memory projection without duplicating its entry.
      this.remember(mission.workspaceId, { id: record.completion.eventId, kind: 'missao', text: `${mission.title}: ${record.completion.summary}`, source: { missionId: mission.id, missionTitle: mission.title, paneId: caller.id } })
    }
    return record
  }

  verificationStatus(missionId: string) {
    return this.store.activityHistory(missionId).activities.filter(a => a.verificationRequired && a.state !== 'waived').map(activity => {
      try { const result = this.acceptedResult(missionId, activity.id); return { activityId: activity.id, resultId: result.id, valid: true, reason: null } }
      catch (error) { return { activityId: activity.id, resultId: null, valid: false, reason: error instanceof Error ? error.message : String(error) } }
    })
  }

  missionProgress(missionId: string): MissionProgress {
    if (!this.store.mission(missionId)) throw new Error('Missão inexistente')
    const history = this.store.activityHistory(missionId)
    const verifications = this.store.verifications(missionId)
    const validation = this.verificationStatus(missionId)
    const managed = history.activities.some(a => a.verificationRequired && a.state !== 'waived' && history.attempts.find(t => t.id === a.activeAttemptId)?.cli !== 'shell')
    const review = verifications.findLast(v => v.scope === 'integration')
    let integration: MissionProgress['integration'] = { state: managed ? 'pending' : 'none', reviewId: review?.id ?? null, checkedAt: null, reason: managed ? 'Falta revisão final da integração.' : 'Sem resultado gerenciado com revisão final obrigatória.' }
    if (review) {
      try {
        const current = this.integrationState(missionId)
        const valid = review.verdict === 'accepted' && review.integration.digest === current.source.digest && review.contractDigest === current.contractDigest && validation.every(v => v.valid) && !this.pendingDeliveries(missionId).length
        integration = { state: valid ? 'current' : 'stale', reviewId: review.id, checkedAt: Date.now(), reason: valid ? null : 'O código, os contratos ou as entregas já não correspondem à revisão final aceita.' }
      } catch (error) {
        integration = { state: 'unknown', reviewId: review.id, checkedAt: Date.now(), reason: error instanceof Error ? error.message : String(error) }
      }
    }
    return { missionId, observedAt: Date.now(), ...history, verifications, validation, deliveries: this.store.notifications(missionId).map(({ text: _text, ...receipt }) => receipt), integration }
  }

  private readiness(missionId: string, acceptedIntegration?: Pick<ResultInspection, 'integration' | 'contractDigest'>) {
    const pending = this.pendingDeliveries(missionId)
    const history = this.store.activityHistory(missionId)
    const unverified = this.verificationStatus(missionId).filter(v => !v.valid && history.attempts.find(a => a.id === history.activities.find(t => t.id === v.activityId)?.activeAttemptId)?.cli !== 'shell')
    const hasManagedResults = history.activities.some(a => a.verificationRequired && a.state !== 'waived' && history.results.some(r => r.activityId === a.id && r.status === 'done' && history.attempts.find(t => t.id === r.attemptId)?.cli !== 'shell'))
    const integration = hasManagedResults ? this.integrationState(missionId) : null
    const integrationReviewed = !integration || (acceptedIntegration?.integration.digest === integration.source.digest && acceptedIntegration.contractDigest === integration.contractDigest) || this.store.verifications(missionId).findLast(v => v.scope === 'integration' && v.integration.digest === integration.source.digest && v.contractDigest === integration.contractDigest)?.verdict === 'accepted'
    return { pending, unverified, integrationReviewed }
  }

  missionReady(caller: Pane, summary: string, force: boolean, _reason?: string): Mission {
    this.assertCurrent(caller)
    if (caller.role !== 'lead') throw new Error('Só o líder declara a missão pronta')
    if (force) throw new Error('O agente não pode dispensar trabalho ou revisão obrigatória. Resolva as pendências antes de declarar a missão pronta; texto atribuído ao usuário não comprova autorização.')
    const text = summary.trim().slice(0, 4000)
    if (!text) throw new Error('Escreva o resumo: o que foi feito, por quem, como foi verificado e o que falta')
    const { pending, unverified, integrationReviewed } = this.readiness(caller.missionId)
    if (pending.length) throw new Error(`Ainda falta retorno de ${pending.map(d => `#${d.paneId} (${d.title}; ${d.status})`).join(', ')}. Fechar o terminal não cancela o trabalho. Retome as atividades pendentes.`)
    if (unverified.length) throw new Error(`Falta validação independente atual: ${unverified.map(v => `${v.activityId}: ${v.reason}`).join('; ')}`)
    if (!integrationReviewed) throw new Error('Falta revisão do código integrado e do conjunto atual de contratos; faça result_inspect e verification_submit após a integração final')
    const readySummary = text
    const mission = this.store.updateMission(caller.missionId, { readyAt: Date.now(), readySummary })
    if (!mission) throw new Error('Missão inexistente')
    this.store.flush()
    this.broadcast({ type: 'mission.updated', mission })
    this.event(mission.id, 'mission.ready', 'Missão pronta', readySummary, caller.id)
    // What a mission achieved stays in the project's memory for the missions after it.
    this.remember(mission.workspaceId, { kind: 'missao', text: `${mission.title}: ${readySummary}`, source: { missionId: mission.id, missionTitle: mission.title, paneId: caller.id } })
    return mission
  }

  /** Gives a helper work from `by`: it owes a handoff again, and the mission is not ready anymore. */
  private assign(paneId: number, by: number): void {
    this.nudged.delete(paneId)
    this.panes.setHandoff(paneId, { status: null, assignedBy: by })
    const pane = this.store.pane(paneId)
    const mission = pane && this.store.mission(pane.missionId)
    if (mission?.readyAt) {
      const updated = this.store.updateMission(mission.id, { readyAt: null, readySummary: null })
      if (updated) this.broadcast({ type: 'mission.updated', mission: updated })
    }
    if (pane) this.store.assignDelivery(pane, this.acceptance.get(paneId) ?? [])
  }

  /** Role instructions are installed once at launch, never repeated in user messages. */
  private submitTo(paneId: number, text: string): boolean {
    const pane = this.store.pane(paneId)
    const accepted = this.panes.submitWithReceipt(paneId, text, () => { if (pane?.executionEpoch) this.measurements?.wakeup(pane.executionEpoch) })
    if (accepted && pane?.executionEpoch) this.measurements?.bytes(pane.executionEpoch, 'submittedBytes', text)
    return accepted
  }

  /** A helper someone gave work to and that has not reported back yet. */
  private owesHandoff(pane: Pane): boolean {
    return pane.role === 'crew' && pane.cli !== 'shell' && pane.assignedBy !== null && (pane.handoffStatus === null || pane.handoffStatus === 'progress')
  }

  /** Types a line into the terminal of whoever gave this helper its work (or the lead). */
  private tellAssigner(pane: Pane, text: string): number | null {
    const alive = (p: Pane | undefined) => p && p.id !== pane.id && this.panes.isAlive(p.id) ? p : undefined
    const to = alive(pane.assignedBy !== null ? this.store.pane(pane.assignedBy) : undefined)
      ?? alive(this.missionPanes(pane.missionId).find((p) => p.role === 'lead'))
    if (!to) return null
    this.submitTo(to.id, text)
    return to.id
  }

  /**
   * A helper ended its turn. If it still owes a handoff, it is asked to deliver once (Claude: the
   * Stop hook blocks; Codex: a message in its terminal); the next time, Orbit delivers its last
   * message for it, so whoever waits is never left hanging. Returns the reason to block, if any.
   */
  private turnEnded(pane: Pane, lastMessage: string | null, canBlock: boolean): string | null {
    // Out of budget, stopping is what we want: no chasing for a handoff.
    if (!this.owesHandoff(pane) || this.budgetBlocks(pane.missionId)) return null
    // A progress checkpoint may end a turn, but the durable obligation still gates completion.
    if (pane.handoffStatus === 'progress') return null
    if (canBlock) return HANDOFF_NUDGE
    if (pane.cli !== 'shell' && !AGENT_INFO[pane.cli].hooks && !this.nudged.has(pane.id)) {
      this.nudged.add(pane.id)
      this.panes.submit(pane.id, `[Orbit] ${HANDOFF_NUDGE}`)
      return null
    }
    const said = oneLine(lastMessage?.trim() || this.panes.screenText(pane.id, 20)).slice(-1500) || '(nada na tela)'
    const committed = this.store.commitActivityResult(pane, { status: 'auto', summary: said, evidence: '', details: '', deliveredTo: pane.assignedBy }, { title: `Retorno de #${pane.id} (automático)`, body: `#${pane.id} encerrou o turno sem handoff_submit. Última mensagem:\n\n${said}` }, `[Orbit] #${pane.id} (${pane.title}) encerrou o turno sem entregar. Última mensagem dele: ${said} (Confira a evidência antes de aceitar.)`)
    this.panes.setHandoff(pane.id, { status: 'auto' })
    if (committed.event) this.broadcast({ type: 'event.added', event: committed.event })
    if (committed.duplicate) return null
    this.dispatchDeliveries(pane.missionId)
    return null
  }

  /** The lead closes a helper of its own mission (kills the process, removes the pane). */
  closeHelper(caller: Pane, targetId: number, force = false): void {
    const target = this.sameMission(caller, targetId)
    if (caller.role === 'crew' && target.assignedBy !== caller.id) throw new Error('Você só fecha os seus sub-ajudantes')
    if (!force && target.deliveredAt === null && target.assignedBy !== null && this.panes.isAlive(target.id) && target.cli !== 'shell') {
      throw new Error(`#${targetId} ainda não entregou o retorno. Espere: ele chega sozinho no seu terminal. Se o ajudante travou de verdade, confira com agent_read e feche com force: true.`)
    }
    if (target.role === 'lead') throw new Error('O líder não pode ser fechado por aqui')
    this.closePane(target.id)
  }

  readScreen(caller: Pane, targetId: number, lines: number): string {
    const target = this.sameMission(caller, targetId)
    return this.panes.screenText(target.id, lines)
  }

  /**
   * A helper's report. Done and blocked are delivered: typed into the terminal of whoever gave it the
   * work (or `to`, another agent of the mission) and recorded in the flow. Progress is only recorded,
   * so the lead is not woken for it. Done needs evidence of how it was verified.
   */
  handoff(caller: Pane, input: { summary: string; attemptId?: string; details?: string; status?: HandoffStatus; evidence?: string; to?: number | null; criteria?: Array<{ item: number; met: boolean; how: string }> }): { deliveredTo: number | null; status: HandoffStatus; resultId: string; duplicate: boolean } {
    this.assertCurrent(caller)
    if (input.attemptId !== undefined && input.attemptId !== this.store.currentPaneAttempt(caller.id)?.id) throw new Error('O resultado pertence a uma tentativa anterior; confira whoami e a atribuição atual.')
    const status = input.status ?? 'done'
    if (!HANDOFF_STATUSES.includes(status)) throw new Error(`Status inválido: ${status}`)
    let text = input.summary.trim().slice(0, 2000)
    if (!text) throw new Error('O resumo do retorno está vazio')
    const evidence = (input.evidence ?? '').trim().slice(0, 4000)
    if (status === 'done' && !evidence) throw new Error('Diga em evidence como verificou: comandos rodados e o resultado, testes, arquivos conferidos. Se não deu para verificar, entregue com status blocked e explique o que falta.')
    // The acceptance contract: done answers every criterion, and all of them hold.
    const accept = this.acceptance.get(caller.id) ?? this.store.delegations(caller.missionId).find((d) => d.pane.id === caller.id)?.acceptance ?? []
    const answers = new Map((input.criteria ?? []).map((c) => [c.item, c]))
    if (status === 'done' && accept.length) {
      const missing = accept.map((_, i) => i + 1).filter((n) => !answers.has(n))
      if (missing.length) throw new Error(`Responda em criteria a cada critério de aceite (falta${missing.length > 1 ? 'm' : ''} ${missing.join(', ')}): ${accept.map((c, i) => `${i + 1}. ${c}`).join('; ')}`)
      const unmet = accept.map((_, i) => i + 1).filter((n) => !answers.get(n)!.met)
      if (unmet.length) throw new Error(`O critério ${unmet.join(', ')} não foi cumprido. Termine antes de entregar done, ou entregue com status blocked dizendo o que impede.`)
    }
    const criteria = accept.length && answers.size ? accept.map((c, i) => `${answers.get(i + 1)?.met ? '✓' : '✗'} ${i + 1}. ${c}${answers.get(i + 1)?.how ? `: ${answers.get(i + 1)!.how.trim().slice(0, 300)}` : ''}`).join('\n') : ''
    const git = this.store.mission(caller.missionId)?.git
    if (git && caller.branch && caller.branch !== git.branch && status !== 'progress') {
      const dirty = safe(() => dirtyFiles(this.worktreeOf(caller, git)), [])
      const ahead = safe(() => commitsAhead(git.repo, git.branch, caller.branch!).length, 0)
      const notes = [
        ahead ? `branch ${caller.branch} com ${ahead} commit(s) para integrar (git merge ${caller.branch})` : `branch ${caller.branch} sem commits novos`,
        dirty.length ? `atenção: ${dirty.length} arquivo(s) sem commit no branch dele` : null,
      ].filter(Boolean)
      text = `${text} [${notes.join('; ')}]`
    }
    // `to` naming whoever is waiting anyway (the lead) is a plain delivery.
    const named = input.to != null && input.to !== caller.assignedBy ? this.sameMission(caller, input.to) : undefined
    const target = named?.role === 'lead' ? undefined : named
    const label = HANDOFF_LABEL[status]
    const details = (input.details ?? '').trim().slice(0, 20000)
    const body = [text, evidence && `Evidência: ${evidence}`, criteria && `Critérios de aceite:\n${criteria}`, details].filter(Boolean).join('\n\n')
    const title = `Retorno de #${caller.id} (${label})${target ? ` para #${target.id}` : ''}`
    const deliveredTo = status === 'progress' && !target ? null : target?.id ?? caller.assignedBy
    const met = accept.length && answers.size ? ` · critérios: ${accept.filter((_, i) => answers.get(i + 1)?.met).length}/${accept.length}` : ''
    const line = `${oneLine(text)}${evidence ? ` · evidência: ${oneLine(evidence).slice(0, 600)}` : ''}${met}${details || criteria ? ' (detalhes em handoff_list)' : ''}`
    const notificationText = `[Orbit] Retorno de #${caller.id} (${caller.title})${target ? ' para você' : ''}, ${label}: ${line}`
    const policy = this.store.executionPolicy(caller.id)
    const source = status === 'done' && caller.cli !== 'shell' ? sourceRevision(policy?.roots ?? copyRoots([caller.cwd]), [this.dataDir]) : undefined
    const committed = this.store.commitActivityResult(caller, { status, summary: text, evidence, details: [criteria, details].filter(Boolean).join('\n\n'), deliveredTo, ...(source ? { source } : {}) }, { title, body }, notificationText)
    const resultId = committed.result.id
    this.dispatchDeliveries(caller.missionId)
    if (committed.duplicate) return { deliveredTo, status, resultId, duplicate: true }
    if (committed.event) this.broadcast({ type: 'event.added', event: committed.event })
    this.panes.setHandoff(caller.id, { status })
    if (status === 'progress' && !target) return { deliveredTo: null, status, resultId, duplicate: false }

    if (target) {
      const mission = this.store.mission(caller.missionId)
      if (mission) this.broadcast({ type: 'mission.updated', mission })
      // Work handed on (to a reviewer, say) is owed back by that agent to whoever leads it.
      if (target.role === 'crew' && target.cli !== 'shell') this.assign(target.id, target.assignedBy ?? caller.assignedBy ?? caller.id)
      return { deliveredTo: target.id, status, resultId, duplicate: false }
    }
    return { deliveredTo: this.missionPanes(caller.missionId).find(p => p.role === 'lead' && this.panes.isAlive(p.id))?.id ?? null, status, resultId, duplicate: false }
  }

  /** Claude's status line, forwarded by the agent: usage, context and account limits. */
  statusReport(paneId: number, payload: unknown, executionEpoch?: string): void {
    if (executionEpoch !== undefined) this.assertCurrent({ ...this.store.pane(paneId)!, id: paneId, executionEpoch })
    const normalized = claudeStatus(payload)
    if (normalized.sessionId) this.panes.setSession(paneId, normalized.sessionId)
    const pane = this.store.pane(paneId)
    const snapshot = pane && this.claudeConsumption(pane)
    if (snapshot) normalized.report = fromClaudeStatus({ ...(payload as Record<string, unknown>), orbit_session_usage: { ...snapshot.usage, format: 'claude-transcript-v1', complete: snapshot.complete } })
    this.applyReport(paneId, normalized.report, 'status', snapshot ? { models: [...new Set([...snapshot.models, ...normalized.identity.models])], efforts: normalized.identity.efforts, level: 'response', complete: false } : normalized.identity)
  }

  private claudeConsumption(pane: Pane) {
    if (pane.cli !== 'claude' || !pane.sessionId || !SESSION_ID.test(pane.sessionId)) return null
    try {
      const account = pane.accountId ? this.store.account(pane.accountId) : undefined
      const file = claudeTranscript((account && this.accountFiles.configDir(account)) ?? userConfigDir('claude'), pane.sessionId)
      return file ? this.claudeUsage.read(file) : null
    } catch { return null }
  }

  private applyClaudeConsumption(pane: Pane): void {
    const snapshot = this.claudeConsumption(pane)
    if (snapshot) this.applyReport(pane.id, fromClaudeStatus({ orbit_session_usage: { ...snapshot.usage, format: 'claude-transcript-v1', complete: snapshot.complete } }), 'status', { models: snapshot.models, efforts: [], level: 'response', complete: false })
  }

  private pollClaude(): void {
    for (const pane of this.store.snapshot().panes.filter(p => p.cli === 'claude' && this.panes.isAlive(p.id))) this.applyClaudeConsumption(pane)
  }

  /** Counts what an agent used since its last report, and records the account's limits. */
  private applyReport(paneId: number, report: UsageReport, source: 'status' | 'rollout' = 'status', identity?: ExecutionIdentity): void {
    const pane = this.store.pane(paneId)
    if (!pane) return
    if (report.limits) this.broadcast({ type: 'limits', limits: this.store.setLimits({ ...report.limits, accountId: pane.accountId ?? report.limits.cli }) })
    if (identity?.models.length) this.panes.setReportedModels(paneId, identity.models)
    if (!report.usage && report.contextPercent === null) return
    let usage = report.usage
    if (usage && pane.cli !== 'shell') {
      const accounted = this.store.accountSessionUsage(pane, usage, source, Date.now(), { mode: this.harnessMode, origin: report.origin, observed: report.observed, reportedModels: identity?.models ?? [], reportedEffort: identity?.efforts.length === 1 ? identity.efforts[0]! : null, identityComplete: identity?.complete === true, identityLevel: identity?.level ?? 'unknown' })
      this.measurements?.report(pane.executionEpoch!, accounted.delta, source, report.observed, report.origin)
      usage = accounted.usage
      const added = accounted.added
      if (added) {
        this.broadcast({ type: 'mission.updated', mission: this.checkBudget(added.mission) })
        this.broadcast({ type: 'usage.day', day: added.day })
      }
    }
    this.panes.setUsage(paneId, usage, report.contextPercent)
  }

  /** Codex has no hooks: read each live Codex agent's session file for its totals. */
  private pollCodex(): void {
    const live = this.store.snapshot().panes.filter((p) => p.cli === 'codex' && this.panes.isAlive(p.id))
    for (const pane of live) {
      try {
        let file = this.codexRollouts.get(pane.id)
        if (!file) {
          const account = pane.accountId ? this.store.account(pane.accountId) : undefined
          const home = (account && this.accountFiles.configDir(account)) ?? codexHome()
          // A resumed conversation keeps writing to its own file, named after the session.
          file = (pane.sessionId && findCodexRolloutById(home, pane.sessionId)) || findCodexRollout(home, pane.cwd, pane.createdAt, new Set(this.codexRollouts.values())) || undefined
          if (!file) continue
          this.codexRollouts.set(pane.id, file)
          const sessionId = codexSessionId(file)
          if (sessionId) this.panes.setSession(pane.id, sessionId)
        }
        const tail = readTail(file)
        const owned = this.store.pane(pane.id)
        const consumption = owned?.sessionId ? this.codexUsage.read(file, owned.sessionId) : null
        const report = consumption?.report ?? codexRollout(tail).report
        if (!consumption && report.observed) for (const key of ['input', 'output', 'total', 'cacheRead', 'cacheWrite'] as const) report.observed[key] = false
        this.applyReport(pane.id, report, 'rollout', consumption?.identity)
        this.codexTurn(pane, tail)
      } catch {
        // the file may be mid-write; try again on the next tick
      }
    }
  }

  /** Each new `task_complete` in a Codex helper's session file is the end of its turn. */
  private codexTurn(pane: Pane, tail: string): void {
    this.assertCurrent(pane)
    const turn = codexRollout(tail).turn
    if (!turn?.done) return
    const epoch = pane.executionEpoch!
    if (!freshCodexTurn(turn, pane.createdAt, this.store.adapterTurn(epoch))) return
    const current = this.store.pane(pane.id)
    if (current) this.turnEnded(current, turn.lastMessage, false)
    this.store.recordAdapterTurn(epoch, turn)
  }

  private watchCodex(): void {
    if (this.codexTimer) return
    this.codexTimer = setInterval(() => { this.pollCodex(); this.pollClaude() }, CODEX_POLL_MS)
    this.codexTimer.unref()
  }

  // ---- the mission's browser ----

  /** Agents open pages in their mission's browser; the person sees the same page. */
  async browserOpen(caller: Pane, url: string) {
    this.activeMission(caller.missionId)
    const state = await this.browser.navigate(caller.missionId, url, `#${caller.id}`)
    this.event(caller.missionId, 'browser', `#${caller.id} abriu uma página`, state.url, caller.id)
    return state
  }

  browserScreenshot(caller: Pane): Promise<string> {
    return this.browser.screenshot(caller.missionId)
  }

  browserText(caller: Pane, maxChars: number) {
    return this.browser.text(caller.missionId, maxChars)
  }

  browserClick(caller: Pane, target: { x: number; y: number } | { selector: string }) {
    return this.browser.click(caller.missionId, target, `#${caller.id}`)
  }

  async browserType(caller: Pane, text: string, submit: boolean): Promise<void> {
    await this.browser.type(caller.missionId, text, `#${caller.id}`)
    if (submit) await this.browser.key(caller.missionId, 'Enter', `#${caller.id}`)
  }

  browserKey(caller: Pane, key: string): Promise<void> {
    return this.browser.key(caller.missionId, key, `#${caller.id}`)
  }

  browserScroll(caller: Pane, dy: number): Promise<void> {
    return this.browser.scroll(caller.missionId, 640, 400, dy)
  }

  browserConsole(caller: Pane, lines: number): string[] {
    return this.browser.consoleLines(caller.missionId, lines)
  }

  /** Clicks, scrolls and keys from the person's view of the page. */
  private async browserInput(missionId: string, input: BrowserInput): Promise<void> {
    switch (input.kind) {
      case 'click':
        await this.browser.click(missionId, { x: input.x, y: input.y }, 'você')
        return
      case 'scroll':
        await this.browser.scroll(missionId, input.x, input.y, input.dy)
        return
      case 'type':
        await this.browser.type(missionId, input.text, 'você')
        return
      case 'key':
        await this.browser.key(missionId, input.key, 'você')
        return
    }
  }

  private activeMission(missionId: string): Mission {
    const mission = this.store.mission(missionId)
    if (!mission || mission.status !== 'active') throw new Error('Missão inexistente ou arquivada')
    return mission
  }

  /** Status from Claude's hooks; for PreToolUse, a refusal when the tool is switched off. */
  hookReport(paneId: number, payload: HookPayload, executionEpoch?: string): object | null {
    if (executionEpoch !== undefined) this.assertCurrent({ ...this.store.pane(paneId)!, id: paneId, executionEpoch })
    // Gemini CLI's hooks speak a dialect of Claude Code's: translated in, answered back in its terms.
    if (this.store.pane(paneId)?.cli === 'gemini') return geminiAnswer(this.handleHook(paneId, geminiHook(payload).payload))
    return this.handleHook(paneId, claudeHook(payload).payload)
  }

  private handleHook(paneId: number, payload: HookPayload): object | null {
    const stopping = payload.hook_event_name === 'Stop' ? this.store.pane(paneId) : undefined
    if (stopping) {
      const reason = this.turnEnded(stopping, payload.last_assistant_message ?? null, payload.stop_hook_active !== true)
      if (reason) return { decision: 'block', reason }
    }
    const next = statusFromHook(payload)
    if (next) this.panes.report(paneId, next.status, next.attention)
    const pane = this.store.pane(paneId)
    if (pane) this.noteEdit(pane, payload)
    if (typeof payload.session_id === 'string' && SESSION_ID.test(payload.session_id)) this.panes.setSession(paneId, payload.session_id)
    if (pane && payload.hook_event_name === 'PreToolUse' && this.budgetBlocks(pane.missionId)) {
      return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'O orçamento desta missão no Orbit acabou. Pare aqui e diga ao usuário, em poucas linhas, o que foi feito e o que falta; ele pode aumentar o orçamento para você continuar.' } }
    }
    if (pane && this.readOnly.has(pane.id) && payload.hook_event_name === 'PreToolUse' && EDIT_TOOLS.includes(payload.tool_name ?? '')) {
      return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'Esta tarefa é só de leitura: não edite arquivos. Aponte o que mudar na sua entrega.' } }
    }
    // Role is installed at launch; enforce editing restrictions without reinjecting its prompt.
    const mission = pane && pane.role === 'lead' ? this.store.mission(pane.missionId) : undefined
    if (mission && (mission.mode === 'agentica' || mission.mode === 'squad')) {
      if (payload.hook_event_name === 'PreToolUse' && EDIT_TOOLS.includes(payload.tool_name ?? '')) {
        return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'Você é o maestro desta missão e não edita arquivos. Abra um ajudante com agent_spawn para essa mudança.' } }
      }
    }
    const reason = gateTool(payload, new Set(this.store.disabledCatalog()), this.skillPolicies.get(paneId))
    return reason ? { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } } : null
  }

  async shutdown(): Promise<void> {
    if (this.shutdownTask) return this.shutdownTask
    this.stopping = true
    this.store.prepareShutdown()
    clearInterval(this.deliveryTimer)
    if (this.codexTimer) clearInterval(this.codexTimer)
    if (this.scheduleTimer) clearInterval(this.scheduleTimer)
    if (this.usageTimer) clearInterval(this.usageTimer)
    this.browser.shutdown()
    this.panes.killAll()
    this.store.flush()
    this.shutdownTask = this.panes.waitForExit()
    await this.shutdownTask
    // Exit listeners can schedule a final metadata save. Flush it before another Store opens
    // this directory, so an old debounce cannot overwrite the recovered state.
    this.store.flush()
  }

  // ---- internals ----

  private async prepareDesignContext(input: Pick<SpawnPaneRequest, 'missionId' | 'cli' | 'title' | 'task' | 'role'>): Promise<void> {
    if (input.cli === 'shell' || input.role !== 'crew' || !designWork(`${input.title} ${input.task ?? ''}`)) return
    const workspace = this.missionWorkspace(input.missionId)
    if (workspace) this.designContexts.set(JSON.stringify(workspace.folders), await projectDesignContext(workspace.folders))
  }

  /** `resume` continues that conversation of the CLI; `opened` replaces the flow's "Agente #N aberto". */
  private spawn(input: SpawnPaneRequest, options: { resume?: string; opened?: (id: number) => string; worktree?: { path: string; branch: string }; receipt?: string[]; boss?: Pane; children?: number; id?: number; attemptId?: string; explicitCli?: AgentCli; tier?: { difficulty: Difficulty; by: string }; keep?: AgentSeat; requireReadOnlySandbox?: boolean; decisionSource?: DecisionReceipt['source']; harnessTask?: { difficulty: Difficulty; retry: boolean } } = {}): Pane {
    if (this.stopping) throw new Error('Orbit está encerrando; novas execuções não são admitidas')
    const receipt = options.receipt ?? []
    const mission = this.store.mission(input.missionId)
    if (!mission || mission.status !== 'active') throw new Error('Missão inexistente ou arquivada')
    if (mission.budget?.exceeded && input.cli !== 'shell') throw new Error('O orçamento desta missão acabou; aumente-o para abrir agentes')
    const workspace = this.store.workspace(mission.workspaceId)
    if (!workspace) throw new Error('Workspace da missão sumiu')

    // A squad role, or a row of the task table, decides who fills the seat: CLI, model, effort.
    const squad = this.missionSquad(mission.id)
    const routing = this.store.routing()
    const requiresSandbox = options.requireReadOnlySandbox ?? input.requireReadOnlySandbox ?? false
    let squadRole: Squad['roles'][number] | undefined
    let taskType: TaskType | undefined
    if (input.squadRoleId) {
      squadRole = squad?.roles.find((r) => r.id === input.squadRoleId)
      if (!squadRole) throw new Error(`Papel "${input.squadRoleId}" não existe no squad desta missão`)
    } else if (input.taskTypeId) {
      taskType = routing.taskTypes.find((t) => t.id === input.taskTypeId)
      if (!taskType) throw new Error(`Tipo de tarefa "${input.taskTypeId}" não existe na tabela`)
    }
    const request: SpawnPaneRequest = squadRole
      ? { ...input, role: 'crew', cli: squadRole.cli, model: squadRole.model, effort: null }
      : taskType
        ? { ...input, role: 'crew', cli: taskType.cli, model: taskType.model, effort: taskType.effort }
        : { ...input }
    let fallbackUsed = false
    if (options.explicitCli && request.cli !== options.explicitCli) {
      request.cli = options.explicitCli
      const equivalent = taskType?.alt?.cli === request.cli ? taskType.alt : null
      request.model = equivalent?.model ?? null
      request.effort = equivalent?.effort ?? null
    }
    // Explicit choices override routing defaults, including when kind is supplied.
    if (input.model) request.model = input.model
    if (input.effort) request.effort = input.effort
    if (requiresSandbox && !adapterCapabilities(request.cli).supports.readOnlySandbox) {
      if (options.explicitCli || input.model || !mission.allowedClis.includes('codex')) throw new Error('A escolha explícita não oferece o sandbox somente leitura exigido; escolha uma CLI compatível')
      request.cli = 'codex'; request.model = null; request.effort = input.effort ?? null
      fallbackUsed = true
      receipt.push('capacidade: sandbox somente leitura exige Codex no adapter atual')
    }
    if (request.role === 'crew' && request.cli !== 'shell' && !mission.allowedClis.includes(request.cli) && (options.explicitCli || input.model || input.accountId || options.keep)) throw new Error('A CLI escolhida explicitamente não está permitida nesta missão')
    // Reopening an agent keeps the seat it really had (balancing and difficulty already decided it).
    if (options.keep) Object.assign(request, { cli: options.keep.cli, model: options.keep.model, effort: options.keep.effort })
    if (requiresSandbox && !adapterCapabilities(request.cli).supports.readOnlySandbox) throw new Error('A CLI retomada não oferece o sandbox somente leitura exigido')
    if (!CLIS.includes(request.cli)) throw new Error(`Agente inválido: ${request.cli}`)
    if (request.model && (typeof request.model !== 'string' || !MODEL_ID.test(request.model))) throw new Error('Modelo inválido: use letras, números, ponto, hífen, barra ou dois-pontos')
    if (request.effort && !EFFORTS.includes(request.effort)) throw new Error(`Esforço inválido: ${request.effort}`)

    const catalogRevision = this.catalog ? createHash('sha256').update(JSON.stringify(this.catalog)).digest('hex') : null
    const harnessReadOnly = !!(input.readOnly || requiresSandbox || taskType?.readOnly || squadRole?.readOnly)
    const eligibleAccounts = harnessAccounts(this.store.accounts(), [...this.accountStatus.values()], this.store.limits())
    const harnessExplicit = !!(options.explicitCli || input.model || input.effort || input.accountId || input.squadRoleId || taskType?.automatic === false || (taskType && taskType.automatic !== true) || options.keep)
    const classified = options.harnessTask && !taskType ? classifyTask(`${input.title}\n${input.task ?? ''}`, routing.taskTypes, input.title ?? '') : null
    const harness = options.harnessTask ? selectHarnessCandidate(
      composeHarness({
        kind: taskType?.id ?? (classified?.sure ? classified.type.id : null),
        ...options.harnessTask, readOnly: harnessReadOnly, requireReadOnlySandbox: requiresSandbox,
        constraintRevision: createHash('sha256').update(JSON.stringify({ routing, squadRole, allowed: mission.allowedClis, instructions: workspace.instructions, settings: this.store.settings() })).digest('hex'),
      }),
      harnessCandidates(this.catalog, [...this.clis.values()], eligibleAccounts, mission.allowedClis, requiresSandbox),
      harnessExplicit || taskType?.alt?.pinned ? [] : this.store.harnessEvidence(),
      { explicit: harnessExplicit },
    ) : undefined
    const work = request.role === 'crew' && !['operacao', 'documentacao'].includes(taskType?.id ?? '') ? designWork(`${taskType?.id ?? ''} ${input.title} ${input.task ?? ''}`) : null
    const automatic = !harnessExplicit && (!harness?.selected || work) && request.role === 'crew' && (taskType || work) && this.catalog
      ? automaticTaskSeat({ catalog: this.catalog, preferred: { cli: request.cli as AgentCliForRole, model: request.model, effort: request.effort ?? null }, alternate: taskType?.alt, difficulty: options.harnessTask?.difficulty ?? options.tier?.difficulty ?? 'normal', design: work, allowed: mission.allowedClis.filter(cli => !requiresSandbox || adapterCapabilities(cli).supports.readOnlySandbox), rooms: cli => this.rooms(cli, this.liveByAccount()).filter(r => this.accountStatus.get(r.account.id)?.loggedIn === true && !this.accountStatus.get(r.account.id)?.busy) }) : null
    // Once a catalog is available, autonomous staffing needs a valid quota and compatible model.
    if (!harnessExplicit && request.role === 'crew' && (taskType || work) && !automatic && (!harness?.selected || work)) throw new Error('Roteamento automático: nenhuma conta com quota válida e modelo compatível. Atualize os limites em Contas ou escolha uma conta explicitamente.')
    const measured = work ? automatic : harness?.selected ?? automatic
    if (measured) Object.assign(request, { cli: measured.cli, model: measured.model, effort: measured.effort })
    if (harness) receipt.push(...harness.reasons)
    if (automatic) {
      const seat = taskType?.alt?.cli === automatic.cli ? taskType.alt : taskType
      receipt.push(`roteamento por quota válida e compatibilidade${work ? ` · política ${work}` : ''}: ${automatic.cli} · ${automatic.model} · ${automatic.effort}`)
      receipt.push(`motivo do assento: ${seat && 'pinned' in seat && seat.pinned ? `equivalente fixado pelo usuário${seat.model === null ? ' · padrão da CLI resolvido pelo catálogo/configuração' : ''}` : work ? `política ${work}` : `dificuldade ${options.harnessTask?.difficulty ?? options.tier?.difficulty ?? 'normal'} · base ${seat?.model ?? 'herdada'}; tarefa simples usa patamar econômico, difícil até alto`}`)
    }

    // The maestro's seat: the CLI the mission allows and the account with the most room, moving to
    // the other CLI when every account of the first one is used up.
    let chosen: Account | null = null
    if (request.cli !== 'shell' && !request.accountId) {
      const allowedHere = mission.allowedClis
      // The row's equivalent on another CLI, when the mission allows it.
      const alt = taskType?.alt && allowedHere.includes(taskType.alt.cli) && (!requiresSandbox || adapterCapabilities(taskType.alt.cli).supports.readOnlySandbox) ? taskType.alt : null
      const move = (to: AgentCliForRole, why: string) => {
        if (requiresSandbox && !adapterCapabilities(to).supports.readOnlySandbox) throw new Error('O fallback não oferece o sandbox somente leitura exigido')
        fallbackUsed = true
        receipt.push(`${CLI_LABEL[request.cli]} → ${CLI_LABEL[to]}: ${why}`)
        request.cli = to
        if (alt && alt.cli === to) {
          // The table says what this work runs as there.
          request.model = alt.model
          request.effort = alt.effort
          return
        }
        request.model = null
        // Keep the effort only if the other CLI's default model takes it.
        if (request.effort && !effortsFor(this.catalog, to, null).includes(request.effort)) request.effort = null
      }
      if (!allowedHere.includes(request.cli) && allowedHere[0] && request.role !== 'lead') {
        if (options.explicitCli || input.model) throw new Error('A CLI escolhida explicitamente não está permitida nesta missão')
        move(alt?.cli ?? allowedHere[0], 'a missão não usa essa CLI')
      }
      const live = this.liveByAccount()
      // Fair share: when the table's CLI is much busier than the equivalent's, the equivalent takes it.
      if (!measured && alt && !harnessExplicit && request.role !== 'lead' && request.cli !== alt.cli && taskType && request.cli === taskType.cli) {
        const here = cliLoad(this.rooms(request.cli, live))
        const there = cliLoad(this.rooms(alt.cli, live))
        if (there !== null && (here === null || here - there >= BALANCE_GAP)) {
          move(alt.cli, `${CLI_LABEL[request.cli]} com carga ${Math.round(here ?? 100)}, ${CLI_LABEL[alt.cli]} com ${Math.round(there)} (uso da conta + ${LIVE_WEIGHT} por agente rodando): foi para o equivalente da tabela`)
        }
      }
      let choice = chooseAccount(this.rooms(request.cli as AgentCliForRole, live).filter(room => !measured || (room.used !== null && !room.full && this.accountStatus.get(room.account.id)?.loggedIn === true && !this.accountStatus.get(room.account.id)?.busy)))
      // Used up: the next CLI the mission allows that is installed and has room.
      if ((choice.exhausted || choice.account?.kind === 'api') && !measured && !harnessExplicit && request.role !== 'lead') {
        // The table's equivalent first, then any other CLI the mission allows.
        const others = allowedHere.filter((c) => c !== request.cli && (!requiresSandbox || adapterCapabilities(c).supports.readOnlySandbox)).sort((a, b) => Number(b === alt?.cli) - Number(a === alt?.cli))
        // Exhaust subscriptions across allowed providers before using a paid API account.
        for (const other of others) {
          const next = chooseAccount(this.rooms(other, live).filter(room => room.account.kind === 'assinatura'))
          if (next.exhausted) continue
          move(other, `todas as contas do ${CLI_LABEL[request.cli]} estão no limite`)
          choice = next
          break
        }
        if (choice.exhausted) for (const other of others) {
          const next = chooseAccount(this.rooms(other, live))
          if (next.exhausted) continue
          move(other, 'nenhuma assinatura disponível; conta de API habilitada para uso automático')
          choice = next
          break
        }
      }
      if (choice.exhausted || !choice.account) {
        const back = choice.backAt ? ` A primeira volta ${untilText(choice.backAt)}.` : ''
        throw new Error(`Não há conta do ${CLI_LABEL[request.cli]} com folga para abrir o agente: ${choice.reason}.${back}`)
      }
      chosen = choice.account
      receipt.push(`conta: ${choice.reason}`)
    }
    // The difficulty moves the seat within the chosen CLI: a cheaper model or a stronger one.
    if (chosen?.kind === 'api' && chosen.model && !input.model) request.model = chosen.model
    if (!measured && (!harnessExplicit || request.role === 'lead') && options.tier && request.cli !== 'shell' && !(chosen?.kind === 'api' && chosen.model)) {
      const seat = seatForDifficulty(request.cli, request.model ?? null, request.effort ?? null, options.tier.difficulty, (model) => effortsFor(this.catalog, request.cli, model), this.catalog?.[request.cli])
      if (seat.changed) {
        request.model = seat.model
        request.effort = request.role === 'crew' ? input.effort ?? seat.effort : seat.effort
        receipt.push(`dificuldade: ${options.tier.difficulty === 'dificil' ? 'difícil' : 'simples'} (${options.tier.by}) → ${[seat.model ?? 'modelo padrão', seat.effort && `esforço ${EFFORT_LABEL[seat.effort]}`].filter(Boolean).join(', ')}`)
      }
    }
    const account = chosen ?? this.accountFor(request.cli, request.accountId)
    if (input.effort && (!options.tier || request.role === 'crew')) request.effort = input.effort
    if (account && !request.model && account.model) request.model = account.model
    if (request.role === 'crew' && request.cli !== 'shell' && !mission.allowedClis.includes(request.cli)) throw new Error('A CLI efetiva não está permitida nesta missão')
    // Each model accepts its own levels (Codex lists them; Claude takes low…max).
    const allowed = effortsFor(this.catalog, request.cli, request.model)
    if (request.effort && request.cli !== 'shell' && !allowed.includes(request.effort)) {
      throw new Error(`Esforço "${EFFORT_LABEL[request.effort]}" não vale para ${request.model ?? `o modelo padrão do ${CLI_LABEL[request.cli]}`}; use ${allowed.map((e) => EFFORT_LABEL[e]).join(', ')}`)
    }

    if (work && request.cli !== 'shell') {
      const validModel = work === 'motion' ? request.cli === 'claude' && request.model === 'claude-opus-5-5' : request.cli === 'claude' && request.model === 'claude-opus-5-5' || request.cli === 'codex' && request.model === 'gpt-6.1-sol'
      const validEffort = work === 'motion' ? request.effort === 'high' : request.effort === 'medium' || request.effort === 'high'
      if (!validModel || !validEffort) throw new Error(`A escolha explícita conflita com a política ${work}: ${work === 'motion' ? 'Opus 5.5 alto' : 'Opus 5.5 ou GPT 6.1 Sol médio/alto'}. Ajuste a escolha; ela não foi substituída.`)
      if (!this.catalog?.[request.cli].models.some(m => m.id === request.model)) throw new Error('Modelo de design indisponível no catálogo local; atualize o catálogo')
    }
    if (account) this.accountFiles.prepare(account)

    const roleSkills = squadRole ?? taskType
    const policy: SkillPolicy | undefined = roleSkills?.onlySkills ? { only: roleSkills.skills } : undefined

    const id = options.id ?? this.store.allocatePaneId()
    // Worktree missions: the lead on the mission branch, each helper on its own branch cut from it.
    // A helper may start in another folder of the workspace; the worktree is only for the main one.
    const folder = request.folder && request.folder !== workspace.path ? request.folder : null
    if (folder && !workspace.folders.includes(folder)) throw new Error(`Essa pasta não faz parte do workspace: ${folder}`)
    let cwd = folder ?? workspace.path
    let branch: string | null = null
    if (mission.git && !folder) {
      const git = mission.git
      // A plain terminal helper works in the lead's copy (to run tests, look around); agents get their own.
      const own = request.role === 'lead' || request.cli !== 'shell'
      const tree = options.worktree ?? (request.role === 'lead' || !own
        ? { path: git.leadPath, branch: git.branch }
        : { path: join(this.dataDir, 'worktrees', mission.id, String(id)), branch: `${git.branch}--${id}` })
      addWorktree(git.repo, git.leadPath, git.branch, git.base)
      if (tree.path !== git.leadPath) addWorktree(git.repo, tree.path, tree.branch, git.branch)
      cwd = git.sub ? join(tree.path, git.sub) : tree.path
      branch = tree.branch
    }
    const title = request.title.trim().slice(0, 120) || squadRole?.name || taskType?.name || `${CLI_LABEL[request.cli]} #${id}`
    const isReadOnly = input.readOnly || requiresSandbox || taskType?.readOnly || squadRole?.readOnly || (request.role === 'lead' && (mission.mode === 'agentica' || mission.mode === 'squad')) || false
    const token = randomBytes(24).toString('base64url')
    const english = this.store.settings().agentsInEnglish
    const toolProfile = request.cli === 'claude' || request.cli === 'codex' ? this.store.settings().agentToolProfile ?? 'orbit' : 'inherit'
    const lead = this.missionPanes(mission.id).find((p) => p.role === 'lead')
    const skillItems = request.cli === 'shell' ? [] : missionSkills([...bundledCatalog(), ...this.catalogItems.filter(i => i.resource?.origin !== 'bundled')], request.cli, workspace.folders, new Set(this.store.disabledCatalog()), policy)
    const explicitSkills = roleSkills?.skills ?? []
    const designSelection = request.role === 'crew' && request.cli !== 'shell' && designWork(`${input.title} ${input.task ?? ''}`) ? selectDesignSkills(skillItems, `${input.title} ${input.task ?? ''}`, this.designContexts.get(JSON.stringify(workspace.folders)) ?? '', explicitSkills, !!roleSkills?.onlySkills) : { items: [], missing: [] }
    const selectedSkills = [...skillItems.filter(i => explicitSkills.some(n => i.name === n || i.name.endsWith(`:${n}`))), ...designSelection.items]
    const skillDelivery = designSkillDelivery(selectedSkills, explicitSkills, designSelection.missing)
    if (selectedSkills.length || designSelection.missing.length) receipt.push(`skills de design: ${skillDelivery.delivered.map(i => i.name).join(', ') || designSelection.missing.join('; ')}`)
    const roleContext = this.contextPack(mission.id, [
      { id: 'permissions', text: (isReadOnly ? 'This execution is read-only. Do not modify project files.\n\n' : '') + (toolProfile === 'orbit' ? 'External MCP profile: only Orbit coordination is loaded. Native file/terminal tools, project instructions, skills and permission rules still apply. If the task needs an external integration, report the missing capability and ask for the full tool profile on reopen. Do not install or reconfigure integrations to bypass this profile.\n\n' : '') + commandToolsNote(request.cli) + workspaceNote(workspace.folders) + instructionsNote(workspace.instructions) + (branch && mission.git ? worktreeNote(mission.git, request.role, branch, cwd) : '') + this.skillNote(request.cli, policy), required: true },
      { id: 'design-skills', text: skillDelivery.text, required: true },
      { id: 'required-project-memory', text: request.role === 'lead' ? projectMemoryNote(this.projectMemory(mission.workspaceId, Infinity, 'required')) : '', required: true },
      { id: 'project-memory', text: request.role === 'lead' ? projectMemoryNote(this.projectMemory(mission.workspaceId, Infinity, 'optional')) : '', maxBytes: harness?.strategy.optionalContextBytes ?? 2000 },
      { id: 'execution-strategy', text: harness ? harnessNote(harness) : '', required: true },
      { id: 'role-contract', text: request.role === 'lead' ? leadRole(mission, { id }, squad, routing, english) : crewRole(mission, { id }, { boss: options.boss ?? lead, children: options.children ?? 0, english, attemptId: options.attemptId, hasBoard: this.store.cards(mission.id).length > 0 }, squadRole, taskType), required: true },
    ], 48_000)
    const taskContext = this.contextPack(mission.id, [{ id: 'assignment-and-acceptance', text: request.task?.trim() ?? '', required: true }], 128_000)
    const launch = writeAgentFiles({
      paneDir: this.paneDir(id),
      cli: request.cli,
      model: request.model,
      effort: request.cli === 'shell' ? null : request.effort ?? null,
      endpoint: this.endpoint,
      token,
      hookCommand: hookCommand(process.execPath, HOOK_SCRIPT),
      statusCommand: hookCommand(process.execPath, STATUS_SCRIPT),
      apiKeyHelper: account ? this.accountFiles.apiKeyHelper(account) : undefined,
      addDirs: [...(folder ? workspace.folders.filter((f) => f !== folder && (!mission.git || f !== workspace.path)) : workspace.folders.slice(1)), this.attachments.directory(mission.id)],
      rolePrompt: roleContext.text,
      task: taskContext.text || null,
      orbitCommand: hookCommand(process.execPath, ORBIT_CLI_SCRIPT),
    })

    if (request.cli === 'codex') launch.disabledMcp = codexDisabledMcp(this.store.disabledCatalog())
    launch.toolProfile = toolProfile
    // Codex has no hooks to refuse edits: an orchestrating lead and read-only kinds run in its
    // read-only sandbox, where any file change needs the person's approval.
    // Writable helpers must explicitly request their bounded workspace policy too. Leaving it
    // implicit can inherit read-only, which rejects --add-dir before the CLI even starts.
    if (request.cli === 'codex') launch.sandbox = isReadOnly ? 'read-only' : 'workspace-write'
    if (options.resume) launch.resume = options.resume

    let pane: Pane
    let processStarted = false
    const executionEpoch = randomUUID()
    const executionPolicy: ExecutionPolicy | undefined = request.cli === 'shell' ? undefined : { epoch: executionEpoch, missionId: mission.id, readOnly: isReadOnly, roots: copyRoots([cwd, ...workspace.folders.filter(f => f !== workspace.path && f !== folder)]) }
    const suggested = request.role === 'lead' ? 'orbit-pilot' : taskType?.id === 'revisao' ? 'orbit-review' : taskType?.readOnly ? 'orbit-research' : taskType?.id === 'operacao' ? 'orbit-verify' : 'orbit-build'
    try {
      this.store.startExecution(id, executionEpoch, executionPolicy)
      this.skillSessions.start(id, executionEpoch, request.cli === 'shell' ? [] : [...(roleSkills?.skills ?? []), ...designSelection.items.map(i => i.name), ...(!policy?.only || policy.only.includes(suggested) ? [suggested] : [])])
      for (const item of skillDelivery.delivered) this.skillSessions.loaded(id, executionEpoch, item.id, item.name, item.resource!.sha256)
      const decision = decisionReceipt({
        source: harness?.selected && !automatic ? 'benchmark' : fallbackUsed ? 'fallback' : options.decisionSource ?? (options.explicitCli || input.model || input.effort ? 'explicit' : 'rule'),
        requested: { cli: options.explicitCli ?? null, model: input.model ?? null, effort: input.effort ?? null },
        effective: { cli: request.cli, model: request.model, effort: request.effort ?? null, accountId: account?.id ?? null },
        reasons: [...receipt],
        catalogRevision,
        harness: harness ? { ...harness, executionMode: this.harnessMode, executed: request.cli !== 'shell' && request.model && request.effort && this.clis.get(request.cli)?.version && catalogRevision ? { cli: request.cli, model: request.model, effort: request.effort, cliVersion: this.clis.get(request.cli)!.version!, catalogRevision } : null } : undefined,
        capabilityLimits: [
          !this.catalog && 'Catálogo de modelos não detectado; modelo padrão não é uma identidade confirmada',
          request.cli !== 'codex' && isReadOnly && 'Somente leitura depende de hooks/instruções; sandbox nativo indisponível',
          'Capacidades vêm do contrato do adapter, não de certificação de toda versão do provedor',
        ].filter((s): s is string => !!s),
      }, { routing, squad, allowedClis: mission.allowedClis, requireReadOnlySandbox: requiresSandbox })
      if (options.attemptId) this.store.startingAttempt(options.attemptId, { cli: request.cli, model: request.model, accountId: account?.id ?? null, decision })
      if (request.cli !== 'shell') writeFileSync(join(this.paneDir(id), 'context.json'), JSON.stringify({ version: 1, executionEpoch, role: roleContext, task: taskContext, decision }, null, 2), { mode: 0o600 })
      const launchStarted = performance.now()
      pane = this.panes.spawn({
        id,
        executionEpoch,
        request: { ...request, title },
        squadRole: squadRole?.name ?? null,
        taskType: taskType?.name ?? null,
        cwd,
        launch,
        branch,
        hookDriven: request.cli !== 'shell' && AGENT_INFO[request.cli].hooks,
        accountId: account?.id ?? null,
        env: {
          ...(account ? this.accountFiles.env(account) : {}),
          ORBIT_PANE_ID: String(id),
          ORBIT_MISSION_ID: mission.id,
          ORBIT_PANE_TOKEN: token,
          ORBIT_HOOK_URL: `${this.endpoint}/hooks`,
          ORBIT_STATUS_URL: `${this.endpoint}/status`,
          ORBIT_MCP_URL: `${this.endpoint}/mcp`,
          // Several agents updating the same CLI install at once can leave it broken.
          DISABLE_AUTOUPDATER: '1',
        },
      })
      processStarted = true
      if (pane.pid) this.store.bindExecutionProcess(id, executionEpoch, pane.pid)
      this.measurements?.start(pane, performance.now() - launchStarted, request.cli === 'shell' ? 0 : (options.resume ? 0 : roleContext.bytes) + taskContext.bytes, request.cli === 'shell' ? 0 : (options.resume ? 0 : roleContext.sourceBytes) + taskContext.sourceBytes)
    } catch (error) {
      if (processStarted) this.panes.forget(id)
      else this.store.releaseExecution(id, executionEpoch)
      removeAgentFiles(this.paneDir(id))
      throw error
    }
    this.paneTokens.set(token, id)
    // Enough to open it again later; the account is the one it really ran as (its conversations live there).
    this.store.setPaneSpec(id, { ...input, task: null, accountId: account?.id ?? null, requireReadOnlySandbox: requiresSandbox })
    if (policy) this.skillPolicies.set(id, policy)
    if (isReadOnly) this.readOnly.add(id)
    if (request.cli === 'codex' || request.cli === 'claude') this.watchCodex()
    this.syncPane(pane)
    this.dispatchDeliveries(mission.id)
    const seat = request.role === 'lead' ? 'líder' : squadRole?.name.toLowerCase() ?? taskType?.name.toLowerCase() ?? 'ajudante'
    const who = [CLI_LABEL[request.cli], account && !account.builtin && account.name, request.model, request.effort && `esforço ${EFFORT_LABEL[request.effort]}`, seat].filter(Boolean).join(' · ')
    // The receipt says why: task type, CLI change, account and its room.
    const why = receipt.length ? `\n\n${receipt.map((line) => `▸ ${line}`).join('\n')}` : ''
    this.event(mission.id, 'pane.spawned', options.opened?.(id) ?? `Agente #${id} aberto`, `${title} — ${who}${why}`, id)
    return pane
  }

  /**
   * Opens an agent again with its settings, under the same number: a new conversation or, with
   * `resume`, the same one (`message` is its next turn). What it owes and its criteria carry over.
   */
  private readonly restarting = new Set<number>()
  private stopping = false
  private shutdownTask?: Promise<void>

  private async restartPane(paneId: number, resume: boolean, message?: string): Promise<Pane> {
    if (this.restarting.has(paneId)) throw new Error(`#${paneId} já está retomando; aguarde o encerramento anterior`)
    this.restarting.add(paneId)
    try {
      const pane = this.store.pane(paneId)
      if (!pane) throw new Error(`#${paneId} não existe`)
      const spec = this.store.paneSpec(paneId)
      if (!spec || (pane.cli === 'shell' && resume)) throw new Error(resume ? 'Não há conversa para retomar neste agente' : `#${paneId} foi aberto antes desta versão do Orbit; abra um novo`)
      if (resume && !pane.sessionId) throw new Error(`O ${CLI_LABEL[pane.cli]} ainda não informou a conversa de #${paneId}`)
      const sessionId = pane.sessionId
      const git = this.store.mission(pane.missionId)?.git
      const worktree = git && pane.branch ? { path: this.worktreeOf(pane, git), branch: pane.branch } : undefined
      const accept = this.acceptance.get(paneId)
      await this.prepareDesignContext({ ...spec, title: pane.title, ...(message ? { task: message } : {}) })
      this.store.revokeExecution(paneId)
      this.panes.kill(paneId)
      await this.panes.waitForExit(paneId)
      const stopped = this.store.pane(paneId)
      if (!stopped || stopped.executionEpoch !== pane.executionEpoch) throw new Error('A retomada foi cancelada porque este agente foi fechado ou substituído')
      if (this.stopping) throw new Error('Orbit está encerrando; a retomada foi preservada para a próxima abertura')
      this.closePane(paneId)
      const opened = this.spawn({ ...spec, title: pane.title, ...(message ? { task: message } : {}) }, {
        keep: pane.cli === 'shell' ? undefined : { cli: pane.cli, model: pane.model, effort: pane.effort },
        id: paneId,
        worktree,
        resume: resume ? sessionId! : undefined,
        opened: (id) => (resume ? `#${id} retomou a conversa` : `#${id} reaberto numa conversa nova`),
      })
      if (accept) this.acceptance.set(opened.id, accept)
      // Same conversation: known now, not only when the CLI reports it again.
      if (resume && sessionId) {
        this.panes.setSession(opened.id, sessionId)
        this.panes.setUsage(opened.id, pane.usage, pane.contextPercent)
      }
      if (pane.assignedBy !== null && this.pendingDeliveries(pane.missionId).some(d => d.paneId === pane.id)) {
        this.panes.setHandoff(opened.id, { status: pane.handoffStatus, assignedBy: pane.assignedBy })
      }
      return this.store.pane(opened.id) ?? opened
    } finally { this.restarting.delete(paneId) }
  }

  private renamePane(paneId: number, raw: string): void {
    const title = typeof raw === 'string' ? raw.trim().slice(0, 120) : ''
    if (!title) throw new Error('Dê um nome ao agente')
    const live = this.panes.rename(paneId, title)
    if (live) return // synced through the status event
    const stored = this.store.pane(paneId)
    if (!stored) throw new Error(`#${paneId} não existe`)
    this.syncPane({ ...stored, title })
  }

  private closePane(id: number): void {
    const login = this.loginPanes.get(id)
    if (login !== undefined) {
      this.loginPanes.delete(id)
      this.panes.forget(id)
      this.broadcast({ type: 'pane.removed', paneId: id })
      if (this.store.account(login)) {
        this.setAccountStatus(login, { loginPaneId: null, busy: null })
        void this.checkAccount(login)
      }
      return
    }
    if (!this.store.pane(id)) return
    const epoch = this.store.pane(id)?.executionEpoch
    if (epoch) for (const key of this.sendingNotices) if (key.endsWith(`:${epoch}`)) this.sendingNotices.delete(key)
    this.panes.forget(id)
    this.codexRollouts.delete(id)
    this.nudged.delete(id)
    this.acceptance.delete(id)
    this.readOnly.delete(id)
    this.skillPolicies.delete(id)
    this.skillSessions.removePane(id)
    this.store.removePane(id)
    for (const [token, paneId] of this.paneTokens) if (paneId === id) this.paneTokens.delete(token)
    removeAgentFiles(this.paneDir(id))
    this.broadcast({ type: 'pane.removed', paneId: id })
  }

  private sameMission(caller: Pane, targetId: number): Pane {
    const target = this.store.pane(targetId)
    if (!target || target.missionId !== caller.missionId) throw new Error(`#${targetId} não faz parte desta missão`)
    if (target.id === caller.id) throw new Error('Esse agente é você')
    return target
  }

  private paneDir(id: number): string {
    return join(this.dataDir, 'panes', String(id))
  }

  private syncPane(pane: Pane): void {
    if (!this.store.pane(pane.id) && pane.status !== 'starting') return // closed meanwhile
    this.store.upsertPane(pane)
    this.broadcast({ type: 'pane.updated', pane })
  }

  private fail(error: unknown): void {
    this.broadcast({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  }

  private event(missionId: string, kind: MissionEventKind, title: string, body: string, paneId: number | null): void {
    this.broadcast({ type: 'event.added', event: this.store.addEvent({ missionId, kind, title, body, paneId }) })
  }
}

/** "Codex → Claude; esforço médio → alto": what a proposal changes in a row. */
function describeChange(row: TaskType | undefined, change: RoutingChange): string {
  const parts: string[] = []
  const was = <K extends keyof RoutingChange>(key: K) => row?.[key]
  if (change.cli) parts.push(`agente ${CLI_LABEL[was('cli') ?? change.cli]} → ${CLI_LABEL[change.cli]}`)
  if ('model' in change) parts.push(`modelo ${was('model') ?? 'padrão'} → ${change.model ?? 'padrão'}`)
  if ('effort' in change) parts.push(`esforço ${was('effort') ? EFFORT_LABEL[was('effort')!] : 'padrão'} → ${change.effort ? EFFORT_LABEL[change.effort] : 'padrão'}`)
  if (change.readOnly !== undefined) parts.push(change.readOnly ? 'passa a ser só leitura' : 'deixa de ser só leitura')
  if (change.method !== undefined) parts.push(`como fazer: ${change.method.trim().slice(0, 400) || '(vazio)'}`)
  return parts.join('; ')
}

/** Absolute, existing, distinct folders; at least one, at most WORKSPACE_LIMITS.folders. */
function validFolders(input: unknown): string[] {
  if (!Array.isArray(input) || input.length === 0) throw new Error('Inclua pelo menos uma pasta')
  if (input.length > WORKSPACE_LIMITS.folders) throw new Error(`No máximo ${WORKSPACE_LIMITS.folders} pastas por workspace`)
  const folders: string[] = []
  for (const raw of input) {
    const given = typeof raw === 'string' ? raw.trim() : ''
    if (!isAbsolute(given) || !isDirectory(resolve(given))) throw new Error(`Pasta não encontrada: ${given || '(vazia)'}`)
    const path = resolve(given)
    if (!folders.includes(path)) folders.push(path)
  }
  return folders
}

/** CLIs a mission allows; both when none (or nothing valid) was given. */
function allowedClis(input: unknown): AgentCliForRole[] {
  const list = (Array.isArray(input) ? input : []).filter((c): c is AgentCliForRole => AGENT_CLIS.includes(c))
  return list.length ? [...new Set(list)] : ['claude', 'codex']
}

/** "em 2 h 10 min" — when a used-up account frees up. */
function untilText(at: number): string {
  const minutes = Math.max(1, Math.round((at - Date.now()) / 60_000))
  return minutes < 60 ? `em ${minutes} min` : `em ${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`
}

/** Limits from the UI or a template: positive numbers, or null; both null = no budget. */
function budgetLimits(input: unknown): { tokens: number | null; costUsd: number | null } | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as { tokens?: unknown; costUsd?: unknown }
  const tokens = typeof raw.tokens === 'number' && Number.isFinite(raw.tokens) && raw.tokens > 0 ? Math.min(Math.round(raw.tokens), 1e10) : null
  const costUsd = typeof raw.costUsd === 'number' && Number.isFinite(raw.costUsd) && raw.costUsd > 0 ? Math.min(Math.round(raw.costUsd * 100) / 100, 1e5) : null
  return tokens === null && costUsd === null ? null : { tokens, costUsd }
}

function freshBudget(limits: { tokens: number | null; costUsd: number | null } | null): MissionBudget | null {
  return limits && { ...limits, warned: false, exceeded: false }
}

/** How much of the budget is used: the larger of the token and the cost share. */
function budgetUse(mission: Mission, budget: Pick<MissionBudget, 'tokens' | 'costUsd'>): number {
  return Math.max(budget.tokens ? mission.usage.total / budget.tokens : 0, budget.costUsd ? (mission.usage.costUsd ?? 0) / budget.costUsd : 0)
}

function budgetText(mission: Mission, budget: MissionBudget): string {
  const parts = []
  if (budget.tokens) parts.push(`${mission.usage.total.toLocaleString('pt-BR')} de ${budget.tokens.toLocaleString('pt-BR')} tokens`)
  if (budget.costUsd) parts.push(`US$ ${(mission.usage.costUsd ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} de US$ ${budget.costUsd.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`)
  return parts.join(' e ')
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn()
  } catch {
    return fallback
  }
}

/** `gh pr view --json number,url,state,isDraft,statusCheckRollup` → what the UI shows. */
export function parsePrStatus(json: string): PrStatus {
  const data = JSON.parse(json) as { number: number; url: string; state: PrStatus['state']; isDraft?: boolean; statusCheckRollup?: Array<Record<string, string>> }
  const checks = (data.statusCheckRollup ?? []).map((c) => {
    const name = c.name ?? c.context ?? 'check'
    if (c.__typename === 'StatusContext') {
      return { name, state: c.state === 'SUCCESS' ? 'ok' : c.state === 'PENDING' || c.state === 'EXPECTED' ? 'pending' : 'fail' } as const
    }
    if (c.status && c.status !== 'COMPLETED') return { name, state: 'pending' } as const
    const conclusion = c.conclusion ?? ''
    return { name, state: conclusion === 'SUCCESS' || conclusion === 'NEUTRAL' ? 'ok' : conclusion === 'SKIPPED' ? 'skip' : 'fail' } as const
  })
  return { number: data.number, url: data.url, state: data.state, draft: data.isDraft === true, checks, checkedAt: Date.now() }
}

/** Card titles a template starts the board with: trimmed, non-empty, within the limits. */
function templateCards(input: unknown): string[] {
  return (Array.isArray(input) ? input : []).map((t) => String(t).trim().slice(0, CARD_LIMITS.title)).filter(Boolean).slice(0, TEMPLATE_LIMITS.cards)
}

function cardColumn(value: unknown): CardColumn {
  if (!CARD_COLUMNS.includes(value as CardColumn)) throw new Error(`Coluna inválida: ${String(value)}`)
  return value as CardColumn
}

const cardView = (c: Card) => ({ card: `T${c.number}`, title: c.title, column: c.column, assignee: c.assignee === null ? null : `#${c.assignee}`, notes: c.notes || undefined, createdBy: c.createdBy })

/** Symlinks resolved (/tmp vs /private/tmp), or the path as given when it is gone. */
function realPath(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

function workspaceName(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, WORKSPACE_LIMITS.name) : ''
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function requireText(value: unknown, field: string, max: number): string {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) throw new Error(`Informe o ${field}`)
  return text.slice(0, max)
}
