import { useEffect, useRef, useState } from 'react'
import type { Mission } from '@orbit/protocol'
import { useOrbit, useOrbitClient } from './orbit/context.tsx'
import { TitleBar, WorkspaceTabs } from './components/chrome.tsx'
import { MissionRail } from './components/MissionRail.tsx'
import { MissionView, type Layout } from './components/MissionView.tsx'
import { FlowTimeline } from './components/FlowTimeline.tsx'
import { AddAgentDialog, NewMissionDialog } from './components/dialogs.tsx'
import { WorkspaceDialog } from './components/WorkspaceDialog.tsx'
import { SquadsDialog } from './components/SquadsDialog.tsx'
import { HomeView } from './components/HomeView.tsx'
import { RoutingDialog } from './components/RoutingDialog.tsx'
import { OrbitMark, PlusIcon } from './components/icons.tsx'

type DialogKind = 'workspace' | 'workspace-edit' | 'mission' | 'agent' | 'squads' | 'routing' | null

const BOOT_AT = Date.now()

/** Per-viewer UI memory; storage may be unavailable, so every access is guarded. */
function remembered<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`orbit.${key}`)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}
function remember(key: string, value: unknown): void {
  try {
    localStorage.setItem(`orbit.${key}`, JSON.stringify(value))
  } catch {
    // ignore
  }
}

export function App() {
  const state = useOrbit()
  const client = useOrbitClient()
  const [workspaceId, setWorkspaceId] = useState<string | null>(() => remembered('workspace', null))
  const [missionId, setMissionId] = useState<string | null>(() => remembered('mission', null))
  const [paneId, setPaneId] = useState<number | null>(null)
  const [layout, setLayout] = useState<Layout>(() => remembered('layout', 'grade'))
  const [dialog, setDialog] = useState<DialogKind>(null)
  // The app opens on the Base; picking a mission or workspace switches to the mission screen.
  const [view, setView] = useState<'home' | 'mission'>('home')

  const workspaces = [...state.workspaces].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
  const workspace = workspaces.find((w) => w.id === workspaceId) ?? workspaces[0] ?? null
  const missions = state.missions.filter((m) => m.workspaceId === workspace?.id)
  const mission = missions.find((m) => m.id === missionId) ?? missions.filter((m) => m.status === 'active').sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null
  const panes = state.panes.filter((p) => p.missionId === mission?.id).sort((a, b) => (a.role === b.role ? a.id - b.id : a.role === 'lead' ? -1 : 1))
  const events = state.events.filter((e) => e.missionId === mission?.id)
  const liveAgents = state.panes.filter((p) => p.status !== 'exited').length

  useEffect(() => remember('workspace', workspace?.id ?? null), [workspace?.id])
  useEffect(() => remember('mission', mission?.id ?? null), [mission?.id])
  useEffect(() => remember('layout', layout), [layout])

  // A mission created while the app is open becomes the active one.
  const followed = useRef<string | null>(null)
  const newest = state.missions.reduce<Mission | null>((a, m) => (!a || m.createdAt > a.createdAt ? m : a), null)
  useEffect(() => {
    if (!newest || newest.createdAt < BOOT_AT || followed.current === newest.id) return
    followed.current = newest.id
    setWorkspaceId(newest.workspaceId)
    setMissionId(newest.id)
    setPaneId(null)
    setView('mission')
  }, [newest])

  // Likewise for a workspace just opened.
  const newestWorkspace = workspaces[0]
  const followedWorkspace = useRef<string | null>(null)
  useEffect(() => {
    if (!newestWorkspace || newestWorkspace.lastOpenedAt < BOOT_AT || followedWorkspace.current === `${newestWorkspace.id}:${newestWorkspace.lastOpenedAt}`) return
    followedWorkspace.current = `${newestWorkspace.id}:${newestWorkspace.lastOpenedAt}`
    setWorkspaceId(newestWorkspace.id)
    setMissionId(null)
    setView('mission')
  }, [newestWorkspace])

  const openMission = (target: Mission) => {
    setWorkspaceId(target.workspaceId)
    setMissionId(target.id)
    setPaneId(null)
    setView('mission')
  }

  return (
    <div className="app">
      <TitleBar connection={state.connection} liveAgents={liveAgents} limits={state.limits} />
      <WorkspaceTabs
        workspaces={workspaces}
        activeId={view === 'mission' ? workspace?.id ?? null : null}
        homeActive={view === 'home'}
        onHome={() => setView('home')}
        onSelect={(id) => { setWorkspaceId(id); setMissionId(null); setView('mission') }}
        onOpen={() => setDialog('workspace')}
        // The Base has its own "Nova missão" in the header.
        onNewMission={workspace && view === 'mission' ? () => setDialog('mission') : null}
        onSquads={() => setDialog('squads')}
        onSettings={() => setDialog('routing')}
      />

      {state.lastError && (
        <div className="toast" role="alert">
          <span>{state.lastError}</span>
          <button className="btn btn--ghost btn--sm" onClick={() => client.dismissError()}>Ok</button>
        </div>
      )}

      {!workspace ? (
        <div className="welcome">
          <OrbitMark size={48} />
          <h1>Bem-vindo ao Orbit</h1>
          <p className="muted">Crie um workspace com uma ou mais pastas de projeto para lançar a primeira missão.</p>
          <button className="btn btn--primary" onClick={() => setDialog('workspace')} disabled={state.connection !== 'open'}>
            <PlusIcon size={14} />Novo workspace
          </button>
        </div>
      ) : view === 'home' ? (
        <HomeView
          onOpenMission={openMission}
          onOpenWorkspace={(w) => { setWorkspaceId(w.id); setMissionId(null); setView('mission') }}
          onNewMission={() => setDialog('mission')}
          onAddFolder={() => setDialog('workspace')}
        />
      ) : (
        <div className="body">
          <MissionRail
            workspace={workspace}
            onEditWorkspace={() => setDialog('workspace-edit')}
            missions={missions}
            panes={state.panes}
            activeMissionId={mission?.id ?? null}
            selectedPaneId={paneId}
            onSelectMission={(id) => { setMissionId(id); setPaneId(null) }}
            onSelectPane={setPaneId}
            onNewMission={() => setDialog('mission')}
          />
          {mission ? (
            <MissionView
              mission={mission}
              panes={panes}
              selectedPaneId={paneId}
              layout={layout}
              onLayout={setLayout}
              onSelectPane={setPaneId}
              onAddAgent={() => setDialog('agent')}
            />
          ) : (
            <main className="mission empty">
              <p>Nenhuma missão em <strong>{workspace.name}</strong>.</p>
              <button className="btn btn--primary" onClick={() => setDialog('mission')}><PlusIcon size={14} />Nova missão</button>
            </main>
          )}
          {mission && <FlowTimeline events={events} />}
        </div>
      )}

      {dialog === 'workspace' && <WorkspaceDialog onClose={() => setDialog(null)} />}
      {dialog === 'workspace-edit' && workspace && <WorkspaceDialog workspace={workspace} onClose={() => setDialog(null)} />}
      {dialog === 'mission' && workspace && <NewMissionDialog workspaceId={workspace.id} workspaceName={workspace.name} onClose={() => setDialog(null)} onManageSquads={() => setDialog('squads')} onManageRouting={() => setDialog('routing')} />}
      {dialog === 'agent' && mission && <AddAgentDialog missionId={mission.id} onClose={() => setDialog(null)} />}
      {dialog === 'squads' && <SquadsDialog onClose={() => setDialog(null)} />}
      {dialog === 'routing' && <RoutingDialog onClose={() => setDialog(null)} />}
    </div>
  )
}
