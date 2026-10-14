import type { Mission, Pane, ServerMessage } from '@orbit/protocol'

/** Which moments become a macOS notification. */
export interface NoticePrefs {
  /** An agent needs you (permission, question). */
  waiting: boolean
  /** A helper delivered its result to the lead. */
  handoff: boolean
  /** A Claude agent finished a long turn. */
  finished: boolean
  /** An agent's process ended. */
  exited: boolean
  /** A scheduled mission started by itself. */
  scheduled: boolean
  /** Only while Orbit is not the app in front. */
  onlyInBackground: boolean
  sound: boolean
}

export const DEFAULT_PREFS: NoticePrefs = { waiting: true, handoff: true, finished: true, exited: false, scheduled: true, onlyInBackground: true, sound: true }

export interface Notice {
  title: string
  body: string
  missionId: string
  paneId: number | null
}

/** A turn shorter than this is a quick answer, not something worth a notification. */
export const FINISHED_AFTER_MS = 30_000

const clip = (text: string, max = 180) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

/**
 * Turns the sidecar's live messages into notices. Mission events (waiting, handoffs, exits) say
 * so directly; "finished" is a Claude agent going from running to idle after a long turn (its
 * status comes from hooks; Codex's comes from output pauses, too noisy for this).
 */
export class NoticeWatcher {
  private readonly runningSince = new Map<number, number>()

  observe(message: ServerMessage, missions: Mission[], prefs: NoticePrefs, now = Date.now()): Notice[] {
    const missionTitle = (id: string) => missions.find((m) => m.id === id)?.title ?? 'Missão'
    if (message.type === 'event.added') {
      const e = message.event
      const where = missionTitle(e.missionId)
      if (e.kind === 'pane.waiting' && prefs.waiting) return [{ title: e.title, body: clip(`${where}: ${e.body}`), missionId: e.missionId, paneId: e.paneId }]
      if (e.kind === 'handoff' && prefs.handoff) return [{ title: e.title, body: clip(`${where}: ${e.body.split('\n')[0] ?? ''}`), missionId: e.missionId, paneId: e.paneId }]
      if (e.kind === 'mission.created' && e.title.startsWith('Missão agendada') && prefs.scheduled) return [{ title: e.title, body: clip(where), missionId: e.missionId, paneId: null }]
      if (e.kind === 'pane.exited' && prefs.exited) return [{ title: e.title, body: clip(`${where}: ${e.body}`), missionId: e.missionId, paneId: e.paneId }]
      return []
    }
    if (message.type === 'pane.updated') return this.paneChanged(message.pane, missionTitle, prefs, now)
    if (message.type === 'pane.removed') this.runningSince.delete(message.paneId)
    return []
  }

  private paneChanged(pane: Pane, missionTitle: (id: string) => string, prefs: NoticePrefs, now: number): Notice[] {
    if (pane.status === 'running' || pane.status === 'starting') {
      if (!this.runningSince.has(pane.id)) this.runningSince.set(pane.id, now)
      return []
    }
    const since = this.runningSince.get(pane.id)
    this.runningSince.delete(pane.id)
    if (pane.status !== 'idle' || since === undefined || pane.cli !== 'claude' || !prefs.finished) return []
    if (now - since < FINISHED_AFTER_MS) return []
    const minutes = Math.round((now - since) / 60_000)
    const took = minutes >= 1 ? ` depois de ${minutes} min` : ''
    return [{ title: `#${pane.id} terminou`, body: clip(`${missionTitle(pane.missionId)}: ${pane.title}${took}`), missionId: pane.missionId, paneId: pane.id }]
  }
}

/** The Dock badge: agents waiting for you. */
export function waitingCount(panes: Pane[]): number {
  return panes.filter((p) => p.status === 'waiting').length
}
