// Wire contract between the Orbit UI and the sidecar (JSON over one WebSocket).

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
  usage: TokenUsage
  status: MissionStatus
  createdAt: number
  updatedAt: number
}

export type AgentCli = 'claude' | 'codex' | 'shell'
/** CLIs that can fill a squad role (a plain terminal cannot follow a brief). */
export type AgentCliForRole = Exclude<AgentCli, 'shell'>
export type PaneRole = 'lead' | 'crew'
/** `waiting` = the agent needs a human; set by hook reports, not by output heuristics. */
export type PaneStatus = 'starting' | 'running' | 'idle' | 'waiting' | 'exited'

export interface Pane {
  id: number
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
  title: string
  cwd: string
  status: PaneStatus
  /** Why the agent needs a human, from its hook (e.g. a permission prompt). */
  attention: string | null
  /** Last time this helper submitted a handoff to the lead. */
  deliveredAt: number | null
  /** Session totals reported by the CLI (status line for Claude, session file for Codex). */
  usage: TokenUsage | null
  /** How full the model's context window is, 0–100, when the CLI says. */
  contextPercent: number | null
  pid: number | null
  exitCode: number | null
  createdAt: number
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
export interface AccountLimits {
  accountId: string
  cli: AgentCliForRole
  fiveHour: RateWindow | null
  weekly: RateWindow | null
  plan: string | null
  updatedAt: number
}

/** Tokens used on one local day (YYYY-MM-DD), per CLI. */
export interface UsageDay {
  day: string
  claude: number
  codex: number
}

/** One seat in a squad: who fills it and what they are told to do. */
export interface SquadRole {
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
}

export interface CliCatalog {
  models: ModelInfo[]
  /** Levels the CLI accepts when the model is not in the list (its own default model, an alias…). */
  efforts: Effort[]
  /** `cli`: read from the installed CLI; `builtin`: Orbit's list, when the CLI cannot be asked. */
  source: 'cli' | 'builtin'
}

export type Catalog = Record<AgentCliForRole, CliCatalog>

/** Effort levels valid for this CLI and model. */
export function effortsFor(catalog: Catalog | null, cli: AgentCli, model: string | null): readonly Effort[] {
  if (cli === 'shell') return []
  if (!catalog) return EFFORTS
  const entry = catalog[cli]
  return entry.models.find((m) => m.id === model)?.efforts ?? entry.efforts
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
}

/** Agentic missions: the lead's default and the task table it routes helpers through. */
export interface Routing {
  lead: { cli: AgentCliForRole; model: string | null; effort: Effort | null }
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
/** Above this, a window counts as used up when Orbit picks an account. */
export const ACCOUNT_FULL_PERCENT = 95

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

export type MissionEventKind = 'mission.created' | 'pane.spawned' | 'pane.exited' | 'pane.waiting' | 'handoff' | 'browser'

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
}

export interface SpawnPaneRequest {
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
}

export type ClientMessage =
  | { type: 'workspace.open'; path: string }
  /** A workspace made of several folders; the first is the main one. */
  | { type: 'workspace.create'; name: string; folders: string[] }
  /** Rename, or replace the folder list (new agents get the new list). */
  | { type: 'workspace.update'; workspaceId: string; name?: string; folders?: string[] }
  | { type: 'mission.create'; workspaceId: string; title: string; objective: string; mode: MissionMode; squadId?: string | null; lead: Omit<SpawnPaneRequest, 'missionId' | 'role'> }
  | { type: 'mission.archive'; missionId: string }
  | { type: 'pane.spawn'; request: SpawnPaneRequest }
  /** A terminal view mounted: send me this pane's current screen, then its live output. */
  | { type: 'pane.attach'; paneId: number }
  /** Raw keystrokes from the terminal view. */
  | { type: 'pane.input'; paneId: number; data: string }
  /** A whole message typed elsewhere (the command bar): pasted, then submitted with Enter. */
  | { type: 'pane.submit'; paneId: number; text: string }
  | { type: 'pane.resize'; paneId: number; cols: number; rows: number }
  /** Kills the process if alive and removes the pane from the mission. */
  | { type: 'pane.close'; paneId: number }
  | { type: 'pane.rename'; paneId: number; title: string }
  /** Opens the agent again with the same settings: a new conversation, or (resume) the same one. */
  | { type: 'pane.restart'; paneId: number; resume: boolean }
  /** Another helper with the same settings, without a task. */
  | { type: 'pane.duplicate'; paneId: number }
  /** Creates or replaces a custom squad (builtins cannot be changed). */
  | { type: 'squad.save'; squad: SquadInput }
  | { type: 'squad.delete'; squadId: string }
  | { type: 'routing.save'; routing: Routing }
  /** Look up installed versions, the latest releases and the model catalogs again. */
  | { type: 'cli.check' }
  | { type: 'cli.update'; cli: AgentCliForRole }
  /** Back to the table Orbit ships with. */
  | { type: 'routing.reset' }
  | { type: 'account.save'; account: AccountInput }
  | { type: 'account.delete'; accountId: string }
  /** Ask each CLI about its accounts' logins again. */
  | { type: 'account.check' }
  /** Opens a terminal running the CLI's login for this account. */
  | { type: 'account.login'; accountId: string }
  /** Git status of each folder of the workspace (answered to this connection only). */
  | { type: 'files.status'; workspaceId: string; missionId?: string | null }
  | { type: 'files.tree'; workspaceId: string; folder: string }
  | { type: 'files.diff'; workspaceId: string; folder: string; path: string }
  | { type: 'files.read'; workspaceId: string; folder: string; path: string }
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

export type ServerMessage =
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
  | { type: 'catalog'; catalog: Catalog }
  | { type: 'usage.day'; day: UsageDay }
  | { type: 'limits'; limits: AccountLimits[] }
  | { type: 'cli.status'; clis: CliStatus[] }
  | { type: 'accounts'; accounts: Account[] }
  | { type: 'account.status'; statuses: AccountStatus[] }
  | { type: 'files.status'; workspaceId: string; folders: FolderStatus[] }
  | { type: 'update.status'; status: UpdateStatus }
  /** A files.* question failed (answered to the asking connection). */
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
export const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$/
/** Squad and role ids. */
export const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/

export const SQUAD_LIMITS = { name: 60, description: 280, playbook: 8000, brief: 4000, roles: 8 } as const
export const WORKSPACE_LIMITS = { folders: 10, name: 60 } as const
export const ROUTING_LIMITS = { taskTypes: 16, name: 40, description: 200, skills: 6, skill: 40 } as const
