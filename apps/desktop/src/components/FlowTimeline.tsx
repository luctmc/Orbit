import type { MissionEvent, MissionEventKind } from '@orbit/protocol'
import { timeOf } from '../orbit/labels.ts'

const TONE: Record<MissionEventKind, string> = {
  'mission.created': 'neutral',
  'mission.ready': 'live',
  proposal: 'wait',
  'lead.changed': 'live',
  'pane.spawned': 'live',
  'pane.exited': 'off',
  'pane.waiting': 'wait',
  handoff: 'idle',
  browser: 'neutral',
  budget: 'wait',
}

export function FlowTimeline({ events }: { events: MissionEvent[] }) {
  return (
    <aside className="flow" aria-label="Fluxo da missão">
      <div className="eyebrow">Fluxo da missão</div>
      {events.length === 0 ? (
        <p className="muted">Nada aconteceu ainda.</p>
      ) : (
        <ol className="flow__list">
          {events.map((e) => (
            <li key={e.id} className="flow__item">
              <span className={`flow__dot tone-bg--${TONE[e.kind]}`} />
              <div className="flow__text">
                <div className="flow__title">
                  <span>{e.title}</span>
                  <time dateTime={new Date(e.at).toISOString()}>{timeOf(e.at)}</time>
                </div>
                {e.kind === 'handoff' && e.body.length > 280 ? (
                  <details>
                    <summary>{e.body.slice(0, 200)}…</summary>
                    <p className="flow__full">{e.body}</p>
                  </details>
                ) : (
                  <p className="flow__full">{e.body}</p>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </aside>
  )
}
