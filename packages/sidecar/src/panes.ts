import { EventEmitter } from 'node:events'
import pty, { type IPty } from 'node-pty'
import headless from '@xterm/headless'
import type { Pane, PaneStatus, SpawnPaneRequest } from '@orbit/protocol'
import { buildCommand, paneEnv, type AgentLaunch } from './command.ts'

const SCROLLBACK_LIMIT = 512 * 1024
/** Output silence after which a running pane is considered idle. */
const IDLE_AFTER_MS = 1500
/** Delay between a bracketed paste and the Enter that submits it, so TUIs see them apart. */
const SUBMIT_DELAY_MS = 120

interface LivePane {
  pty: IPty
  /** Mirror of the screen, so agents can read what another agent shows. */
  screen: InstanceType<typeof headless.Terminal>
  scrollback: string
  idleTimer: NodeJS.Timeout | null
  /** Status comes from the agent's hooks, not from output activity. */
  hookDriven: boolean
}

export interface PaneManagerEvents {
  data: [paneId: number, data: string]
  status: [pane: Pane, previous: PaneStatus]
  exit: [pane: Pane]
}

export interface SpawnInput {
  id: number
  request: SpawnPaneRequest
  cwd: string
  launch: AgentLaunch
  env: Record<string, string>
  hookDriven: boolean
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

  spawn({ id, request, cwd, launch, env, hookDriven }: SpawnInput, cols = 100, rows = 30): Pane {
    const { file, args } = buildCommand(launch, this.shell)
    const proc = pty.spawn(file, args, { name: 'xterm-256color', cols, rows, cwd, env: paneEnv(process.env, env) })
    const pane: Pane = {
      id,
      missionId: request.missionId,
      role: request.role,
      cli: request.cli,
      model: request.model,
      title: request.title,
      cwd,
      status: 'starting',
      attention: null,
      deliveredAt: null,
      pid: proc.pid,
      exitCode: null,
      createdAt: Date.now(),
    }
    const screen = new headless.Terminal({ cols, rows, scrollback: 2000, allowProposedApi: true })
    const live: LivePane = { pty: proc, screen, scrollback: '', idleTimer: null, hookDriven }
    this.live.set(id, live)
    this.panes.set(id, pane)

    proc.onData((data) => {
      live.scrollback = (live.scrollback + data).slice(-SCROLLBACK_LIMIT)
      screen.write(data)
      this.emit('data', id, data)
      if (!live.hookDriven) this.markActive(id, live)
    })
    proc.onExit(({ exitCode }) => {
      if (live.idleTimer) clearTimeout(live.idleTimer)
      screen.dispose()
      this.live.delete(id)
      Object.assign(pane, { status: 'exited', attention: null, pid: null, exitCode })
      this.emit('exit', { ...pane })
    })
    return { ...pane }
  }

  get(id: number): Pane | undefined {
    const pane = this.panes.get(id)
    return pane && { ...pane }
  }

  write(id: number, data: string): void {
    this.live.get(id)?.pty.write(data)
  }

  /** Types text into a TUI as one paste, then submits it. */
  submit(id: number, text: string): boolean {
    const live = this.live.get(id)
    if (!live) return false
    live.pty.write(`\x1b[200~${text.replaceAll('\x1b', '')}\x1b[201~`)
    setTimeout(() => this.live.get(id)?.pty.write('\r'), SUBMIT_DELAY_MS)
    return true
  }

  resize(id: number, cols: number, rows: number): void {
    const live = this.live.get(id)
    if (!live || cols <= 0 || rows <= 0) return
    live.pty.resize(Math.floor(cols), Math.floor(rows))
    live.screen.resize(Math.floor(cols), Math.floor(rows))
  }

  kill(id: number): void {
    this.live.get(id)?.pty.kill()
  }

  scrollback(id: number): string {
    return this.live.get(id)?.scrollback ?? ''
  }

  /** The last `lines` rendered lines of the pane, as plain text. */
  screenText(id: number, lines: number): string {
    const live = this.live.get(id)
    if (!live) return ''
    const buffer = live.screen.buffer.active
    const out: string[] = []
    for (let y = 0; y < buffer.length; y++) out.push(buffer.getLine(y)?.translateToString(true) ?? '')
    while (out.length && !out[out.length - 1]?.trim()) out.pop()
    return out.slice(-lines).join('\n')
  }

  isAlive(id: number): boolean {
    return this.live.has(id)
  }

  /** Status reported by the agent itself (hooks). */
  report(id: number, status: PaneStatus, attention: string | null): void {
    const pane = this.panes.get(id)
    if (!pane || pane.status === 'exited') return
    if (pane.status === status && pane.attention === attention) return
    const previous = pane.status
    Object.assign(pane, { status, attention })
    this.emit('status', { ...pane }, previous)
  }

  markDelivered(id: number): void {
    const pane = this.panes.get(id)
    if (!pane) return
    pane.deliveredAt = Date.now()
    this.emit('status', { ...pane }, pane.status)
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
    const previous = pane.status
    pane.status = status
    this.emit('status', { ...pane }, previous)
  }
}
