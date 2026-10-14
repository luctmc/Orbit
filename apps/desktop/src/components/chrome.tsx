import type { Account, AccountLimits, RateWindow, Workspace } from '@orbit/protocol'
import type { OrbitState } from '../orbit/client.ts'
import { accountLabel } from '../orbit/labels.ts'
import { untilTime } from '../orbit/time.ts'
import { useAppUpdater } from '../orbit/updater.ts'
import { HomeIcon, OrbitMark, PlusIcon } from './icons.tsx'

const CONNECTION_LABEL: Record<OrbitState['connection'], string> = {
  connecting: 'Conectando ao motor…',
  open: 'Motor ativo',
  closed: 'Motor fora do ar',
}

export function TitleBar({ connection, liveAgents, limits, accounts, onAbout }: { connection: OrbitState['connection']; liveAgents: number; limits: AccountLimits[]; accounts: Account[]; onAbout: () => void }) {
  const updater = useAppUpdater()
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
          return l ? <LimitMeter key={a.id} limits={l} name={accountLabel(a, a.cli)} /> : null
        })}
        <span className="muted">{liveAgents} {liveAgents === 1 ? 'agente vivo' : 'agentes vivos'}</span>
        <span className="status-pill" data-state={connection}>
          <span className={`dot ${connection === 'open' ? 'dot--live' : connection === 'closed' ? 'dot--wait' : 'dot--idle'}`} />
          {CONNECTION_LABEL[connection]}
        </span>
      </div>
    </header>
  )
}

/** A window that already reset counts as unused until the next report. */
function windowUse(w: RateWindow | null, now: number): { percent: number; reset: string } | null {
  if (!w) return null
  const fresh = w.resetsAt > now
  return { percent: fresh ? Math.round(w.usedPercent) : 0, reset: fresh ? `renova ${untilTime(w.resetsAt, now)}` : 'renovado' }
}

const level = (percent: number) => (percent >= 90 ? 'danger' : percent >= 70 ? 'wait' : 'ok')

/** The account's 5-hour and weekly use, as the CLI last reported it. */
function LimitMeter({ limits, name: label }: { limits: AccountLimits; name: string }) {
  const now = Date.now()
  const windows: Array<[string, { percent: number; reset: string }]> = []
  for (const [label, raw] of [['5 h', limits.fiveHour], ['semana', limits.weekly]] as const) {
    const use = windowUse(raw, now)
    if (use) windows.push([label, use])
  }
  if (windows.length === 0) return null
  const name = `${label}${limits.plan ? ` (${limits.plan})` : ''}`
  const detail = windows.map(([label, w]) => `${label}: ${w.percent}% usado, ${w.reset}`).join('\n')
  return (
    <span className="limit" role="group" aria-label={`Limites de ${name}. ${detail}`} title={`Limites de ${name}\n${detail}`}>
      <span className="limit__cli">{label}</span>
      {windows.map(([label, w]) => (
        <span key={label} className="limit__window" data-level={level(w.percent)}>
          <span className="limit__label">{label}</span>
          <span className="limit__bar" aria-hidden="true"><span style={{ width: `${Math.min(100, w.percent)}%` }} /></span>
          <span className="limit__value">{w.percent}%</span>
        </span>
      ))}
    </span>
  )
}

export function WorkspaceTabs({ workspaces, activeId, homeActive, onHome, onSelect, onOpen, onNewMission, onSquads, onSettings }: {
  workspaces: Workspace[]
  activeId: string | null
  homeActive: boolean
  onHome: () => void
  onSelect: (id: string) => void
  onOpen: () => void
  onNewMission: (() => void) | null
  onSquads: () => void
  onSettings: () => void
}) {
  return (
    <nav className="tabs" aria-label="Workspaces">
      <button className="tabs__home" aria-label="Base" aria-current={homeActive} title="Base" onClick={onHome}><HomeIcon size={18} /></button>
      <div className="tabs__list">
        {workspaces.map((w) => (
          <button key={w.id} aria-current={w.id === activeId} className="tab" title={w.folders.join('\n')} onClick={() => onSelect(w.id)}>
            {w.name}
          </button>
        ))}
        <button className="icon-btn" aria-label="Novo workspace" onClick={onOpen}><PlusIcon size={15} /></button>
      </div>
      <button className="btn btn--ghost btn--sm" onClick={onSquads}>Squads</button>
      <button className="btn btn--ghost btn--sm" onClick={onSettings} title="Quem faz cada tarefa">Ajustes</button>
      {onNewMission && (
        <button className="btn btn--primary btn--sm" onClick={onNewMission}><PlusIcon size={14} />Nova missão</button>
      )}
    </nav>
  )
}
