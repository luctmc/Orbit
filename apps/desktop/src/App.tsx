import { useEffect, useRef, useState } from 'react'
import { restoreMissionSelection } from './orbit/missionSelection.ts'
import { hasNewPanes, selectedAfterRemoval } from './orbit/paneLayout.ts'
import type { Mission } from '@orbit/protocol'
import { useOrbit, useOrbitClient } from './orbit/context.tsx'
import { TitleBar, WorkspaceTabs } from './components/chrome.tsx'
import { MissionRail } from './components/MissionRail.tsx'
import { MissionView, type Layout } from './components/MissionView.tsx'
import { AddAgentDialog, NewMissionDialog } from './components/dialogs.tsx'
import { WorkspaceDialog } from './components/WorkspaceDialog.tsx'
import { SquadsDialog } from './components/SquadsDialog.tsx'
import { HomeView } from './components/HomeView.tsx'
import { RoutingDialog } from './components/RoutingDialog.tsx'
import { UpdaterProvider, useUpdater } from './orbit/updater.ts'
import { useNotifications } from './orbit/notify.ts'
import { OrbitMark, PlusIcon } from './components/icons.tsx'

type DialogKind = 'workspace' | 'workspace-edit' | 'mission' | 'agent' | 'squads' | 'routing' | 'accounts' | 'about' | null

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
  const updater = useUpdater()
  useEffect(() => {
    if (state.connection !== 'open') return
    const refresh = () => { if (document.visibilityState === 'visible') client.send({ type: 'limits.refresh' }) }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh) }
  }, [client, state.connection])
  const [workspaceId, setWorkspaceId] = useState<string | null>(() => remembered('workspace', null))
  const [missionId, setMissionId] = useState<string | null>(() => remembered('mission', null))
  const [selections, setSelections] = useState<Record<string, number | null>>(() => remembered('missionSelections', {}))
  const [layouts, setLayouts] = useState<Record<string, Layout>>(() => remembered('missionLayouts', {}))
  const [visited, setVisited] = useState<string[]>([])
  const previousPanes = useRef<Map<string, number[]>>(new Map())
  const [dialog, setDialog] = useState<DialogKind>(null)
  // The app opens on the Base; picking a mission or workspace switches to the mission screen.
  const [view, setView] = useState<'home' | 'mission'>('home')

  const workspaces = [...state.workspaces].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
  const workspace = workspaces.find((w) => w.id === workspaceId) ?? workspaces[0] ?? null
  const missions = state.missions.filter((m) => m.workspaceId === workspace?.id)
  const mission = missions.find((m) => m.id === missionId) ?? missions.filter((m) => m.status === 'active').sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null
  const paneId = mission ? selections[mission.id] ?? null : null
  const setPaneId = (id: number | null) => { if (mission) setSelections(current => ({ ...current, [mission.id]: id })) }
  const liveAgents = state.panes.filter((p) => p.status !== 'exited').length

  useEffect(() => remember('workspace', workspace?.id ?? null), [workspace?.id])
  useEffect(() => remember('mission', mission?.id ?? null), [mission?.id])
  useEffect(() => remember('missionLayouts', layouts), [layouts])
  useEffect(() => remember('missionSelections', selections), [selections])
  useEffect(() => {
    if (mission && view === 'mission') setVisited(current => current.includes(mission.id) ? current : [...current, mission.id])
  }, [mission?.id, view])
  useEffect(() => {
    if (state.connection !== 'open') return
    if (!state.snapshotReady) return
    setSelections(current => {
      const next = restoreMissionSelection(current, state.missions.map(m => m.id), state.panes)
      return JSON.stringify(next) === JSON.stringify(current) ? current : next
    })
    const next = new Map<string, number[]>()
    const reveal: string[] = []
    for (const item of state.missions) {
      const ids = state.panes.filter(p => p.missionId === item.id).sort((a, b) => a.role === b.role ? a.id - b.id : a.role === 'lead' ? -1 : 1).map(p => p.id)
      const previous = previousPanes.current.get(item.id)
      if (previous && hasNewPanes(previous, ids)) reveal.push(item.id)
      if (previous && previous.some(id => !ids.includes(id))) {
        setSelections(current => ({ ...current, [item.id]: selectedAfterRemoval(previous, ids, current[item.id] ?? null) }))
      }
      next.set(item.id, ids)
    }
    previousPanes.current = next
    if (reveal.length) setLayouts(current => ({ ...current, ...Object.fromEntries(reveal.map(id => [id, 'grade'])) }))
  }, [state.panes, state.missions, state.connection, state.snapshotReady, mission?.id])

  // A mission created while the app is open becomes the active one (not the ones a schedule starts).
  const followed = useRef<string | null>(null)
  const newest = state.missions.filter((m) => !m.scheduleId).reduce<Mission | null>((a, m) => (!a || m.createdAt > a.createdAt ? m : a), null)
  useEffect(() => {
    if (!newest || newest.createdAt < BOOT_AT || followed.current === newest.id) return
    followed.current = newest.id
    setWorkspaceId(newest.workspaceId)
    setMissionId(newest.id)
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
    setView('mission')
  }

  // Notifications, the Dock badge, and opening the agent a notification was about.
  useNotifications((targetMission, targetPane) => {
    const found = state.missions.find((m) => m.id === targetMission)
    if (!found) return
    openMission(found)
    setSelections(current => ({ ...current, [targetMission]: targetPane }))
  })

  return (
    <UpdaterProvider value={updater}>
    <div className="app">
      <TitleBar connection={state.connection} liveAgents={liveAgents} limits={state.limits} accounts={state.accounts} onAbout={() => setDialog('about')} />
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
        pendingProposals={state.proposals.filter((p) => p.status === 'pendente').length}
      />

      {state.lastError && (
        <div className="toast" role="alert">
          <span>{state.lastError}</span>
          <button className="btn btn--ghost btn--sm" onClick={() => client.dismissError()}>Ok</button>
        </div>
      )}

      {state.startup && state.startup.some(task => task.state !== 'ready') && <details className="startup-status"><summary><span className="dot dot--idle" />{state.startup.some(task => task.state === 'error') ? 'Alguns serviços precisam de atenção' : 'Preparando seu ambiente em segundo plano…'}</summary><ul>{state.startup.map(task => <li key={task.id}><strong>{{ recovery: 'Retomada das equipes', catalog: 'Catálogo de modelos', accounts: 'Contas', clis: 'CLIs', skills: 'Skills' }[task.id]}</strong><span>{task.state === 'ready' ? 'Pronto' : task.state === 'error' ? task.message || 'Falha ao iniciar' : task.state === 'running' ? 'Em preparação' : 'Aguardando'}</span></li>)}</ul></details>}

      {(!workspace || view === 'home') && (
        <HomeView
          onOpenMission={openMission}
          onOpenWorkspace={(w) => { setWorkspaceId(w.id); setMissionId(null); setView('mission') }}
          onNewMission={workspace ? () => setDialog('mission') : null}
          onAddFolder={() => setDialog('workspace')}
          onOpenAccounts={() => setDialog('accounts')}
        />
      )}
      {workspace && (
        <div className="body" hidden={view !== 'mission'}>
          <MissionRail
            workspace={workspace}
            onEditWorkspace={() => setDialog('workspace-edit')}
            missions={missions}
            panes={state.panes}
            activeMissionId={mission?.id ?? null}
            selectedPaneId={paneId}
            onSelectMission={setMissionId}
            onSelectPane={setPaneId}
            onNewMission={() => setDialog('mission')}
          />
          {state.missions.filter(item => visited.includes(item.id) || (view === 'mission' && item.id === mission?.id)).map(item => {
            const active = view === 'mission' && item.id === mission?.id
            return <div key={item.id} className="mission-cache" hidden={!active}>
              <MissionView
                mission={item}
                active={active}
                panes={state.panes.filter(p => p.missionId === item.id).sort((a, b) => a.role === b.role ? a.id - b.id : a.role === 'lead' ? -1 : 1)}
                selectedPaneId={selections[item.id] ?? null}
                layout={layouts[item.id] === 'foco' ? 'foco' : layouts[item.id] === 'livre' ? 'livre' : 'grade'}
                onLayout={next => setLayouts(current => ({ ...current, [item.id]: next }))}
                onSelectPane={setPaneId}
                onAddAgent={() => setDialog('agent')}
              />
            </div>
          })}
          {!mission && (
            <main className="mission empty">
              <p>Nenhuma missão em <strong>{workspace.name}</strong>.</p>
              <button className="btn btn--primary" onClick={() => setDialog('mission')}><PlusIcon size={14} />Nova missão</button>
            </main>
          )}
        </div>
      )}

      {dialog === 'workspace' && <WorkspaceDialog onClose={() => setDialog(null)} />}
      {dialog === 'workspace-edit' && workspace && <WorkspaceDialog workspace={workspace} onClose={() => setDialog(null)} />}
      {dialog === 'mission' && workspace && <NewMissionDialog workspaceId={workspace.id} workspaceName={workspace.name} onClose={() => setDialog(null)} onManageSquads={() => setDialog('squads')} onManageRouting={() => setDialog('routing')} />}
      {dialog === 'agent' && mission && <AddAgentDialog missionId={mission.id} onClose={() => setDialog(null)} />}
      {dialog === 'squads' && <SquadsDialog onClose={() => setDialog(null)} />}
      {dialog === 'routing' && <RoutingDialog onClose={() => setDialog(null)} />}
      {dialog === 'accounts' && <RoutingDialog initialTab="contas" onClose={() => setDialog(null)} />}
      {dialog === 'about' && <RoutingDialog initialTab="clis" onClose={() => setDialog(null)} />}
    </div>
    </UpdaterProvider>
  )
}
