import type { Account, AccountLimits, Workspace } from '@orbit/protocol'
import type { OrbitState } from '../orbit/client.ts'
import { accountLabel } from '../orbit/labels.ts'
import { untilTime } from '../orbit/time.ts'
import { useAppUpdater } from '../orbit/updater.ts'
import { HomeIcon, OrbitMark, PlusIcon, ReloadIcon, SettingsIcon } from './icons.tsx'
import { useOrbitClient } from '../orbit/context.tsx'
import { limitWindowView, limitReadLabel } from '../orbit/limitPresentation.ts'
import { useLimitClock } from '../orbit/useLimitClock.ts'
import { ActionMenu } from './ActionMenu.tsx'

const CONNECTION_LABEL: Record<OrbitState['connection'], string> = {
  connecting: 'Conectando ao motor…',
  open: 'Motor ativo',
  closed: 'Motor fora do ar',
}

export function TitleBar({ connection, liveAgents, limits, accounts, onAbout }: { connection: OrbitState['connection']; liveAgents: number; limits: AccountLimits[]; accounts: Account[]; onAbout: () => void }) {
  const updater = useAppUpdater()
  const client = useOrbitClient()
  const now = useLimitClock()
  return (
    // data-tauri-drag-region only applies to the element itself, so every non-interactive piece carries it.
    <header className="titlebar" data-tauri-drag-region>
      <div className="brand" data-tauri-drag-region>
        <OrbitMark />
        <span className="brand__name" data-tauri-drag-region>Orbit</span>
        <button type="button" className={`brand__version${updater.available ? ' brand__version--new' : ''}`} onClick={onAbout}
          title={updater.available ? `Versão ${updater.available.version} disponível` : 'Versão do Orbit e atualizações'}>
          {updater.current ?? '0.1.0'}{updater.available && <span> → {updater.available.version}</span>}
        </button>
      </div>
      <div className="titlebar__drag" data-tauri-drag-region />
      <div className="titlebar__status">
        {accounts.map((a) => {
          const l = limits.find((x) => x.accountId === a.id)
          return l ? <LimitMeter key={a.id} limits={l} name={accountLabel(a, a.cli)} now={now} /> : null
        })}
        <button type="button" className="icon-btn limits-refresh" aria-label="Atualizar limites" title="Consultar limites atuais. Atualização automática a cada 30 s; falhas usam espera progressiva." disabled={connection !== 'open'} onClick={() => client.send({ type: 'limits.refresh' })}><ReloadIcon size={14} /></button>
        <span className="muted">{liveAgents} {liveAgents === 1 ? 'agente vivo' : 'agentes vivos'}</span>
        <span className="status-pill" data-state={connection}>
          <span className={`dot ${connection === 'open' ? 'dot--live' : connection === 'closed' ? 'dot--wait' : 'dot--idle'}`} />
          {CONNECTION_LABEL[connection]}
        </span>
      </div>
    </header>
  )
}

const level = (percent: number) => (percent >= 90 ? 'danger' : percent >= 70 ? 'wait' : 'ok')

/** One metric for every provider: the bar and the figure show the share used; the remaining share is in the tooltip. */
function LimitMeter({ limits, name: label, now }: { limits: AccountLimits; name: string; now: number }) {
  const windows = [limits.fiveHour, limits.weekly].filter(raw => raw !== null).map(raw => ({ ...limitWindowView(raw, limits, now), reset: raw.resetsAt > now ? `renova ${untilTime(raw.resetsAt, now)}` : 'aguardando atualização' }))
  const name = `${label}${limits.plan ? ` (${limits.plan})` : ''}`
  const detail = `${windows.map(w => `${w.label}: ${w.used === null ? 'sem leitura atual' : `${Math.round(w.used)}% usado, ${w.remaining}% restante`}, ${w.reset}`).join('\n')}\n${limitReadLabel(limits, now)}`
  return (
    <span className="limit" role="group" aria-label={`Limites de ${name}. ${detail}`} title={`Limites de ${name}\n${detail}`}>
      <span className="limit__cli">{label}</span>
      {windows.length === 0 && <span className="limit__label">sem leitura</span>}
      {windows.map(w => (
        <span key={w.label} className="limit__window" data-level={level(w.used ?? 0)}>
          <span className="limit__label">{w.label}</span>
          <span className="limit__bar" aria-hidden="true"><span style={{ width: `${w.used ?? 0}%` }} /></span>
          <span className="limit__value">{w.used === null ? '—' : `${Math.round(w.used)}%`}</span>
        </span>
      ))}
      {limits.refreshError && <span className="limit__error" title={limits.refreshError}>falha ao ler</span>}
    </span>
  )
}

export function WorkspaceTabs({ workspaces, activeId, homeActive, onHome, onSelect, onOpen, onNewMission, onSquads, onSettings, onPlugins, pendingProposals = 0 }: {
  workspaces: Workspace[]
  activeId: string | null
  homeActive: boolean
  onHome: () => void
  onSelect: (id: string) => void
  onOpen: () => void
  onNewMission: (() => void) | null
  onSquads: () => void
  onPlugins:()=>void
  onSettings: () => void
  /** Leads' table proposals waiting for the person. */
  pendingProposals?: number
}) {
  return (
    <nav className="tabs" aria-label="Workspaces">
      <button className="tabs__home" aria-label="Início" aria-current={homeActive} title="Início" onClick={onHome}><HomeIcon size={18} /><span>Início</span></button>
      <div className="tabs__list">
        {workspaces.map((w) => (
          <button key={w.id} aria-current={w.id === activeId} className="tab" title={w.folders.join('\n')} onClick={() => onSelect(w.id)}>
            {w.name}
          </button>
        ))}
        <button className="icon-btn" aria-label="Novo workspace" onClick={onOpen}><PlusIcon size={15} /></button>
      </div>
      <ActionMenu label="Ambiente">
        <span className="eyebrow">Seu Orbit</span>
        <button type="button" onClick={onOpen}>Novo workspace<span>Conectar pastas de um projeto</span></button>
        <button type="button" onClick={onSquads}>Equipes e squads<span>Organizar papéis e especialidades</span></button>
        <button type="button" onClick={onPlugins}>Plugins do aplicativo<span>Host experimental · painéis, comandos e eventos</span></button>
        <button type="button" onClick={onSettings}>Configurações{pendingProposals > 0 && <span className="count-badge">{pendingProposals} propostas</span>}<span>Contas, CLIs, modelos e ferramentas</span></button>
      </ActionMenu>
      <button type="button" className="icon-btn tabs__settings" aria-label="Configurações" title="Configurações" onClick={onSettings}><SettingsIcon size={18} />{pendingProposals > 0 && <span className="tabs__notification" aria-label={`${pendingProposals} propostas pendentes`} />}</button>
      {onNewMission && (
        <button className="btn btn--primary btn--sm" onClick={onNewMission}><PlusIcon size={14} />Nova missão</button>
      )}
    </nav>
  )
}
