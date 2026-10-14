import { EventEmitter } from 'node:events'
import pty, { type IPty } from 'node-pty'
import headless from '@xterm/headless'
import serialize from '@xterm/addon-serialize'
import type { Pane, PaneHandoff, PaneStatus, SpawnPaneRequest, TokenUsage } from '@orbit/protocol'
import { buildCommand, paneEnv, type AgentLaunch, type PaneCommand } from './command.ts'

/** Output silence after which a running pane is considered idle. */
const IDLE_AFTER_MS = 1500
/** Delay between a bracketed paste and the Enter that submits it, so TUIs see them apart. */
const SUBMIT_DELAY_MS = 120
/** Scrollback kept by the screen mirror and handed to views. */
const SCROLLBACK_LINES = 3000

/**
 * Mirror of a pane's terminal, always at the PTY's size. It is what views start from (serialized)
 * and what agents read, and it survives the process so an exited pane still shows its last screen.
 */
interface Screen {
  term: InstanceType<typeof headless.Terminal>
  serializer: InstanceType<typeof serialize.SerializeAddon>
}

interface LivePane {
  pty: IPty
  idleTimer: NodeJS.Timeout | null
  /** Status comes from the agent's hooks, not from output activity. */
  hookDriven: boolean
}

export interface PaneSnapshot {
  data: string
  cols: number
  rows: number
}

export interface PaneManagerEvents {
  data: [paneId: number, data: string]
  resized: [paneId: number, cols: number, rows: number]
  status: [pane: Pane, previous: PaneStatus]
  exit: [pane: Pane]
}

export interface SpawnInput {
  id: number
  request: SpawnPaneRequest
  squadRole: string | null
  taskType: string | null
  cwd: string
  launch: AgentLaunch
  env: Record<string, string>
  hookDriven: boolean
  accountId: string | null
  branch?: string | null
}

/** Owns the PTY processes. Pane metadata is mirrored to the caller through events. */
export class PaneManager extends EventEmitter<PaneManagerEvents> {
  private readonly live = new Map<number, LivePane>()
  private readonly screens = new Map<number, Screen>()
  private readonly panes = new Map<number, Pane>()
  /** Agents with a question for the person: they stay "waiting" until the person answers. */
  private readonly asking = new Set<number>()
  private readonly shell: string
  private readonly command: (launch: AgentLaunch, shell: string) => PaneCommand

  constructor(shell: string, command: (launch: AgentLaunch, shell: string) => PaneCommand = buildCommand) {
    super()
    this.shell = shell
    this.command = command
  }

  spawn({ id, request, squadRole, taskType, cwd, launch, env, hookDriven, accountId, branch }: SpawnInput, cols = 100, rows = 30): Pane {
    const { file, args } = this.command(launch, this.shell)
    const proc = pty.spawn(file, args, { name: 'xterm-256color', cols, rows, cwd, env: paneEnv(process.env, env) })
    const pane: Pane = {
      id,
      missionId: request.missionId,
      role: request.role,
      squadRole,
      taskType,
      cli: request.cli,
      model: request.model,
      effort: launch.effort ?? null,
      accountId,
      sessionId: null,
      branch: branch ?? null,
      title: request.title,
      cwd,
      status: 'starting',
      attention: null,
      choices: null,
      deliveredAt: null,
      handoffStatus: null,
      assignedBy: null,
      usage: null,
      contextPercent: null,
      pid: proc.pid,
      exitCode: null,
      createdAt: Date.now(),
    }
    const term = new headless.Terminal({ cols, rows, scrollback: SCROLLBACK_LINES, allowProposedApi: true })
    const serializer = new serialize.SerializeAddon()
    term.loadAddon(serializer)
    const screen: Screen = { term, serializer }
    const live: LivePane = { pty: proc, idleTimer: null, hookDriven }
    this.live.set(id, live)
    this.screens.set(id, screen)
    this.panes.set(id, pane)

    // A pane reopened under the same number gets a new process: the old one's last output and
    // exit must not touch it.
    const current = () => this.live.get(id) === live
    proc.onData((data) => {
      if (!current()) return
      screen.term.write(data)
      this.emit('data', id, data)
      if (!live.hookDriven) this.markActive(id, live)
    })
    proc.onExit(({ exitCode }) => {
      if (live.idleTimer) clearTimeout(live.idleTimer)
      if (!current()) return
      this.live.delete(id)
      this.asking.delete(id)
      Object.assign(pane, { status: 'exited', attention: null, choices: null, pid: null, exitCode })
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

  /**
   * Types a whole message and submits it. Programs that asked for bracketed paste (TUIs like
   * Claude Code) get it as one paste; others, like a plain shell, get the bare text. Enter goes
   * separately, a moment later, so it is read as "submit" and not as part of the text.
   */
  submit(id: number, text: string): boolean {
    const live = this.live.get(id)
    if (!live) return false
    const clean = text.replaceAll('\x1b', '')
    const paste = this.screens.get(id)?.term.modes.bracketedPasteMode
    live.pty.write(paste ? `\x1b[200~${clean}\x1b[201~` : clean)
    setTimeout(() => this.live.get(id)?.pty.write('\r'), SUBMIT_DELAY_MS)
    return true
  }

  /** PTY and mirror move together, so the mirror always matches what the program draws for. */
  resize(id: number, cols: number, rows: number): void {
    const live = this.live.get(id)
    const screen = this.screens.get(id)
    if (!live || !screen || cols < 2 || rows < 1) return
    const c = Math.floor(cols)
    const r = Math.floor(rows)
    if (c === screen.term.cols && r === screen.term.rows) return
    live.pty.resize(c, r)
    screen.term.resize(c, r)
    this.emit('resized', id, c, r)
  }

  kill(id: number): void {
    this.live.get(id)?.pty.kill()
  }

  /** Drops everything kept for a closed pane. */
  forget(id: number): void {
    const live = this.live.get(id)
    if (live?.idleTimer) clearTimeout(live.idleTimer)
    this.kill(id)
    this.live.delete(id)
    this.asking.delete(id)
    this.screens.get(id)?.term.dispose()
    this.screens.delete(id)
    this.panes.delete(id)
  }

  /**
   * The pane's screen and scrollback once every byte received so far has been applied.
   * Output that arrives after this call is not in the snapshot; callers stream it afterwards.
   */
  async snapshot(id: number): Promise<PaneSnapshot | null> {
    const screen = this.screens.get(id)
    if (!screen) return null
    await new Promise<void>((resolve) => screen.term.write('', resolve))
    return { data: screen.serializer.serialize({ scrollback: SCROLLBACK_LINES }), cols: screen.term.cols, rows: screen.term.rows }
  }

  /** The last `lines` rendered lines of the pane, as plain text. */
  screenText(id: number, lines: number): string {
    const screen = this.screens.get(id)
    if (!screen) return ''
    const buffer = screen.term.buffer.active
    const out: string[] = []
    for (let y = 0; y < buffer.length; y++) out.push(buffer.getLine(y)?.translateToString(true) ?? '')
    while (out.length && !out[out.length - 1]?.trim()) out.pop()
    return out.slice(-lines).join('\n')
  }

  isAlive(id: number): boolean {
    return this.live.has(id)
  }

  /** The agent asked the person something (ask_user): waiting, with the question and choices. */
  ask(id: number, question: string, choices: string[]): void {
    const pane = this.panes.get(id)
    if (!pane || pane.status === 'exited') return
    const previous = pane.status
    this.asking.add(id)
    Object.assign(pane, { status: 'waiting', attention: question, choices: choices.length ? choices : null })
    this.emit('status', { ...pane }, previous)
  }

  /** The person typed into the agent: its question, if any, is answered. */
  answered(id: number): void {
    const pane = this.panes.get(id)
    if (!pane || !this.asking.delete(id)) return
    Object.assign(pane, { status: pane.status === 'waiting' ? 'running' : pane.status, attention: null, choices: null })
    this.emit('status', { ...pane }, 'waiting')
  }

  /** Status reported by the agent itself (hooks). */
  report(id: number, status: PaneStatus, attention: string | null): void {
    const pane = this.panes.get(id)
    if (!pane || pane.status === 'exited' || this.asking.has(id)) return
    if (pane.status === status && pane.attention === attention) return
    const previous = pane.status
    Object.assign(pane, { status, attention })
    this.emit('status', { ...pane }, previous)
  }

  /** Session totals the CLI reported. */
  setUsage(id: number, usage: TokenUsage | null, contextPercent: number | null): void {
    const pane = this.panes.get(id)
    if (!pane) return
    if (usage) pane.usage = usage
    if (contextPercent !== null) pane.contextPercent = contextPercent
    this.emit('status', { ...pane }, pane.status)
  }

  /** The CLI told us its conversation id. */
  setSession(id: number, sessionId: string): void {
    const pane = this.panes.get(id)
    if (!pane || pane.sessionId === sessionId) return
    pane.sessionId = sessionId
    this.emit('status', { ...pane }, pane.status)
  }

  rename(id: number, title: string): Pane | undefined {
    const pane = this.panes.get(id)
    if (!pane) return undefined
    pane.title = title
    this.emit('status', { ...pane }, pane.status)
    return { ...pane }
  }

  /** A helper promoted to lead, or a lead handed to: its role and whom it answers to. */
  setSeat(id: number, change: { role?: Pane['role']; assignedBy?: number | null }): void {
    const pane = this.panes.get(id)
    if (!pane) return
    if (change.role) pane.role = change.role
    if (change.assignedBy !== undefined) pane.assignedBy = change.assignedBy
    this.emit('status', { ...pane }, pane.status)
  }

  /**
   * Where the helper stands with its handoff: `assignedBy` gives it work (it owes a result again),
   * a status records what it reported; done, blocked and auto count as delivered.
   */
  setHandoff(id: number, change: { status: PaneHandoff | null; assignedBy?: number }): void {
    const pane = this.panes.get(id)
    if (!pane) return
    if (change.assignedBy !== undefined) pane.assignedBy = change.assignedBy
    pane.handoffStatus = change.status
    if (change.status === null) pane.deliveredAt = null
    else if (change.status !== 'progress') pane.deliveredAt = Date.now()
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
    if (this.asking.has(id) && status !== 'exited') return
    const previous = pane.status
    pane.status = status
    this.emit('status', { ...pane }, previous)
  }
}
