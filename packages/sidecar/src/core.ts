import { readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ACCOUNT_LIMITS, CARD_COLUMNS, CARD_LIMITS, MODEL_ID, SCHEDULE_LIMITS, TEMPLATE_LIMITS, type MissionTemplate, type MissionTemplateInput, EFFORT_LABEL, EFFORTS, SESSION_ID, type Card, type CardColumn, WORKSPACE_LIMITS, effortsFor, type Account, type AccountInput, type AccountStatus, type AgentCli, type BrowserInput, type CatalogItem, type GitSummary, type MissionGit, type PrStatus, type Schedule, type ScheduleInput, type AgentCliForRole, type Catalog, type CliStatus, type ClientMessage, type Effort, type Mission, type MissionEvent, type MissionEventKind, type MissionMode, type Pane, type ServerMessage, type SpawnPaneRequest, type Squad, type TaskType } from '@orbit/protocol'
import { BrowserHost, findBrowser, type BrowserEngine } from './browser.ts'
import { AccountFiles, blankAccountStatus, keyHint, normalizeAccount, pickAccount, userConfigDir, validKey } from './accounts.ts'
import { codexDisabledMcp, gateTool, scanCatalog, type SkillPolicy } from './skills.ts'
import { dueSchedules, nextRun, normalizeWhen } from './schedules.ts'
import { fileDiff, folderStatus, folderTree, readFile } from './files.ts'
import { Updates } from './updates.ts'
import { missionReport } from './report.ts'
import { addWorktree, BRANCH, commitsAhead, dirtyFiles, filesChanged, hasRemote, pushBranch, removeWorktree, repoInfo } from './git.ts'
import { slugify } from './squads.ts'
import { normalizeRouting } from './routing.ts'
import { codexHome, codexSessionId, findCodexRollout, fromClaudeStatus, fromCodexRollout, readTail, usageDelta, type UsageReport } from './usage.ts'
import { blankStatus, inspectCli, latestVersion, loadCatalog, loginShellRunner, runUpdate, type Run } from './clis.ts'
import { hookCommand, removeAgentFiles, writeAgentFiles } from './agentFiles.ts'
import { shellQuote, type AgentLaunch, type PaneCommand } from './command.ts'
import { statusFromHook, type HookPayload } from './hooks.ts'
import { PaneManager, type PaneSnapshot } from './panes.ts'
import { crewRole, instructionsNote, leadRole, objectiveTask, workspaceNote, worktreeNote } from './prompts.ts'
import { normalizeSquad } from './squads.ts'
import { Store } from './store.ts'

const CLIS: readonly AgentCli[] = ['claude', 'codex', 'shell']
const MODES: readonly MissionMode[] = ['livre', 'squad', 'agentica']
const CLI_LABEL: Record<AgentCli, string> = { claude: 'Claude', codex: 'Codex', shell: 'Terminal' }
const HOOK_SCRIPT = process.env.ORBIT_HOOK_SCRIPT ?? fileURLToPath(new URL('../hooks/report.mjs', import.meta.url))
/** Lives next to the hook script, in dev and in the app bundle. */
const STATUS_SCRIPT = join(dirname(HOOK_SCRIPT), 'statusline.mjs')
/** How often live Codex agents' session files are read for usage. */
const CODEX_POLL_MS = 5000

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
  private readonly clis = new Map<AgentCliForRole, CliStatus>([['claude', blankStatus('claude')], ['codex', blankStatus('codex')]])
  /** Codex agent → its session file, once found. */
  private readonly codexRollouts = new Map<number, string>()
  private codexTimer: NodeJS.Timeout | null = null
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

  /** Installed version, install method and latest release of each CLI, plus the catalogs. */
  async checkClis(): Promise<void> {
    await Promise.all((['claude', 'codex'] as const).map(async (cli) => {
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
    if (cli === 'codex') await this.refreshCatalog()
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
    if (policy?.only) lines.push(policy.only.length ? `Neste papel use só estas skills: ${policy.only.join(', ')}.` : 'Neste papel não use skills.')
    if (names.length) lines.push(`Desligadas no Orbit (não use): ${names.slice(0, 40).join(', ')}${names.length > 40 ? '…' : ''}.`)
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
    const loginPaneId = this.accountStatus.get(accountId)?.loginPaneId ?? null
    this.setAccountStatus(accountId, { ...found, checkedAt: Date.now(), busy: loginPaneId && this.panes.isAlive(loginPaneId) ? 'login' : null })
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
        if (message.cli !== 'claude' && message.cli !== 'codex') throw new Error('CLI desconhecida')
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
        this.panes.write(message.paneId, message.data)
        return
      case 'pane.submit':
        // Text and Enter in one write look like a paste to TUIs, which then keep the Enter as a newline.
        if (!this.panes.submit(message.paneId, message.text)) throw new Error(`#${message.paneId} não está rodando`)
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

  spawnHelper(caller: Pane, input: { title: string; task: string; cli: AgentCli; model: string | null; effort?: Effort | null; squadRoleId?: string | null; taskTypeId?: string | null }): Pane {
    return this.spawn({ missionId: caller.missionId, role: 'crew', ...input })
  }

  /** Sends text to another agent of the same mission, as if typed by a person. */
  sendTo(caller: Pane, targetId: number, text: string): void {
    const target = this.sameMission(caller, targetId)
    if (!this.panes.submit(target.id, `[Orbit] Mensagem de #${caller.id}: ${text}`)) throw new Error(`#${targetId} não está rodando`)
  }

  /** The lead closes a helper of its own mission (kills the process, removes the pane). */
  closeHelper(caller: Pane, targetId: number): void {
    const target = this.sameMission(caller, targetId)
    if (target.role === 'lead') throw new Error('O líder não pode ser fechado por aqui')
    this.closePane(target.id)
  }

  readScreen(caller: Pane, targetId: number, lines: number): string {
    const target = this.sameMission(caller, targetId)
    return this.panes.screenText(target.id, lines)
  }

  /** A helper's result: recorded in the mission flow and typed into the lead's terminal. */
  handoff(caller: Pane, summary: string, details: string): { deliveredTo: number | null } {
    let text = summary.trim().slice(0, 2000)
    if (!text) throw new Error('O resumo do retorno está vazio')
    const git = this.store.mission(caller.missionId)?.git
    if (git && caller.branch && caller.branch !== git.branch) {
      const dirty = safe(() => dirtyFiles(this.worktreeOf(caller, git)), [])
      const ahead = safe(() => commitsAhead(git.repo, git.branch, caller.branch!).length, 0)
      const notes = [
        ahead ? `branch ${caller.branch} com ${ahead} commit(s) para integrar (git merge ${caller.branch})` : `branch ${caller.branch} sem commits novos`,
        dirty.length ? `atenção: ${dirty.length} arquivo(s) sem commit no branch dele` : null,
      ].filter(Boolean)
      text = `${text} [${notes.join('; ')}]`
    }
    const body = details.trim() ? `${text}\n\n${details.trim().slice(0, 20000)}` : text
    this.event(caller.missionId, 'handoff', `Retorno de #${caller.id}`, body, caller.id)
    this.panes.markDelivered(caller.id)

    const lead = this.missionPanes(caller.missionId).find((p) => p.role === 'lead' && p.id !== caller.id && this.panes.isAlive(p.id))
    if (!lead) return { deliveredTo: null }
    const more = details.trim() ? ' (detalhes em handoff_list)' : ''
    this.panes.submit(lead.id, `[Orbit] Retorno de #${caller.id} (${caller.title}): ${text}${more}`)
    return { deliveredTo: lead.id }
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
      const added = this.store.addUsage(pane.missionId, pane.cli, usageDelta(pane.usage, report.usage))
      if (added) {
        this.broadcast({ type: 'mission.updated', mission: added.mission })
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
          file = findCodexRollout(home, pane.cwd, pane.createdAt, new Set(this.codexRollouts.values())) ?? undefined
          if (!file) continue
          this.codexRollouts.set(pane.id, file)
          const sessionId = codexSessionId(file)
          if (sessionId) this.panes.setSession(pane.id, sessionId)
        }
        this.applyReport(pane.id, fromCodexRollout(readTail(file)))
      } catch {
        // the file may be mid-write; try again on the next tick
      }
    }
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
    const next = statusFromHook(payload)
    if (next) this.panes.report(paneId, next.status, next.attention)
    const pane = this.store.pane(paneId)
    if (pane) this.noteEdit(pane, payload)
    if (typeof payload.session_id === 'string' && SESSION_ID.test(payload.session_id)) this.panes.setSession(paneId, payload.session_id)
    const reason = gateTool(payload, new Set(this.store.disabledCatalog()), this.skillPolicies.get(paneId))
    return reason ? { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } } : null
  }

  shutdown(): void {
    if (this.codexTimer) clearInterval(this.codexTimer)
    if (this.scheduleTimer) clearInterval(this.scheduleTimer)
    this.browser.shutdown()
    this.panes.killAll()
    this.store.flush()
  }

  // ---- internals ----

  /** `resume` continues that conversation of the CLI; `opened` replaces the flow's "Agente #N aberto". */
  private spawn(input: SpawnPaneRequest, options: { resume?: string; opened?: (id: number) => string; worktree?: { path: string; branch: string } } = {}): Pane {
    const mission = this.store.mission(input.missionId)
    if (!mission || mission.status !== 'active') throw new Error('Missão inexistente ou arquivada')
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
    if (!CLIS.includes(request.cli)) throw new Error(`Agente inválido: ${request.cli}`)
    if (request.effort && !EFFORTS.includes(request.effort)) throw new Error(`Esforço inválido: ${request.effort}`)
    // Each model accepts its own levels (Codex lists them; Claude takes low…max).
    const allowed = effortsFor(this.catalog, request.cli, request.model)
    if (request.effort && request.cli !== 'shell' && !allowed.includes(request.effort)) {
      throw new Error(`Esforço "${EFFORT_LABEL[request.effort]}" não vale para ${request.model ?? `o modelo padrão do ${CLI_LABEL[request.cli]}`}; use ${allowed.map((e) => EFFORT_LABEL[e]).join(', ')}`)
    }

    const account = this.accountFor(request.cli, request.accountId)
    if (account && !request.model && account.model) request.model = account.model
    if (account) this.accountFiles.prepare(account)

    const roleSkills = squadRole ?? taskType
    const policy: SkillPolicy | undefined = roleSkills?.onlySkills ? { only: roleSkills.skills } : undefined

    const id = this.store.allocatePaneId()
    // Worktree missions: the lead on the mission branch, each helper on its own branch cut from it.
    let cwd = workspace.path
    let branch: string | null = null
    if (mission.git) {
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
      addDirs: workspace.folders.slice(1),
      rolePrompt: workspaceNote(workspace.folders) + instructionsNote(workspace.instructions) + (branch && mission.git ? worktreeNote(mission.git, request.role, branch, cwd) : '') + this.skillNote(request.cli, policy) + (request.role === 'lead' ? leadRole(mission, { id }, squad, routing) : crewRole(mission, { id }, lead, squadRole, taskType)),
      task: request.task?.trim() ? request.task.trim().slice(0, 20000) : null,
    })

    if (request.cli === 'codex') launch.disabledMcp = codexDisabledMcp(this.store.disabledCatalog())
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
        hookDriven: request.cli === 'claude',
        accountId: account?.id ?? null,
        env: {
          ...(account ? this.accountFiles.env(account) : {}),
          ORBIT_PANE_ID: String(id),
          ORBIT_MISSION_ID: mission.id,
          ORBIT_PANE_TOKEN: token,
          ORBIT_HOOK_URL: `${this.endpoint}/hooks`,
          ORBIT_STATUS_URL: `${this.endpoint}/status`,
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
    if (request.cli === 'codex') this.watchCodex()
    this.syncPane(pane)
    const seat = request.role === 'lead' ? 'líder' : squadRole?.name.toLowerCase() ?? taskType?.name.toLowerCase() ?? 'ajudante'
    const who = [CLI_LABEL[request.cli], account && !account.builtin && account.name, request.model, request.effort && `esforço ${EFFORT_LABEL[request.effort]}`, seat].filter(Boolean).join(' · ')
    this.event(mission.id, 'pane.spawned', options.opened?.(id) ?? `Agente #${id} aberto`, `${title} — ${who}`, id)
    return pane
  }

  /** Opens an agent again with its settings: a new conversation or, with `resume`, the same one. */
  private restartPane(paneId: number, resume: boolean): void {
    const pane = this.store.pane(paneId)
    if (!pane) throw new Error(`#${paneId} não existe`)
    const spec = this.store.paneSpec(paneId)
    if (!spec || (pane.cli === 'shell' && resume)) throw new Error(resume ? 'Não há conversa para retomar neste agente' : `#${paneId} foi aberto antes desta versão do Orbit; abra um novo`)
    if (resume && !pane.sessionId) throw new Error(`O ${CLI_LABEL[pane.cli]} ainda não informou a conversa de #${paneId}`)
    const sessionId = pane.sessionId
    const git = this.store.mission(pane.missionId)?.git
    const worktree = git && pane.branch ? { path: this.worktreeOf(pane, git), branch: pane.branch } : undefined
    this.closePane(paneId)
    this.spawn({ ...spec, title: pane.title }, {
      worktree,
      resume: resume ? sessionId! : undefined,
      opened: (id) => (resume ? `#${id} retomou a conversa de #${paneId}` : `#${id} reabriu #${paneId}`),
    })
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
