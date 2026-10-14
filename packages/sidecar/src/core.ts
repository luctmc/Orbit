import { readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ACCOUNT_LIMITS, BUDGET_WARN_AT, CLI_NAME, AGENT_CLIS, AGENT_INFO, CARD_COLUMNS, CARD_LIMITS, MODEL_ID, SCHEDULE_LIMITS, TEMPLATE_LIMITS, type MissionBudget, type MissionTemplate, type MissionTemplateInput, EFFORT_LABEL, EFFORTS, SESSION_ID, type Card, type CardColumn, WORKSPACE_LIMITS, effortsFor, type Account, type AccountInput, type AccountStatus, type AgentCli, type BrowserInput, type CatalogItem, type GitSummary, type HandoffStatus, type RoutingChange, type RoutingProposal, type LeadTarget, type MissionNote, type MemoryEntry, type MemoryKind, MEMORY_KINDS, MEMORY_LIMITS, type Difficulty, type AgentSeat, NOTE_LIMITS, CARD_COLUMN_LABEL, type MissionGit, type PrStatus, type Schedule, type ScheduleInput, type AgentCliForRole, type Catalog, type CliStatus, type ClientMessage, type Effort, type Mission, type MissionEvent, type MissionEventKind, type MissionMode, type Pane, type ServerMessage, type SpawnPaneRequest, type Squad, type TaskType } from '@orbit/protocol'
import { BrowserHost, findBrowser, type BrowserEngine } from './browser.ts'
import { AccountFiles, blankAccountStatus, keyHint, normalizeAccount, pickAccount, userConfigDir, validKey } from './accounts.ts'
import { codexDisabledMcp, gateTool, scanCatalog, type SkillPolicy } from './skills.ts'
import { accountRooms, BALANCE_GAP, chooseAccount, classifyTask, cliLoad, LIVE_WEIGHT, seatForDifficulty, type AccountRoom } from './maestro.ts'
import { dueSchedules, nextRun, normalizeWhen } from './schedules.ts'
import { fileDiff, folderStatus, folderTree, readFile } from './files.ts'
import { Updates } from './updates.ts'
import { missionReport } from './report.ts'
import { addWorktree, BRANCH, commitsAhead, dirtyFiles, filesChanged, hasRemote, pushBranch, removeWorktree, repoInfo } from './git.ts'
import { slugify } from './squads.ts'
import { normalizeRouting } from './routing.ts'
import { decideTaskType } from './decider.ts'
import { CLAUDE_USAGE_COMMAND, parseClaudeUsage, usageText } from './claudeUsage.ts'
import { codexHome, codexLastTurn, findCodexRolloutById, latestCodexRollout, codexSessionId, findCodexRollout, fromClaudeStatus, fromCodexRollout, readTail, usageDelta, type UsageReport } from './usage.ts'
import { blankStatus, inspectCli, latestVersion, loadCatalog, loginShellRunner, runUpdate, type Run } from './clis.ts'
import { hookCommand, removeAgentFiles, writeAgentFiles } from './agentFiles.ts'
import { shellQuote, type AgentLaunch, type PaneCommand } from './command.ts'
import { claudeTranscript, claudeTurns, codexTurns, tailTurns, turnsMarkdown, type Turn } from './transcripts.ts'
import { fromGeminiHook, statusFromHook, toGeminiHook, type HookPayload } from './hooks.ts'
import { PaneManager, type PaneSnapshot } from './panes.ts'
import { acceptanceNote, commandToolsNote, crewRole, projectMemoryNote, HANDOFF_NUDGE, instructionsNote, leadRole, MAESTRO_RULE, objectiveTask, workspaceNote, worktreeNote } from './prompts.ts'
import { normalizeSquad } from './squads.ts'
import { dayKey, Store } from './store.ts'

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
const USAGE_WATCH_MS = 10 * 60_000
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

export type Broadcast = (message: ServerMessage) => void

export interface CoreOptions {
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
  readonly store: Store
  private readonly panes: PaneManager
  private readonly broadcast: Broadcast
  private readonly dataDir: string
  /** Per-pane secret used by that agent's MCP client and hooks. Lives only in memory. */
  private readonly paneTokens = new Map<string, number>()
  private endpoint = ''
  private readonly run: Run
  /** Models and effort levels per CLI; null until first loaded. */
  private catalog: Catalog | null = null
  private readonly clis = new Map<AgentCliForRole, CliStatus>(AGENT_CLIS.map((cli) => [cli, blankStatus(cli)]))
  /** Codex agent → its session file, once found. */
  private readonly codexRollouts = new Map<number, string>()
  /** The last Codex turn already handled per agent, so each turn end is seen once. */
  private readonly codexTurns = new Map<number, string>()
  /** Codex helpers already asked once to deliver since their last assignment. */
  private readonly nudged = new Set<number>()
  /** Acceptance criteria each helper must answer when it delivers done. */
  private readonly acceptance = new Map<number, string[]>()
  /** Helpers whose task type only reads (Claude's edit tools are refused). */
  private readonly readOnly = new Set<number>()
  private codexTimer: NodeJS.Timeout | null = null
  private usageTimer: NodeJS.Timeout | null = null
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
  private catalogItems: CatalogItem[] = []
  private catalogScannedAt: number | null = null
  private scanning: Promise<void> | null = null
  /** Agents limited to their role's skills. */
  private readonly skillPolicies = new Map<number, SkillPolicy>()
  /** Files Claude agents edited (real path → who, in order), from their PostToolUse hooks. */
  private readonly touched = new Map<string, Array<{ paneId: number; missionId: string }>>()

  constructor({ dataDir, shell, broadcast, agentCommand, run, browser }: CoreOptions) {
    this.broadcast = broadcast
    this.run = run ?? loginShellRunner(shell)
    this.dataDir = dataDir
    this.store = new Store(dataDir)
    this.accountFiles = new AccountFiles(dataDir)
    this.updates = new Updates(this.run, join(dataDir, 'updates'))
    this.browser = new BrowserHost(join(dataDir, 'browser'), browser === undefined ? findBrowser() : browser)
    this.browser.on('state', (state) => this.broadcast({ type: 'browser.state', browser: state }))
    this.browser.on('closed', (missionId) => this.broadcast({ type: 'browser.closed', missionId }))
    this.browser.on('frame', (missionId, data, width, height) => this.broadcast({ type: 'browser.frame', missionId, data, width, height }))
    removeAgentFiles(join(dataDir, 'panes'))
    this.panes = new PaneManager(shell, agentCommand)
    this.panes.on('data', (paneId, data) => this.broadcast({ type: 'pane.data', paneId, data }))
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
      // Last word from a Codex session before it is gone.
      const rollout = this.codexRollouts.get(pane.id)
      if (rollout) {
        try {
          this.applyReport(pane.id, fromCodexRollout(readTail(rollout)))
        } catch {
          // nothing more to count
        }
      }
      this.syncPane(pane)
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
    const task = mission.mode !== 'livre' && mission.objective ? objectiveTask(mission) : null
    this.spawn({ ...message.lead, missionId: mission.id, role: 'lead', task })
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
      nextRunAt: enabled ? nextRun(when, now) : null,
      lastRunAt: existing?.lastRunAt ?? null,
      lastMissionId: existing?.lastMissionId ?? null,
      lastResult: existing?.lastResult ?? null,
      createdAt: existing?.createdAt ?? now,
    }
  }

  /** Starts a schedule's mission from its template; returns what happened. */
  private runSchedule(schedule: Schedule, now: number, manual: boolean): Schedule {
    let result: string
    let missionId = schedule.lastMissionId
    const previous = schedule.lastMissionId ? this.missionPanes(schedule.lastMissionId).filter((p) => this.panes.isAlive(p.id) && p.status !== 'idle') : []
    const template = this.store.template(schedule.templateId)
    if (!template) result = 'Não rodou: o modelo foi apagado'
    else if (!manual && schedule.skipIfRunning && previous.length > 0) result = `Pulada: a missão anterior ainda tem ${previous.length} ${previous.length === 1 ? 'agente trabalhando' : 'agentes trabalhando'}`
    else {
      try {
        const stamp = new Date(now).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
        const mission = this.startMission({
          workspaceId: schedule.workspaceId,
          title: `${template.title} · ${stamp}`.slice(0, 120),
          objective: template.objective,
          mode: template.mode,
          squadId: template.squadId,
          isolation: template.isolation,
          lead: { cli: template.lead.cli, model: template.lead.model, effort: template.lead.effort, title: '' },
          cards: template.cards,
          budget: template.budget,
        }, schedule)
        missionId = mission.id
        result = manual ? 'Missão iniciada (na mão)' : 'Missão iniciada'
      } catch (error) {
        result = `Não rodou: ${error instanceof Error ? error.message : String(error)}`
      }
    }
    // A run Orbit missed while closed happens once; the schedule then moves on from now.
    const next = manual ? schedule.nextRunAt : schedule.when.kind === 'once' ? null : nextRun(schedule.when, now)
    const updated: Schedule = { ...schedule, lastRunAt: now, lastMissionId: missionId, lastResult: result, nextRunAt: next, enabled: next === null && schedule.when.kind === 'once' ? false : schedule.enabled }
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
    for (const schedule of dueSchedules(this.store.schedules(), now)) this.runSchedule(schedule, now, false)
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
  projectMemory(workspaceId: string, budget = 6000): string {
    const entries = this.store.memory(workspaceId)
    if (entries.length === 0) return ''
    const label: Record<MemoryKind, string> = { decisao: 'decision', fato: 'fact', licao: 'lesson', missao: 'mission' }
    const line = (e: MemoryEntry) => `- [${label[e.kind]}${e.pinned ? ', pinned' : ''}${e.source ? ` · ${e.source.missionTitle}` : ' · the user'} · ${new Date(e.at).toISOString().slice(0, 10)}] ${oneLine(e.text)}`
    const newest = (a: MemoryEntry, b: MemoryEntry) => b.at - a.at
    const ordered = [
      ...entries.filter((e) => e.pinned).sort(newest),
      ...entries.filter((e) => !e.pinned && e.kind !== 'missao').sort(newest),
      ...entries.filter((e) => !e.pinned && e.kind === 'missao').sort(newest).slice(0, 8),
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
    if (previous) out.push(`You take over as lead from #${previous.pane.id} (${who(previous.pane)}). Nothing was lost: it is all below. Read it before acting and carry on from where the lead stopped; do not redo what was already delivered.`)
    out.push(`## Objective (written by the user)\n\n${mission.objective || '(no objective written: ask the user)'}`)
    const facts = [
      `mode ${mission.mode}`,
      mission.mode === 'agentica' && `CLIs allowed: ${mission.allowedClis.map((c) => CLI_LABEL[c]).join(', ')}`,
      mission.readyAt && `declared ready: ${oneLine(mission.readySummary ?? '').slice(0, 300)}`,
      mission.budget && `budget: ${mission.usage.total.toLocaleString('en-US')} tokens used${mission.budget.tokens ? ` of ${mission.budget.tokens.toLocaleString('en-US')}` : ''}${mission.budget.exceeded ? ' (used up)' : ''}`,
    ].filter(Boolean)
    out.push(`## State\n\n${facts.map((f) => `- ${f}`).join('\n')}`)
    const memory = this.projectMemory(mission.workspaceId, 4000)
    if (memory) out.push(`## Project memory (from earlier missions and the user)\n\n${memory}`)
    if (mission.notes.length) out.push(`## Decisions the leads wrote down\n\n${mission.notes.map((n) => `- (#${n.paneId}) ${n.text}`).join('\n')}`)
    const cards = this.store.cards(missionId)
    if (cards.length) out.push(`## Board\n\n${cards.map((c) => `- [${c.column}] T${c.number} ${c.title}${c.assignee !== null ? ` (#${c.assignee})` : ''}`).join('\n')}`)
    const crew = panes.filter((p) => p.role === 'crew' && p.id !== lead?.id)
    if (crew.length) {
      // Whoever worked for the previous lead now works for the reader of this briefing.
      const owner = (id: number) => (previous && id === previous.pane.id ? `you (it was working for #${id})` : `#${id}`)
      const state = (p: Pane) => p.handoffStatus === null ? (p.assignedBy !== null ? `owes a result to ${owner(p.assignedBy)}` : 'no task from the lead') : p.handoffStatus === 'progress' ? 'in progress' : `delivered (${p.handoffStatus})`
      out.push(`## Helpers\n\n${crew.map((p) => `- #${p.id} ${p.title} — ${who(p)}${p.taskType ? `, ${p.taskType}` : ''}; ${p.status}; ${state(p)}`).join('\n')}`)
    }
    const handoffs = this.missionEvents(missionId, 'handoff').slice(-8)
    if (handoffs.length) out.push(`## Results received\n\n${handoffs.map((e) => `### ${e.title}\n${clip(e.body, 1800)}`).join('\n\n')}`)
    if (mission.git) {
      const summary = safe(() => this.gitSummary(missionId), null)
      if (summary) out.push(`## Branches\n\nMission on branch ${summary.branch} (base ${summary.base}), ${summary.commits.length} commit(s).${summary.agents.length ? `\n${summary.agents.map((a) => `- #${a.paneId} ${a.branch}: ${a.ahead} commit(s) to integrate, ${a.dirty.length} uncommitted file(s)`).join('\n')}` : ''}`)
    }
    if (previous?.turns.length) out.push(`## End of the previous lead's conversation (#${previous.pane.id})\n\n${turnsMarkdown(previous.turns, 6000, 1200)}`)
    const flow = this.missionEvents(missionId).filter((e) => e.kind !== 'handoff').slice(-25)
    if (flow.length) out.push(`## Recent flow\n\n${flow.map((e) => `- ${new Date(e.at).toISOString().slice(5, 16).replace('T', ' ')} ${e.title}`).join('\n')}`)
    out.push('## How to carry on\n\nHelpers that owe a result now deliver it to you. Write important decisions down with mission_note: they pass to any lead after you. To read this briefing again, call mission_briefing.')
    return clip(out.join('\n\n'), 18_000)
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
    if (old) this.closePane(old.id)
    const from = old ? `#${old.id} (${[CLI_LABEL[old.cli], old.model].filter(Boolean).join(' · ')})` : 'ninguém'
    this.event(missionId, 'lead.changed', `Liderança: ${from} → #${lead.id}`, `${[CLI_LABEL[lead.cli], lead.model].filter(Boolean).join(' · ')} assumiu com o dossiê da missão${previous?.turns.length ? ` e o fim da conversa de #${previous.pane.id}` : ''}.`, lead.id)
    if (to.kind === 'promote') {
      this.submitTo(lead.id, `[Orbit] You are now the lead of this mission, taking over from ${from}. First of all, call mission_briefing from "orbit" and read the whole briefing: objective, decisions, board, helpers, results and the end of the previous lead's conversation. From now on you orchestrate: delegate with agent_spawn, do not execute, and results come to you. Answer the user in Brazilian Portuguese.`)
    }
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
    if (names.length) lines.push(`Switched off in Orbit (do not use): ${names.slice(0, 40).join(', ')}${names.length > 40 ? '…' : ''}.`)
    return lines.length ? `${lines.join('\n')}\n\n` : ''
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
    if (account.cli === 'codex') this.readCodexLimits(account)
    if (account.cli === 'claude' && account.kind === 'assinatura' && found.loggedIn !== false) void this.readClaudeLimits(account)
    const loginPaneId = this.accountStatus.get(accountId)?.loginPaneId ?? null
    this.setAccountStatus(accountId, { ...found, checkedAt: Date.now(), busy: loginPaneId && this.panes.isAlive(loginPaneId) ? 'login' : null })
  }

  /**
   * A Claude subscription's limits from Claude Code's `/usage`, run headless: a local command
   * (no model call, no cost), so the maestro knows its room even with no Claude agent open.
   */
  private async readClaudeLimits(account: Account): Promise<void> {
    const { code, stdout } = await this.run(`${this.accountFiles.envPrefix(account)}${CLAUDE_USAGE_COMMAND}`, 30_000).catch(() => ({ code: 1, stdout: '' }))
    const text = code === 0 ? usageText(stdout) : null
    const usage = text ? parseClaudeUsage(text) : null
    if (!usage || !this.store.account(account.id)) return
    const known = this.store.limits().find((l) => l.accountId === account.id)
    this.broadcast({ type: 'limits', limits: this.store.setLimits({ accountId: account.id, cli: 'claude', fiveHour: usage.fiveHour, weekly: usage.weekly, plan: known?.plan ?? null, updatedAt: Date.now() }) })
  }

  /** Every few minutes, the room of each Claude subscription (Codex's comes from its session files). */
  startUsageWatch(): void {
    if (this.usageTimer) return
    this.usageTimer = setInterval(() => {
      for (const account of this.store.accounts()) {
        const signedOut = this.accountStatus.get(account.id)?.loggedIn === false
        if (account.cli === 'claude' && account.kind === 'assinatura' && !signedOut) void this.readClaudeLimits(account)
        if (account.cli === 'codex') this.readCodexLimits(account)
      }
    }, USAGE_WATCH_MS)
    this.usageTimer.unref()
  }

  /**
   * A Codex account's limits from its latest session file, so the maestro knows its room even
   * when no agent of Orbit is running on it (Codex writes them with every turn).
   */
  private readCodexLimits(account: Account): void {
    try {
      const home = this.accountFiles.configDir(account) ?? codexHome()
      const latest = latestCodexRollout(home)
      const known = this.store.limits().find((l) => l.accountId === account.id)
      if (!latest || (known && known.updatedAt >= latest.mtime)) return
      const { limits } = fromCodexRollout(readTail(latest.path), latest.mtime)
      if (limits) this.broadcast({ type: 'limits', limits: this.store.setLimits({ ...limits, accountId: account.id }) })
    } catch {
      // no readable session: the account stays "sem leitura"
    }
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
    return accountRooms(cli, this.store.accounts(), this.statuses(), this.store.limits(), live)
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

  handle(message: ClientMessage, reply: (message: ServerMessage) => void = this.broadcast): void {
    switch (message.type) {
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
        const folders = validFolders(message.folders)
        this.broadcast({ type: 'workspace.updated', workspace: this.store.createWorkspace(workspaceName(message.name), folders) })
        return
      }
      case 'workspace.update': {
        if (!this.store.workspace(message.workspaceId)) throw new Error('Workspace desconhecido')
        const workspace = this.store.updateWorkspace(message.workspaceId, {
          name: message.name === undefined ? undefined : workspaceName(message.name),
          folders: message.folders === undefined ? undefined : validFolders(message.folders),
          instructions: message.instructions === undefined ? undefined : typeof message.instructions === 'string' ? message.instructions.trim().slice(0, WORKSPACE_LIMITS.instructions) : '',
        })
        if (workspace) this.broadcast({ type: 'workspace.updated', workspace })
        return
      }
      case 'mission.create':
        this.startMission(message)
        return
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
        this.store.saveRouting(normalizeRouting(message.routing))
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
      case 'account.check':
        void this.checkAccounts()
        return
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
      case 'pane.spawn':
        this.spawn(message.request)
        return
      case 'pane.attach':
        return // per-connection: handled by the server
      case 'pane.input':
        if (typeof message.data === 'string' && message.data.includes('\r')) this.panes.answered(message.paneId)
        this.panes.write(message.paneId, message.data)
        return
      case 'pane.submit':
        this.panes.answered(message.paneId)
        // Text and Enter in one write look like a paste to TUIs, which then keep the Enter as a newline.
        if (!this.submitTo(message.paneId, message.text)) throw new Error(`#${message.paneId} não está rodando`)
        return
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
        this.restartPane(message.paneId, message.resume === true)
        return
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
        this.runSchedule(schedule, Date.now(), true)
        return
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
        this.spawn({ ...spec, role: 'crew', title: `${pane.title} (cópia)`.slice(0, 120) }, { opened: (id) => `#${id} é uma cópia de #${pane.id}` })
        return
      }
    }
  }

  // ---- Agent-facing API (MCP tools and hooks) ----

  /** The pane a bearer token belongs to, if it is still open. */
  identify(token: string | undefined): Pane | undefined {
    const id = token ? this.paneTokens.get(token) : undefined
    return id === undefined ? undefined : this.store.pane(id)
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
  async spawnHelper(caller: Pane, input: { title: string; task: string; cli?: AgentCli; model: string | null; effort?: Effort | null; squadRoleId?: string | null; taskTypeId?: string | null; accept?: string[]; folder?: string | null; difficulty?: Difficulty | null }): Promise<{ pane: Pane; receipt: string[] }> {
    const receipt: string[] = []
    const mission = this.store.mission(caller.missionId)
    if (caller.role === 'crew') {
      const slots = this.childSlots(caller)
      if (slots === 0) throw new Error(this.missionPanes(caller.missionId).some((p) => p.assignedBy === caller.id && this.panes.isAlive(p.id)) ? `Você já tem ${MAX_CHILDREN} sub-ajudantes abertos. Feche um que já entregou (agent_close) antes de abrir outro.` : 'Sub-ajudantes não podem abrir ajudantes.')
    }
    let taskTypeId = input.taskTypeId ?? null
    let difficulty: Difficulty | null = input.difficulty ?? null
    let difficultyBy = 'líder'
    if ((mission?.mode === 'agentica' || caller.role === 'crew') && !taskTypeId && !input.squadRoleId && !input.cli && !input.model) {
      const text = `${input.title}\n${input.task}`
      const types = this.store.routing().taskTypes
      let { type, via, sure } = classifyTask(text, types, input.title)
      // No keyword, or two types close: a small model reads the activity against the table; the
      // keywords' answer stands if it fails.
      if (!sure && this.store.settings().smartClassify) {
        const decided = await decideTaskType(this.run, join(this.dataDir, 'decisor'), text, types).catch(() => null)
        if (decided) {
          ({ type, via } = { type: decided.type, via: `decidido pelo Haiku${via === 'padrão' ? '' : ` (as palavras: ${via})`}: ${decided.why}` })
          if (!difficulty) [difficulty, difficultyBy] = [decided.difficulty, 'Haiku']
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
    const children = caller.role === 'lead' && (mission?.mode === 'agentica' || mission?.mode === 'squad') ? MAX_CHILDREN : 0
    const { accept: _, difficulty: __, ...request } = input
    // A model the lead named stays; otherwise the activity's difficulty picks the tier.
    const tier = difficulty && difficulty !== 'normal' && !input.model ? { difficulty, by: difficultyBy } : undefined
    const opened = this.spawn({ missionId: caller.missionId, role: 'crew', ...request, task: input.task + acceptanceNote(accept), cli: input.cli ?? 'claude', taskTypeId }, { receipt, boss: caller, children, tier })
    if (accept.length) this.acceptance.set(opened.id, accept)
    this.assign(opened.id, caller.id)
    const pane = this.store.pane(opened.id) ?? opened
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
    const proposal = this.store.addProposal({ missionId: caller.missionId, paneId: caller.id, kind: row.id, change, reason })
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
      if (!row) throw new Error('O tipo dessa proposta saiu da tabela')
      const { change } = proposal
      this.store.saveRouting(normalizeRouting({ ...routing, taskTypes: routing.taskTypes.map((t) => (t.id === row.id ? { ...t, ...change, ...(change.cli && change.cli !== t.cli && !('model' in change) ? { model: null } : {}) } : t)) }))
      this.broadcast({ type: 'routing.updated', routing: this.store.routing() })
    }
    this.store.decideProposal(id, accept ? 'aceita' : 'recusada')
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
  resumeCrews(): void {
    if (!this.store.settings().resumeOnStart) return
    const ids = this.store.wasRunning.splice(0)
    const panes = ids.map((id) => this.store.pane(id)).filter((p): p is Pane => Boolean(p && p.cli !== 'shell' && p.sessionId && this.store.paneSpec(p.id) && this.store.mission(p.missionId)?.status === 'active'))
    // Leads first, so helpers that deliver find them running.
    panes.sort((a, b) => Number(b.role === 'lead') - Number(a.role === 'lead') || a.id - b.id)
    for (const pane of panes) {
      try {
        this.restartPane(pane.id, true, this.owesHandoff(pane) ? RESUME_NOTE : undefined)
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
    this.sendTo(caller, targetId, message.trim())
  }

  /** Opens a helper again in the same conversation, with a message to carry on; returns the new agent. */
  resumeHelper(caller: Pane, targetId: number, message: string | null): Pane {
    const target = this.sameMission(caller, targetId)
    if (target.role !== 'crew' || target.cli === 'shell') throw new Error(`#${targetId} não é um ajudante`)
    if (this.panes.isAlive(target.id) && (target.status === 'running' || target.status === 'starting')) {
      throw new Error(`#${targetId} está trabalhando. Para mudar o rumo use agent_interrupt; para falar com ele, agent_send.`)
    }
    const pane = this.restartPane(target.id, true, message?.trim() || 'Continue a tarefa de onde parou. Ao terminar, entregue com handoff_submit.')
    this.assign(pane.id, caller.id)
    return this.store.pane(pane.id) ?? pane
  }

  /** The lead declares the objective met: the mission shows as ready and the person is told. */
  missionReady(caller: Pane, summary: string, force: boolean): Mission {
    if (caller.role !== 'lead') throw new Error('Só o líder declara a missão pronta')
    const text = summary.trim().slice(0, 4000)
    if (!text) throw new Error('Escreva o resumo: o que foi feito, por quem, como foi verificado e o que falta')
    const pending = this.missionPanes(caller.missionId).filter((p) => p.role === 'crew' && p.cli !== 'shell' && this.panes.isAlive(p.id) && p.assignedBy !== null && p.handoffStatus !== 'done' && p.handoffStatus !== 'blocked' && p.handoffStatus !== 'auto')
    if (pending.length && !force) throw new Error(`Ainda falta retorno de ${pending.map((p) => `#${p.id} (${p.title})`).join(', ')}. Espere as entregas, ou feche-os, ou passe force: true se o trabalho deles não importa mais.`)
    const mission = this.store.updateMission(caller.missionId, { readyAt: Date.now(), readySummary: text })
    if (!mission) throw new Error('Missão inexistente')
    this.broadcast({ type: 'mission.updated', mission })
    this.event(mission.id, 'mission.ready', 'Missão pronta', text, caller.id)
    // What a mission achieved stays in the project's memory for the missions after it.
    this.remember(mission.workspaceId, { kind: 'missao', text: `${mission.title}: ${text}`, source: { missionId: mission.id, missionTitle: mission.title, paneId: caller.id } })
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
  }

  /**
   * Types a message into an agent. An orchestrating lead without hooks (Codex, Antigravity) gets
   * the maestro's reminder with it, as Claude and Gemini get it from their prompt hook.
   */
  private submitTo(paneId: number, text: string): boolean {
    const pane = this.store.pane(paneId)
    const mission = pane?.role === 'lead' ? this.store.mission(pane.missionId) : undefined
    const remind = pane && pane.cli !== 'shell' && !AGENT_INFO[pane.cli].hooks && (mission?.mode === 'agentica' || mission?.mode === 'squad')
    return this.panes.submit(paneId, remind ? `${text}\n\n(${MAESTRO_RULE})` : text)
  }

  /** A helper someone gave work to and that has not reported back yet. */
  private owesHandoff(pane: Pane): boolean {
    return pane.role === 'crew' && pane.cli !== 'shell' && pane.assignedBy !== null && pane.handoffStatus === null
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
    if (canBlock) return HANDOFF_NUDGE
    if (pane.cli !== 'shell' && !AGENT_INFO[pane.cli].hooks && !this.nudged.has(pane.id)) {
      this.nudged.add(pane.id)
      this.panes.submit(pane.id, `[Orbit] ${HANDOFF_NUDGE}`)
      return null
    }
    const said = oneLine(lastMessage?.trim() || this.panes.screenText(pane.id, 20)).slice(-1500) || '(nada na tela)'
    this.panes.setHandoff(pane.id, { status: 'auto' })
    this.event(pane.missionId, 'handoff', `Retorno de #${pane.id} (automático)`, `#${pane.id} encerrou o turno sem handoff_submit. Última mensagem:\n\n${said}`, pane.id)
    this.tellAssigner(pane, `[Orbit] #${pane.id} (${pane.title}) encerrou o turno sem entregar. Última mensagem dele: ${said} (Se ele perguntou algo, responda com agent_send; se diz que terminou, confira a evidência antes de aceitar.)`)
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
  handoff(caller: Pane, input: { summary: string; details?: string; status?: HandoffStatus; evidence?: string; to?: number | null; criteria?: Array<{ item: number; met: boolean; how: string }> }): { deliveredTo: number | null; status: HandoffStatus } {
    const status = input.status ?? 'done'
    if (!HANDOFF_STATUSES.includes(status)) throw new Error(`Status inválido: ${status}`)
    let text = input.summary.trim().slice(0, 2000)
    if (!text) throw new Error('O resumo do retorno está vazio')
    const evidence = (input.evidence ?? '').trim().slice(0, 4000)
    if (status === 'done' && !evidence) throw new Error('Diga em evidence como verificou: comandos rodados e o resultado, testes, arquivos conferidos. Se não deu para verificar, entregue com status blocked e explique o que falta.')
    // The acceptance contract: done answers every criterion, and all of them hold.
    const accept = this.acceptance.get(caller.id) ?? []
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
    if (target && !this.panes.isAlive(target.id)) throw new Error(`#${target.id} não está rodando`)
    const label = HANDOFF_LABEL[status]
    const details = (input.details ?? '').trim().slice(0, 20000)
    const body = [text, evidence && `Evidência: ${evidence}`, criteria && `Critérios de aceite:\n${criteria}`, details].filter(Boolean).join('\n\n')
    this.event(caller.missionId, 'handoff', `Retorno de #${caller.id} (${label})${target ? ` para #${target.id}` : ''}`, body, caller.id)
    this.panes.setHandoff(caller.id, { status })
    if (status === 'progress' && !target) return { deliveredTo: null, status }

    const met = accept.length && answers.size ? ` · critérios: ${accept.filter((_, i) => answers.get(i + 1)?.met).length}/${accept.length}` : ''
    const line = `${oneLine(text)}${evidence ? ` · evidência: ${oneLine(evidence).slice(0, 600)}` : ''}${met}${details || criteria ? ' (detalhes em handoff_list)' : ''}`
    if (target) {
      this.panes.submit(target.id, `[Orbit] Retorno de #${caller.id} (${caller.title}) para você, ${label}: ${line}`)
      // Work handed on (to a reviewer, say) is owed back by that agent to whoever leads it.
      if (target.role === 'crew' && target.cli !== 'shell') this.assign(target.id, target.assignedBy ?? caller.assignedBy ?? caller.id)
      return { deliveredTo: target.id, status }
    }
    return { deliveredTo: this.tellAssigner(caller, `[Orbit] Retorno de #${caller.id} (${caller.title}), ${label}: ${line}`), status }
  }

  /** Claude's status line, forwarded by the agent: usage, context and account limits. */
  statusReport(paneId: number, payload: unknown): void {
    this.applyReport(paneId, fromClaudeStatus(payload))
  }

  /** Counts what an agent used since its last report, and records the account's limits. */
  private applyReport(paneId: number, report: UsageReport): void {
    const pane = this.store.pane(paneId)
    if (!pane) return
    if (report.limits) this.broadcast({ type: 'limits', limits: this.store.setLimits({ ...report.limits, accountId: pane.accountId ?? report.limits.cli }) })
    if (!report.usage && report.contextPercent === null) return
    if (report.usage && pane.cli !== 'shell') {
      const delta = usageDelta(pane.usage, report.usage)
      const added = this.store.addUsage(pane.missionId, pane.cli, delta)
      if (added) {
        const workspaceId = added.mission.workspaceId
        this.store.addLedger({ day: added.day.day, workspaceId, missionId: pane.missionId, cli: pane.cli, model: pane.model, accountId: pane.accountId, tokens: delta.total, costUsd: delta.costUsd ?? 0 })
        this.broadcast({ type: 'mission.updated', mission: this.checkBudget(added.mission) })
        this.broadcast({ type: 'usage.day', day: added.day })
      }
    }
    this.panes.setUsage(paneId, report.usage, report.contextPercent)
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
        this.applyReport(pane.id, fromCodexRollout(tail))
        this.codexTurn(pane, tail)
      } catch {
        // the file may be mid-write; try again on the next tick
      }
    }
  }

  /** Each new `task_complete` in a Codex helper's session file is the end of its turn. */
  private codexTurn(pane: Pane, tail: string): void {
    const turn = codexLastTurn(tail)
    if (!turn?.done) return
    const seen = this.codexTurns.get(pane.id)
    this.codexTurns.set(pane.id, turn.id)
    // A resumed conversation starts with its old turns: those ended before this agent opened.
    if (seen === turn.id || (seen === undefined && turn.at && turn.at < pane.createdAt)) return
    const current = this.store.pane(pane.id)
    if (current) this.turnEnded(current, turn.lastMessage, false)
  }

  private watchCodex(): void {
    if (this.codexTimer) return
    this.codexTimer = setInterval(() => this.pollCodex(), CODEX_POLL_MS)
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
  hookReport(paneId: number, payload: HookPayload): object | null {
    // Gemini CLI's hooks speak a dialect of Claude Code's: translated in, answered back in its terms.
    if (this.store.pane(paneId)?.cli === 'gemini') return toGeminiHook(this.handleHook(paneId, fromGeminiHook(payload)))
    return this.handleHook(paneId, payload)
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
    // The lead of an agentic or squad mission orchestrates: reminded at every message, kept from editing.
    const mission = pane && pane.role === 'lead' ? this.store.mission(pane.missionId) : undefined
    if (mission && (mission.mode === 'agentica' || mission.mode === 'squad')) {
      if (payload.hook_event_name === 'UserPromptSubmit') return { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: MAESTRO_RULE } }
      if (payload.hook_event_name === 'PreToolUse' && EDIT_TOOLS.includes(payload.tool_name ?? '')) {
        return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'Você é o maestro desta missão e não edita arquivos. Abra um ajudante com agent_spawn para essa mudança.' } }
      }
    }
    const reason = gateTool(payload, new Set(this.store.disabledCatalog()), this.skillPolicies.get(paneId))
    return reason ? { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } } : null
  }

  shutdown(): void {
    if (this.codexTimer) clearInterval(this.codexTimer)
    if (this.scheduleTimer) clearInterval(this.scheduleTimer)
    if (this.usageTimer) clearInterval(this.usageTimer)
    this.browser.shutdown()
    this.panes.killAll()
    this.store.flush()
  }

  // ---- internals ----

  /** `resume` continues that conversation of the CLI; `opened` replaces the flow's "Agente #N aberto". */
  private spawn(input: SpawnPaneRequest, options: { resume?: string; opened?: (id: number) => string; worktree?: { path: string; branch: string }; receipt?: string[]; boss?: Pane; children?: number; id?: number; tier?: { difficulty: Difficulty; by: string }; keep?: AgentSeat } = {}): Pane {
    const receipt = options.receipt ?? []
    const mission = this.store.mission(input.missionId)
    if (!mission || mission.status !== 'active') throw new Error('Missão inexistente ou arquivada')
    if (mission.budget?.exceeded && input.cli !== 'shell') throw new Error('O orçamento desta missão acabou; aumente-o para abrir agentes')
    const workspace = this.store.workspace(mission.workspaceId)
    if (!workspace) throw new Error('Workspace da missão sumiu')

    // A squad role, or a row of the task table, decides who fills the seat: CLI, model, effort.
    const squad = this.missionSquad(mission.id)
    const routing = this.store.routing()
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
    // Reopening an agent keeps the seat it really had (balancing and difficulty already decided it).
    if (options.keep) Object.assign(request, { cli: options.keep.cli, model: options.keep.model, effort: options.keep.effort })
    if (!CLIS.includes(request.cli)) throw new Error(`Agente inválido: ${request.cli}`)
    if (request.effort && !EFFORTS.includes(request.effort)) throw new Error(`Esforço inválido: ${request.effort}`)

    // The maestro's seat: the CLI the mission allows and the account with the most room, moving to
    // the other CLI when every account of the first one is used up.
    let chosen: Account | null = null
    if (request.cli !== 'shell' && !request.accountId) {
      const allowedHere = mission.allowedClis
      // The row's equivalent on another CLI, when the mission allows it.
      const alt = taskType?.alt && allowedHere.includes(taskType.alt.cli) ? taskType.alt : null
      const move = (to: AgentCliForRole, why: string) => {
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
      if (!allowedHere.includes(request.cli) && allowedHere[0] && request.role !== 'lead') move(alt?.cli ?? allowedHere[0], 'a missão não usa essa CLI')
      const live = this.liveByAccount()
      // Fair share: when the table's CLI is much busier than the equivalent's, the equivalent takes it.
      if (alt && request.role !== 'lead' && request.cli !== alt.cli && taskType && request.cli === taskType.cli) {
        const here = cliLoad(this.rooms(request.cli, live))
        const there = cliLoad(this.rooms(alt.cli, live))
        if (there !== null && here !== null && here - there >= BALANCE_GAP) {
          move(alt.cli, `${CLI_LABEL[request.cli]} com carga ${Math.round(here)}, ${CLI_LABEL[alt.cli]} com ${Math.round(there)} (uso da conta + ${LIVE_WEIGHT} por agente rodando): foi para o equivalente da tabela`)
        }
      }
      let choice = chooseAccount(this.rooms(request.cli as AgentCliForRole, live))
      // Used up: the next CLI the mission allows that is installed and has room.
      if (choice.exhausted && request.role !== 'lead') {
        // The table's equivalent first, then any other CLI the mission allows.
        const others = allowedHere.filter((c) => c !== request.cli).sort((a, b) => Number(b === alt?.cli) - Number(a === alt?.cli))
        for (const other of others) {
          const next = chooseAccount(this.rooms(other, live))
          if (next.exhausted) continue
          move(other, `todas as contas do ${CLI_LABEL[request.cli]} estão no limite`)
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
    if (options.tier && request.cli !== 'shell') {
      const seat = seatForDifficulty(request.cli, request.model ?? null, request.effort ?? null, options.tier.difficulty, (model) => effortsFor(this.catalog, request.cli, model))
      if (seat.changed) {
        request.model = seat.model
        request.effort = seat.effort
        receipt.push(`dificuldade: ${options.tier.difficulty === 'dificil' ? 'difícil' : 'simples'} (${options.tier.by}) → ${[seat.model ?? 'modelo padrão', seat.effort && `esforço ${EFFORT_LABEL[seat.effort]}`].filter(Boolean).join(', ')}`)
      }
    }
    // Each model accepts its own levels (Codex lists them; Claude takes low…max).
    const allowed = effortsFor(this.catalog, request.cli, request.model)
    if (request.effort && request.cli !== 'shell' && !allowed.includes(request.effort)) {
      throw new Error(`Esforço "${EFFORT_LABEL[request.effort]}" não vale para ${request.model ?? `o modelo padrão do ${CLI_LABEL[request.cli]}`}; use ${allowed.map((e) => EFFORT_LABEL[e]).join(', ')}`)
    }

    const account = chosen ?? this.accountFor(request.cli, request.accountId)
    if (account && !request.model && account.model) request.model = account.model
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
    const token = randomBytes(24).toString('base64url')
    const english = this.store.settings().agentsInEnglish
    const lead = this.missionPanes(mission.id).find((p) => p.role === 'lead')
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
      addDirs: folder ? workspace.folders.filter((f) => f !== folder && (!mission.git || f !== workspace.path)) : workspace.folders.slice(1),
      rolePrompt: commandToolsNote(request.cli) + workspaceNote(workspace.folders) + instructionsNote(workspace.instructions) + (branch && mission.git ? worktreeNote(mission.git, request.role, branch, cwd) : '') + this.skillNote(request.cli, policy) + (request.role === 'lead' ? projectMemoryNote(this.projectMemory(mission.workspaceId)) + leadRole(mission, { id }, squad, routing, english) : crewRole(mission, { id }, { boss: options.boss ?? lead, children: options.children ?? 0, english }, squadRole, taskType)),
      task: request.task?.trim() ? request.task.trim().slice(0, 20000) : null,
      orbitCommand: hookCommand(process.execPath, ORBIT_CLI_SCRIPT),
    })

    if (request.cli === 'codex') launch.disabledMcp = codexDisabledMcp(this.store.disabledCatalog())
    // Codex has no hooks to refuse edits: an orchestrating lead and read-only kinds run in its
    // read-only sandbox, where any file change needs the person's approval.
    if (request.cli === 'codex' && ((request.role === 'lead' && (mission.mode === 'agentica' || mission.mode === 'squad')) || taskType?.readOnly)) launch.sandbox = 'read-only'
    if (options.resume) launch.resume = options.resume

    let pane: Pane
    try {
      pane = this.panes.spawn({
        id,
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
    } catch (error) {
      removeAgentFiles(this.paneDir(id))
      throw error
    }
    this.paneTokens.set(token, id)
    // Enough to open it again later; the account is the one it really ran as (its conversations live there).
    this.store.setPaneSpec(id, { ...input, task: null, accountId: account?.id ?? null })
    if (policy) this.skillPolicies.set(id, policy)
    if (taskType?.readOnly) this.readOnly.add(id)
    if (request.cli === 'codex') this.watchCodex()
    this.syncPane(pane)
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
  private restartPane(paneId: number, resume: boolean, message?: string): Pane {
    const pane = this.store.pane(paneId)
    if (!pane) throw new Error(`#${paneId} não existe`)
    const spec = this.store.paneSpec(paneId)
    if (!spec || (pane.cli === 'shell' && resume)) throw new Error(resume ? 'Não há conversa para retomar neste agente' : `#${paneId} foi aberto antes desta versão do Orbit; abra um novo`)
    if (resume && !pane.sessionId) throw new Error(`O ${CLI_LABEL[pane.cli]} ainda não informou a conversa de #${paneId}`)
    const sessionId = pane.sessionId
    const git = this.store.mission(pane.missionId)?.git
    const worktree = git && pane.branch ? { path: this.worktreeOf(pane, git), branch: pane.branch } : undefined
    const accept = this.acceptance.get(paneId)
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
    if (resume && sessionId) this.panes.setSession(opened.id, sessionId)
    if (pane.assignedBy !== null && pane.handoffStatus === null) this.panes.setHandoff(opened.id, { status: null, assignedBy: pane.assignedBy })
    return this.store.pane(opened.id) ?? opened
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
    this.panes.forget(id)
    this.codexRollouts.delete(id)
    this.codexTurns.delete(id)
    this.nudged.delete(id)
    this.acceptance.delete(id)
    this.readOnly.delete(id)
    this.skillPolicies.delete(id)
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
