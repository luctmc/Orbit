// Wire contract between the Orbit UI and the sidecar (JSON over one WebSocket).

export type MissionMode = 'livre' | 'squad' | 'agentica'
export type MissionStatus = 'active' | 'archived'

export interface Workspace {
  id: string
  path: string
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
  cli: AgentCli
  model: string | null
  title: string
  cwd: string
  status: PaneStatus
  /** Why the agent needs a human, from its hook (e.g. a permission prompt). */
  attention: string | null
  /** Last time this helper submitted a handoff to the lead. */
  deliveredAt: number | null
  pid: number | null
  exitCode: number | null
  createdAt: number
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

export type MissionEventKind = 'mission.created' | 'pane.spawned' | 'pane.exited' | 'pane.waiting' | 'handoff'

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
}

export type ClientMessage =
  | { type: 'workspace.open'; path: string }
  | { type: 'mission.create'; workspaceId: string; title: string; objective: string; mode: MissionMode; squadId?: string | null; lead: Omit<SpawnPaneRequest, 'missionId' | 'role'> }
  | { type: 'mission.archive'; missionId: string }
  | { type: 'pane.spawn'; request: SpawnPaneRequest }
  | { type: 'pane.input'; paneId: number; data: string }
  | { type: 'pane.resize'; paneId: number; cols: number; rows: number }
  /** Kills the process if alive and removes the pane from the mission. */
  | { type: 'pane.close'; paneId: number }
  /** Creates or replaces a custom squad (builtins cannot be changed). */
  | { type: 'squad.save'; squad: SquadInput }
  | { type: 'squad.delete'; squadId: string }

export type ServerMessage =
  | { type: 'snapshot'; snapshot: Snapshot }
  | { type: 'pane.scrollback'; paneId: number; data: string }
  | { type: 'pane.data'; paneId: number; data: string }
  | { type: 'workspace.updated'; workspace: Workspace }
  | { type: 'mission.updated'; mission: Mission }
  | { type: 'pane.updated'; pane: Pane }
  | { type: 'pane.removed'; paneId: number }
  | { type: 'event.added'; event: MissionEvent }
  | { type: 'squad.updated'; squad: Squad }
  | { type: 'squad.removed'; squadId: string }
  | { type: 'error'; message: string }

/** Model ids reach a shell command line, so only plain identifiers are accepted. */
export const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/
/** Squad and role ids. */
export const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/

export const SQUAD_LIMITS = { name: 60, description: 280, playbook: 8000, brief: 4000, roles: 8 } as const
