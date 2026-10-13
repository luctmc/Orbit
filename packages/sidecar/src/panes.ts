import { EventEmitter } from 'node:events'
import pty, { type IPty } from 'node-pty'
import type { Pane, PaneStatus, SpawnPaneRequest } from '@orbit/protocol'
import { buildCommand, paneEnv } from './command.ts'

const SCROLLBACK_LIMIT = 512 * 1024
/** Output silence after which a running pane is considered idle. */
const IDLE_AFTER_MS = 1500

interface LivePane {
  pty: IPty
  scrollback: string
  idleTimer: NodeJS.Timeout | null
}

export interface PaneManagerEvents {
  data: [paneId: number, data: string]
  status: [pane: Pane]
  exit: [pane: Pane]
}

/** Owns the PTY processes. Pane metadata is mirrored to the caller through events. */
export class PaneManager extends EventEmitter<PaneManagerEvents> {
  private readonly live = new Map<number, LivePane>()
  private readonly panes = new Map<number, Pane>()
  private readonly shell: string

  constructor(shell: string) {
    super()
    this.shell = shell
  }

  spawn(id: number, request: SpawnPaneRequest, cwd: string, cols = 100, rows = 30): Pane {
    const { file, args } = buildCommand(request.cli, request.model, this.shell)
    const proc = pty.spawn(file, args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: paneEnv(process.env, { ORBIT_PANE_ID: String(id), ORBIT_MISSION_ID: request.missionId }),
    })
    const pane: Pane = {
      id,
      missionId: request.missionId,
      role: request.role,
      cli: request.cli,
      model: request.model,
      title: request.title,
      cwd,
      status: 'starting',
      pid: proc.pid,
      exitCode: null,
      createdAt: Date.now(),
    }
    const live: LivePane = { pty: proc, scrollback: '', idleTimer: null }
    this.live.set(id, live)
    this.panes.set(id, pane)

    proc.onData((data) => {
      live.scrollback = (live.scrollback + data).slice(-SCROLLBACK_LIMIT)
      this.emit('data', id, data)
      this.markActive(id, live)
    })
    proc.onExit(({ exitCode }) => {
      if (live.idleTimer) clearTimeout(live.idleTimer)
      this.live.delete(id)
      Object.assign(pane, { status: 'exited', pid: null, exitCode })
      this.emit('exit', { ...pane })
    })
    return { ...pane }
  }

  write(id: number, data: string): void {
    this.live.get(id)?.pty.write(data)
  }

  resize(id: number, cols: number, rows: number): void {
    if (cols > 0 && rows > 0) this.live.get(id)?.pty.resize(Math.floor(cols), Math.floor(rows))
  }

  kill(id: number): void {
    this.live.get(id)?.pty.kill()
  }

  scrollback(id: number): string {
    return this.live.get(id)?.scrollback ?? ''
  }

  isAlive(id: number): boolean {
    return this.live.has(id)
  }

  killAll(): void {
    for (const live of this.live.values()) live.pty.kill()
  }

  private markActive(id: number, live: LivePane): void {
    this.setStatus(id, 'running')
    if (live.idleTimer) clearTimeout(live.idleTimer)
    live.idleTimer = setTimeout(() => this.setStatus(id, 'idle'), IDLE_AFTER_MS)
  }

  private setStatus(id: number, status: PaneStatus): void {
    const pane = this.panes.get(id)
    if (!pane || pane.status === status || pane.status === 'exited') return
    pane.status = status
    this.emit('status', { ...pane })
  }
}
