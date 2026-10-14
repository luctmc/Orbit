import { useEffect, useMemo, useRef, useState } from 'react'
import type { Mission, Pane, UsageDay, Workspace } from '@orbit/protocol'
import { useOrbit } from '../orbit/context.tsx'
import { CLI_LABEL, MODE_LABEL, STATUS, tokensText } from '../orbit/labels.ts'
import { pathText } from '../orbit/labels.ts'
import { dayKey, relativeTime, startOfDay } from '../orbit/time.ts'
import { OrbitMark, PlusIcon, SearchIcon } from './icons.tsx'
import { SchedulesSection } from './Schedules.tsx'

type Filter = 'todas' | 'vivas' | 'encerradas'
const FILTERS: Array<[Filter, string]> = [['todas', 'Todas'], ['vivas', 'Em andamento'], ['encerradas', 'Encerradas']]
const RECENT_LIMIT = 8
const WEEKS = 53

interface MissionSummary {
  mission: Mission
  workspace: Workspace | undefined
  crew: Pane[]
  live: number
  lastActivity: number
}

/** Base: where you land. Recent missions across workspaces, your folders and how busy you have been. */
export function HomeView({ onOpenMission, onOpenWorkspace, onNewMission, onAddFolder }: {
  onOpenMission: (mission: Mission) => void
  onOpenWorkspace: (workspace: Workspace) => void
  onNewMission: (() => void) | null
  onAddFolder: () => void
}) {
  const { missions, panes, events, workspaces, squads, usageDays } = useOrbit()
  const [filter, setFilter] = useState<Filter>('todas')
  const [query, setQuery] = useState('')
  const search = useRef<HTMLInputElement>(null)

  // ⌘K / Ctrl+K jumps to search while the Base is on screen.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        search.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const summaries = useMemo<MissionSummary[]>(() => {
    const lastEvent = new Map<string, number>()
    for (const e of events) lastEvent.set(e.missionId, Math.max(lastEvent.get(e.missionId) ?? 0, e.at))
    return missions
      .map((mission) => {
        const crew = panes.filter((p) => p.missionId === mission.id).sort((a, b) => (a.role === b.role ? a.id - b.id : a.role === 'lead' ? -1 : 1))
        return {
          mission,
          workspace: workspaces.find((w) => w.id === mission.workspaceId),
          crew,
          live: crew.filter((p) => p.status !== 'exited').length,
          lastActivity: Math.max(mission.updatedAt, lastEvent.get(mission.id) ?? 0),
        }
      })
      .sort((a, b) => b.lastActivity - a.lastActivity)
  }, [missions, panes, events, workspaces])

  const needle = query.trim().toLowerCase()
  const matches = (text: string | undefined) => !needle || (text ?? '').toLowerCase().includes(needle)
  const visible = summaries
    .filter((s) => filter === 'todas' || (filter === 'vivas' ? s.live > 0 : s.live === 0))
    .filter((s) => matches(s.mission.title) || matches(s.mission.objective) || matches(s.workspace?.name) || s.crew.some((p) => matches(p.title)))
  const shown = needle ? visible : visible.slice(0, RECENT_LIMIT)

  const liveMissions = summaries.filter((s) => s.live > 0).length
  const liveAgents = panes.filter((p) => p.status !== 'exited').length
  const liveByWorkspace = new Map<string, number>()
  for (const s of summaries) if (s.workspace) liveByWorkspace.set(s.workspace.id, (liveByWorkspace.get(s.workspace.id) ?? 0) + s.live)
  const sortedWorkspaces = [...workspaces].filter((w) => matches(w.name) || w.folders.some((f) => matches(f))).sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
  const busy = sortedWorkspaces.filter((w) => (liveByWorkspace.get(w.id) ?? 0) > 0)
  const quiet = sortedWorkspaces.filter((w) => (liveByWorkspace.get(w.id) ?? 0) === 0)

  return (
    <div className="home">
      <div className="home__inner">
        <main className="home__main">
          <div className="home__hero">
            <OrbitMark size={44} />
            <div className="home__greeting">
              <h1>De volta à órbita</h1>
              <p className="muted">
                {liveMissions} {liveMissions === 1 ? 'missão em andamento' : 'missões em andamento'} · {liveAgents} {liveAgents === 1 ? 'agente vivo' : 'agentes vivos'} · {workspaces.length} {workspaces.length === 1 ? 'workspace' : 'workspaces'}
              </p>
            </div>
            <div className="home__actions">
              <label className="search">
                <SearchIcon size={15} />
                <span className="sr-only">Buscar missão, agente ou pasta</span>
                <input ref={search} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar missão ou pasta" />
                <kbd>⌘K</kbd>
              </label>
              {onNewMission && <button className="btn btn--primary" onClick={onNewMission}><PlusIcon size={14} />Nova missão</button>}
            </div>
          </div>

          <section aria-labelledby="home-missions" className="home__section">
            <div className="home__section-head">
              <h2 id="home-missions" className="eyebrow">{needle ? 'Resultado da busca' : 'Missões recentes'}</h2>
              <div className="segmented" role="group" aria-label="Filtrar missões">
                {FILTERS.map(([id, label]) => <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}
              </div>
            </div>
            {shown.length === 0 ? (
              <p className="muted home__empty">{needle ? 'Nada encontrado.' : missions.length === 0 ? 'Nenhuma missão ainda. Abra uma pasta e lance a primeira.' : 'Nenhuma missão neste filtro.'}</p>
            ) : (
              <ul className="plain-list home__missions">
                {shown.map((s) => (
                  <li key={s.mission.id}>
                    <MissionCard summary={s} squadName={squads.find((q) => q.id === s.mission.squadId)?.name} onOpen={() => onOpenMission(s.mission)} />
                  </li>
                ))}
              </ul>
            )}
            {!needle && visible.length > shown.length && <p className="muted home__more">Mais {visible.length - shown.length} na busca ou nas abas de workspace.</p>}
          </section>

          <SchedulesSection onOpenMission={onOpenMission} />

          <ActivityMap days={usageDays} />
        </main>

        <aside className="home__aside" aria-labelledby="home-workspaces">
          <div className="home__section-head">
            <h2 id="home-workspaces" className="eyebrow">Workspaces</h2>
            <button className="btn btn--ghost btn--sm" onClick={onAddFolder}><PlusIcon size={14} />Novo workspace</button>
          </div>
          {sortedWorkspaces.length === 0 && <p className="muted">{needle ? 'Nenhuma pasta encontrada.' : 'Nenhuma pasta aberta ainda.'}</p>}
          {busy.length > 0 && <WorkspaceGroup label="Com agentes vivos" workspaces={busy} live={liveByWorkspace} onOpen={onOpenWorkspace} />}
          {quiet.length > 0 && <WorkspaceGroup label={busy.length ? 'Recentes' : 'Por último uso'} workspaces={quiet} live={liveByWorkspace} onOpen={onOpenWorkspace} />}
        </aside>
      </div>
    </div>
  )
}

function MissionCard({ summary, squadName, onOpen }: { summary: MissionSummary; squadName: string | undefined; onOpen: () => void }) {
  const { mission, workspace, crew, live, lastActivity } = summary
  const lead = crew.find((p) => p.role === 'lead')
  const meta = [workspace?.name, lead && [CLI_LABEL[lead.cli], lead.model].filter(Boolean).join(' '), mission.usage.total > 0 && `${tokensText(mission.usage.total)} tokens`, relativeTime(lastActivity)].filter(Boolean).join(' · ')
  return (
    <article className="home-card">
      <div className="home-card__main">
        <span className={`dot ${live > 0 ? 'dot--live' : 'dot--off'}`} title={live > 0 ? 'em andamento' : 'sem agentes vivos'} />
        <div className="home-card__text">
          <div className="home-card__title">
            <h3>{mission.title}</h3>
            <span className={`badge badge--${mission.mode}`}>{MODE_LABEL[mission.mode]}{squadName ? ` · ${squadName}` : ''}</span>
            {mission.status === 'archived' && <span className="badge">Arquivada</span>}
            {mission.scheduleId && <span className="badge">Agendada</span>}
          </div>
          <p className="muted">{meta}</p>
        </div>
        <button className="btn btn--ghost btn--sm" onClick={onOpen} aria-label={`Abrir missão ${mission.title}`}>Abrir</button>
      </div>
      {crew.length > 0 && (
        <ul className="plain-list home-card__crew">
          {crew.map((p) => (
            <li key={p.id}>
              <span className={`dot dot--${STATUS[p.status].tone}`} />
              <span>{p.role === 'lead' ? 'Líder' : p.squadRole ?? p.taskType ?? 'Ajudante'} #{p.id}</span>
              <span className="muted">{p.title} · {STATUS[p.status].label}</span>
            </li>
          ))}
        </ul>
      )}
    </article>
  )
}

function WorkspaceGroup({ label, workspaces, live, onOpen }: { label: string; workspaces: Workspace[]; live: Map<string, number>; onOpen: (w: Workspace) => void }) {
  return (
    <div className="ws-group">
      <span className="ws-group__label">{label}</span>
      <ul className="plain-list">
        {workspaces.map((w) => {
          const count = live.get(w.id) ?? 0
          return (
            <li key={w.id}>
              <button className="ws-item" onClick={() => onOpen(w)}>
                <span className={`dot ${count > 0 ? 'dot--live' : 'dot--off'}`} />
                <span className="ws-item__text">
                  <span className="ws-item__name">{w.name}</span>
                  <span className="ws-item__path" title={w.folders.join('\n')}>{w.folders.length > 1 ? `${w.folders.length} pastas · ` : ''}{pathText(w.path)}</span>
                </span>
                <span className="muted ws-item__when">{count > 0 ? `${count} ${count === 1 ? 'agente' : 'agentes'}` : relativeTime(w.lastOpenedAt)}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** Tokens the agents used per day over the last year, split by CLI in each day's tooltip. */
function ActivityMap({ days }: { days: UsageDay[] }) {
  const { cells, total, split, months } = useMemo(() => {
    const perDay = new Map(days.map((d) => [d.day, d]))
    const today = startOfDay(Date.now())
    const first = new Date(today)
    first.setDate(first.getDate() - (WEEKS - 1) * 7 - first.getDay())
    const counted: UsageDay[] = []
    for (const day = new Date(first); day.getTime() <= today; day.setDate(day.getDate() + 1)) {
      const d = perDay.get(dayKey(day.getTime()))
      if (d) counted.push(d)
    }
    const split = { claude: counted.reduce((n, d) => n + d.claude, 0), codex: counted.reduce((n, d) => n + d.codex, 0) }
    const max = Math.max(1, ...counted.map((d) => d.claude + d.codex))
    const cells: Array<{ key: string; level: number; label: string }> = []
    const months: Array<{ column: number; label: string }> = []
    const day = new Date(first)
    for (let i = 0; day.getTime() <= today; i++, day.setDate(day.getDate() + 1)) {
      const key = dayKey(day.getTime())
      const d = perDay.get(key)
      const count = d ? d.claude + d.codex : 0
      // Square root, so one heavy day does not wash out the rest.
      const level = count === 0 ? 0 : Math.max(1, Math.min(4, Math.ceil(Math.sqrt(count / max) * 4)))
      const date = day.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
      const parts = d ? [d.claude && `Claude ${tokensText(d.claude)}`, d.codex && `Codex ${tokensText(d.codex)}`].filter(Boolean).join(', ') : ''
      cells.push({ key, level, label: count ? `${date}: ${tokensText(count)} tokens (${parts})` : `${date}: nenhum token` })
      if (day.getDate() === 1) months.push({ column: Math.floor(i / 7) + 1, label: day.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '') })
    }
    return { cells, total: split.claude + split.codex, split, months }
  }, [days])

  return (
    <section aria-labelledby="home-activity" className="home__section">
      <div className="home__section-head">
        <h2 id="home-activity" className="eyebrow">Atividade · 12 meses</h2>
        <span className="muted">
          <strong className="home__total">{tokensText(total)}</strong> tokens
          {total > 0 && ` · Claude ${tokensText(split.claude)} · Codex ${tokensText(split.codex)}`}
        </span>
      </div>
      <div className="activity">
        <div className="activity__scroll">
          <div className="activity__months" aria-hidden="true" style={{ gridTemplateColumns: `repeat(${Math.ceil(cells.length / 7)}, var(--cell))` }}>
            {months.map((m) => <span key={`${m.column}-${m.label}`} style={{ gridColumn: `${m.column} / span 4` }}>{m.label}</span>)}
          </div>
          <div className="activity__grid" role="img" aria-label={`Tokens por dia nos últimos 12 meses: ${tokensText(total)} no total`}>
            {cells.map((c) => <span key={c.key} className={`activity__cell activity__cell--${c.level}`} title={c.label} />)}
          </div>
        </div>
        <div className="activity__legend" aria-hidden="true">
          <span>menos</span>
          {[0, 1, 2, 3, 4].map((l) => <span key={l} className={`activity__cell activity__cell--${l}`} />)}
          <span>mais</span>
        </div>
      </div>
    </section>
  )
}
