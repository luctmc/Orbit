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
  status: MissionStatus
  createdAt: number
  updatedAt: number
}

export type AgentCli = 'claude' | 'codex' | 'shell'
export type PaneRole = 'lead' | 'crew'
/** `waiting` = the agent needs a human; set by hook reports, not by output heuristics. */
export type PaneStatus = 'starting' | 'running' | 'idle' | 'waiting' | 'exited'

export interface Pane {
  id: number
  missionId: string
  role: PaneRole
  cli: AgentCli
  model: string | null
  title: string
  cwd: string
  status: PaneStatus
  pid: number | null
  exitCode: number | null
  createdAt: number
}

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
}

export interface SpawnPaneRequest {
  missionId: string
  role: PaneRole
  cli: AgentCli
  model: string | null
  title: string
}

export type ClientMessage =
  | { type: 'workspace.open'; path: string }
  | { type: 'mission.create'; workspaceId: string; title: string; objective: string; mode: MissionMode; lead: Omit<SpawnPaneRequest, 'missionId' | 'role'> }
  | { type: 'mission.archive'; missionId: string }
  | { type: 'pane.spawn'; request: SpawnPaneRequest }
  | { type: 'pane.input'; paneId: number; data: string }
  | { type: 'pane.resize'; paneId: number; cols: number; rows: number }
  /** Kills the process if alive and removes the pane from the mission. */
  | { type: 'pane.close'; paneId: number }

export type ServerMessage =
  | { type: 'snapshot'; snapshot: Snapshot }
  | { type: 'pane.scrollback'; paneId: number; data: string }
  | { type: 'pane.data'; paneId: number; data: string }
  | { type: 'workspace.updated'; workspace: Workspace }
  | { type: 'mission.updated'; mission: Mission }
  | { type: 'pane.updated'; pane: Pane }
  | { type: 'pane.removed'; paneId: number }
  | { type: 'event.added'; event: MissionEvent }
  | { type: 'error'; message: string }

/** Model ids reach a shell command line, so only plain identifiers are accepted. */
export const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/
