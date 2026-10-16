import { useEffect, useMemo, useRef, useState } from 'react'
import { AGENT_CLIS, type Mission, type Pane, type UsageDay, type Workspace } from '@orbit/protocol'
import { useOrbit } from '../orbit/context.tsx'
import { CLI_LABEL, MODE_LABEL, STATUS, tokensText } from '../orbit/labels.ts'
import { pathText } from '../orbit/labels.ts'
import { dayKey, relativeTime, startOfDay } from '../orbit/time.ts'
import { ChevronIcon, FolderIcon, MissionGlyph, OrbitMark, PlusIcon, SearchIcon, SendIcon, TrashIcon } from './icons.tsx'
import { DeleteMissionDialog } from './deletions.tsx'
import { HomeAccounts } from './QuotaAccess.tsx'
import { SchedulesSection } from './Schedules.tsx'
import './HomeView.css'

type Filter = 'todas' | 'vivas' | 'encerradas'
const FILTERS: Array<[Filter, string]> = [['todas', 'Todas'], ['vivas', 'Em andamento'], ['encerradas', 'Sem agentes ativos']]
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
export function HomeView({ onOpenMission, onOpenWorkspace, onNewMission, onAddFolder, onOpenAccounts }: {
  onOpenMission: (mission: Mission) => void
  onOpenWorkspace: (workspace: Workspace) => void
  onNewMission: (() => void) | null
  onAddFolder: () => void
  onOpenAccounts: () => void
}) {
  const { missions, panes, events, workspaces, squads, usageDays, connection, schedules } = useOrbit()
  const [deleting, setDeleting] = useState<Mission | null>(null)
  const [filter, setFilter] = useState<Filter>('todas')
  const [query, setQuery] = useState('')
  const [showAll, setShowAll] = useState(false)
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
    .filter((s) => matches(s.mission.title) || matches(s.mission.objective) || matches(s.workspace?.name) || !!s.workspace?.folders.some(matches) || s.crew.some((p) => matches(p.title)))
  const shown = needle || showAll ? visible : visible.slice(0, RECENT_LIMIT)

  const liveMissions = summaries.filter((s) => s.live > 0).length
  const liveAgents = panes.filter((p) => p.status !== 'exited').length
  const liveByWorkspace = new Map<string, number>()
  for (const s of summaries) if (s.workspace) liveByWorkspace.set(s.workspace.id, (liveByWorkspace.get(s.workspace.id) ?? 0) + s.live)
  const sortedWorkspaces = [...workspaces].filter((w) => matches(w.name) || w.folders.some((f) => matches(f))).sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
  const busy = sortedWorkspaces.filter((w) => (liveByWorkspace.get(w.id) ?? 0) > 0)
  const quiet = sortedWorkspaces.filter((w) => (liveByWorkspace.get(w.id) ?? 0) === 0)
  const latestId = summaries[0]?.mission.id
  const loading = connection === 'connecting' && missions.length === 0

  return (
    <div className="home home--base">
      <div className="home__inner">
        <main className="home__main">
          <header className="home__hero">
            <div className="home__hero-top">
              <span className="eyebrow home__overline"><OrbitMark size={16} />Base de operações</span>
              <span className="home__engine" role="status"><span className={`dot ${connection === 'open' ? 'dot--live' : 'dot--warn'}`} />{connection === 'open' ? 'Motor conectado' : connection === 'connecting' ? 'Conectando…' : 'Motor desconectado'}</span>
            </div>
            <div className="home__greeting">
              <h1>O que vamos construir hoje?</h1>
              <p>{workspaces.length ? 'Dê um novo objetivo à sua equipe ou retome de onde parou.' : 'Abra um projeto para reunir suas pastas, missões e agentes.'}</p>
            </div>
            <div className="home__start-actions">
              <button type="button" className="btn btn--primary" onClick={onNewMission ?? undefined} disabled={!onNewMission} aria-describedby={!onNewMission ? 'home-project-first' : undefined}><PlusIcon size={18} />Nova missão<SendIcon size={16} /></button>
              <button type="button" className="btn btn--ghost" onClick={onAddFolder}><FolderIcon size={18} />Abrir projeto</button>
            </div>
            {!onNewMission && <p id="home-project-first" className="home__start-hint">Comece abrindo uma pasta do seu Mac.</p>}
          </header>
          <section aria-labelledby="home-missions" className="home__section">
            <div className="home__section-head home__mission-heading">
              <div><h2 id="home-missions">{needle ? 'Resultado da busca' : 'Suas missões'}</h2><p className="home__pulse"><span className={`dot ${liveAgents ? 'dot--live' : 'dot--idle'}`} />{liveMissions} {liveMissions === 1 ? 'missão em andamento' : 'missões em andamento'}<span aria-hidden="true">·</span>{liveAgents} {liveAgents === 1 ? 'agente ativo' : 'agentes ativos'}</p></div>
              <label className="search home__search">
                <SearchIcon size={16} />
                <span className="sr-only">Buscar missão, agente ou pasta</span>
                <input ref={search} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar missão ou pasta" />
                <kbd aria-hidden="true">⌘K</kbd>
              </label>
            </div>
            <div className="home__filters">
              <div className="segmented" role="group" aria-label="Filtrar missões">
                {FILTERS.map(([id, label]) => <button key={id} type="button" aria-pressed={filter === id} onClick={() => { setFilter(id); setShowAll(false) }}>{label}</button>)}
              </div>
              <span className="home__result-count" role="status">{visible.length} {visible.length === 1 ? 'missão' : 'missões'}</span>
            </div>
            {shown.length === 0 ? (
              <div className="home__empty" role="status">
                <MissionGlyph size={32} />
                <strong>{loading ? 'Carregando suas missões…' : needle ? 'Nenhuma missão encontrada' : missions.length === 0 ? 'Sua próxima entrega começa aqui' : 'Nenhuma missão neste filtro'}</strong>
                <p>{loading ? 'Aguardando o motor do Orbit.' : needle ? 'Tente o nome do projeto, da missão ou de um agente.' : missions.length === 0 ? 'Abra um projeto e crie uma missão com o que você quer construir.' : 'Selecione outro filtro para ver as demais missões.'}</p>
                {(needle || filter !== 'todas') && <button type="button" className="btn btn--ghost" onClick={() => { setQuery(''); setFilter('todas') }}>Limpar filtros</button>}
              </div>
            ) : (
              <ul className="plain-list home__missions">
                {shown.map((s) => (
                  <li key={s.mission.id}>
                    <MissionCard latest={s.mission.id === latestId && !needle} summary={s} squadName={squads.find((q) => q.id === s.mission.squadId)?.name} onOpen={() => onOpenMission(s.mission)} onDelete={() => setDeleting(s.mission)} />
                  </li>
                ))}
              </ul>
            )}
            {!needle && visible.length > RECENT_LIMIT && <button type="button" className="btn btn--ghost home__more" onClick={() => setShowAll(!showAll)}>{showAll ? 'Mostrar menos' : `Ver todas as ${visible.length} missões`}<ChevronIcon size={14} /></button>}
          </section>

          <div className="home__utilities">
            <details className="home__schedules"><summary><ChevronIcon size={16} /><span>Missões agendadas</span><span className="home__utility-meta">{schedules.length} {schedules.length === 1 ? 'agendamento' : 'agendamentos'}</span></summary><SchedulesSection onOpenMission={onOpenMission} /></details>
            <details className="home__history"><summary><ChevronIcon size={16} /><span>Consumo e histórico</span><span className="home__utility-meta">Últimos 12 meses</span></summary><ActivityMap days={usageDays} /></details>
          </div>
        </main>

        <aside className="home__aside" aria-labelledby="home-workspaces">
          <section className="home__projects" aria-labelledby="home-workspaces">
          <div className="home__section-head">
            <h2 id="home-workspaces">Projetos <span className="home__count">{workspaces.length}</span></h2>
            <button className="icon-btn" type="button" aria-label="Abrir outro projeto" title="Abrir outro projeto" onClick={onAddFolder}><PlusIcon size={18} /></button>
          </div>
          {sortedWorkspaces.length === 0 && <p className="muted">{needle ? 'Nenhuma pasta encontrada.' : 'Nenhuma pasta aberta ainda.'}</p>}
          {busy.length > 0 && <WorkspaceGroup label="Em atividade" workspaces={busy} live={liveByWorkspace} onOpen={onOpenWorkspace} />}
          {quiet.length > 0 && <WorkspaceGroup label={busy.length ? 'Recentes' : 'Por último uso'} workspaces={quiet} live={liveByWorkspace} onOpen={onOpenWorkspace} />}
          <p className="home__project-note"><FolderIcon size={16} />Pastas e contexto para suas missões.</p>
          </section>
          <HomeAccounts onOpenAccounts={onOpenAccounts} />
        </aside>
      </div>
      {deleting && <DeleteMissionDialog mission={deleting} onClose={() => setDeleting(null)} />}
    </div>
  )
}

function MissionCard({ summary, latest, squadName, onOpen, onDelete }: { latest: boolean; summary: MissionSummary; squadName: string | undefined; onOpen: () => void; onDelete: () => void }) {
  const { mission, workspace, crew, live, lastActivity } = summary
  const lead = crew.find((p) => p.role === 'lead')
  const meta = [workspace?.name, lead && [CLI_LABEL[lead.cli], lead.model].filter(Boolean).join(' '), mission.usage.total > 0 && `${tokensText(mission.usage.total)} tokens`, relativeTime(lastActivity)].filter(Boolean).join(' · ')
  return (
    <article className={`home-card${latest ? ' home-card--latest' : ''}`}>
      <div className="home-card__main">
        <span className="home-card__glyph" aria-hidden="true"><MissionGlyph size={24} /></span>
        <div className="home-card__text">
          <div className="home-card__title">
            <h3><button type="button" onClick={onOpen}>{mission.title}</button></h3>
            {latest && <span className="home-card__latest-label">Última atividade</span>}
            <span className={`badge badge--${mission.mode}`}>{MODE_LABEL[mission.mode]}{squadName ? ` · ${squadName}` : ''}</span>
            {mission.status === 'archived' && <span className="badge">Arquivada</span>}
            {mission.scheduleId && <span className="badge">Agendada</span>}
            {mission.readyAt && <span className="badge" title="Conclusão declarada pelo líder. Abra a missão para conferir a revisão do código atual.">Conclusão declarada</span>}
          </div>
          <p className="muted">{meta}</p>
          {mission.objective && <p className="home-card__objective" title={mission.objective}>{mission.objective}</p>}
          <span className="home-card__state"><span className={`dot ${live > 0 ? 'dot--live' : 'dot--off'}`} />{live > 0 ? `${live} ${live === 1 ? 'agente ativo' : 'agentes ativos'}` : 'Sem agentes ativos'}</span>
        </div>
        <div className="home-card__actions"><button type="button" className="btn btn--ghost btn--sm" onClick={onOpen} aria-label={`Abrir missão ${mission.title}`}>{mission.status === 'active' && !mission.readyAt ? 'Retomar' : 'Abrir'}<SendIcon size={15} /></button>
        <button type="button" className="icon-btn icon-btn--danger" onClick={onDelete} aria-label={`Apagar missão ${mission.title}`} title="Apagar para sempre"><TrashIcon size={15} /></button></div>
      </div>
      {crew.length > 0 && (
        <details className="home-card__team"><summary><ChevronIcon size={14} />Ver equipe · {crew.length} {crew.length === 1 ? 'agente' : 'agentes'}</summary><ul className="plain-list home-card__crew">
          {crew.map((p) => (
            <li key={p.id}>
              <span className={`dot dot--${STATUS[p.status].tone}`} />
              <span>{p.role === 'lead' ? 'Líder' : p.squadRole ?? p.taskType ?? 'Ajudante'} #{p.id}</span>
              <span className="muted">{p.title} · {STATUS[p.status].label}</span>
            </li>
          ))}
        </ul></details>
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
                <FolderIcon size={18} />
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
  const { cells, total, split, months, dailyRows } = useMemo(() => {
    const perDay = new Map(days.map((d) => [d.day, d]))
    const today = startOfDay(Date.now())
    const first = new Date(today)
    first.setDate(first.getDate() - (WEEKS - 1) * 7 - first.getDay())
    const counted: UsageDay[] = []
    for (const day = new Date(first); day.getTime() <= today; day.setDate(day.getDate() + 1)) {
      const d = perDay.get(dayKey(day.getTime()))
      if (d) counted.push(d)
    }
    const sum = (d: UsageDay) => AGENT_CLIS.reduce((n, cli) => n + (d[cli] ?? 0), 0)
    const split = AGENT_CLIS.map((cli) => ({ cli, tokens: counted.reduce((n, d) => n + (d[cli] ?? 0), 0) })).filter((x) => x.tokens > 0)
    const max = Math.max(1, ...counted.map(sum))
    const cells: Array<{ key: string; level: number; label: string }> = []
    const months: Array<{ column: number; label: string }> = []
    const day = new Date(first)
    for (let i = 0; day.getTime() <= today; i++, day.setDate(day.getDate() + 1)) {
      const key = dayKey(day.getTime())
      const d = perDay.get(key)
      const count = d ? sum(d) : 0
      // Square root, so one heavy day does not wash out the rest.
      const level = count === 0 ? 0 : Math.max(1, Math.min(4, Math.ceil(Math.sqrt(count / max) * 4)))
      const date = day.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
      const parts = d ? AGENT_CLIS.filter((cli) => d[cli]).map((cli) => `${CLI_LABEL[cli]} ${tokensText(d[cli])}`).join(', ') : ''
      cells.push({ key, level, label: count ? `${date}: ${tokensText(count)} tokens (${parts})` : `${date}: nenhum token` })
      if (day.getDate() === 1) months.push({ column: Math.floor(i / 7) + 1, label: day.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '') })
    }
    return { cells, total: split.reduce((n, x) => n + x.tokens, 0), split, months, dailyRows: counted.reverse().map(d => ({ day: d.day, total: sum(d), agents: AGENT_CLIS.filter(cli => d[cli]).map(cli => `${CLI_LABEL[cli]}: ${tokensText(d[cli])}`).join(' · ') })) }
  }, [days])

  return (
    <section aria-labelledby="home-activity" className="home__section">
      <div className="home__section-head">
        <h2 id="home-activity" className="eyebrow">Atividade · 12 meses</h2>
        <span className="muted">
          <strong className="home__total">{tokensText(total)}</strong> tokens
          {split.map((x) => ` · ${CLI_LABEL[x.cli]} ${tokensText(x.tokens)}`).join('')}
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
      <details className="home__activity-data">
        <summary>Ver dados por dia</summary>
        {dailyRows.length ? (
          <div className="home__table-scroll">
            <table>
              <caption className="sr-only">Consumo diário de tokens nos últimos 12 meses</caption>
              <thead><tr><th scope="col">Dia</th><th scope="col">Tokens</th><th scope="col">Por agente</th></tr></thead>
              <tbody>{dailyRows.map(row => <tr key={row.day}><th scope="row">{row.day}</th><td>{tokensText(row.total)}</td><td>{row.agents}</td></tr>)}</tbody>
            </table>
          </div>
        ) : <p className="muted">Nenhum consumo registrado neste período.</p>}
      </details>
    </section>
  )
}
