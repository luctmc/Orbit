import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { BROWSER_KEYS, BROWSER_VIEWPORT, type MissionBrowser } from '@orbit/protocol'
import { CdpPipe, type CdpEvent } from './cdp.ts'

export interface BrowserEngine {
  name: string
  path: string
}

const APPS: Array<[string, string]> = [
  ['Google Chrome', 'Google Chrome.app/Contents/MacOS/Google Chrome'],
  ['Chromium', 'Chromium.app/Contents/MacOS/Chromium'],
  ['Brave', 'Brave Browser.app/Contents/MacOS/Brave Browser'],
  ['Microsoft Edge', 'Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
]

/** An installed Chromium-based browser Orbit can drive headless; ORBIT_BROWSER picks one by path. */
export function findBrowser(env: NodeJS.ProcessEnv = process.env, exists: (path: string) => boolean = existsSync): BrowserEngine | null {
  if (env.ORBIT_BROWSER) return exists(env.ORBIT_BROWSER) ? { name: basename(env.ORBIT_BROWSER), path: env.ORBIT_BROWSER } : null
  for (const root of ['/Applications', join(homedir(), 'Applications')]) {
    for (const [name, rel] of APPS) {
      const path = join(root, rel)
      if (exists(path)) return { name, path }
    }
  }
  return null
}

/** http(s) only; a bare "localhost:5173" or "exemplo.com" gets its scheme. */
export function browserUrl(raw: string): string {
  const value = raw.trim()
  if (!value) throw new Error('Informe um endereço')
  if (value.length > 2000) throw new Error('Endereço longo demais')
  if (value === 'about:blank') return value
  const local = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])(:\d+)?(\/|$)/i.test(value)
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `${local ? 'http' : 'https'}://${value}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    throw new Error(`Endereço inválido: ${value}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('O navegador do Orbit só abre endereços http e https')
  return url.href
}

const KEY_CODES: Record<(typeof BROWSER_KEYS)[number], number> = {
  Enter: 13, Tab: 9, Backspace: 8, Delete: 46, Escape: 27, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Home: 36, End: 35, PageUp: 33, PageDown: 34,
}

const CONSOLE_LINES = 200
const LOAD_TIMEOUT_MS = 15_000
/** Frames are acknowledged after this pause, which caps the stream at roughly 15 per second. */
const FRAME_PACE_MS = 66
/**
 * Headless screencasts can hold back the last change until something else moves, so after each
 * action the watchers also get a fresh capture: soon, and again once late updates settle.
 */
const REFRESH_AFTER_MS = [250, 1000]

interface Tab {
  state: MissionBrowser
  targetId: string
  sessionId: string
  mainFrameId: string
  console: string[]
  casting: boolean
  loadWaiters: Array<() => void>
  refreshTimers: NodeJS.Timeout[]
}

export interface BrowserEvents {
  state: [MissionBrowser]
  closed: [missionId: string]
  frame: [missionId: string, data: string, width: number, height: number]
}

/**
 * One headless browser for the whole app, one tab per mission. Agents drive it through MCP and
 * the person through the mission's browser panel; both see the same page. The profile is
 * Orbit's own, so none of the person's cookies or logins are in it.
 */
export class BrowserHost extends EventEmitter<BrowserEvents> {
  readonly engine: BrowserEngine | null
  private readonly profileDir: string
  private proc: ChildProcess | null = null
  private cdp: Promise<CdpPipe> | null = null
  private readonly tabs = new Map<string, Tab>()
  private readonly opening = new Map<string, Promise<Tab>>()
  /** Connections watching each mission's page. */
  private readonly watchers = new Map<string, Set<string>>()

  constructor(profileDir: string, engine: BrowserEngine | null) {
    super()
    this.profileDir = profileDir
    this.engine = engine
  }

  states(): MissionBrowser[] {
    return [...this.tabs.values()].map((t) => ({ ...t.state }))
  }

  isOpen(missionId: string): boolean {
    return this.tabs.has(missionId)
  }

  async navigate(missionId: string, raw: string, actor: string): Promise<MissionBrowser> {
    const url = browserUrl(raw)
    const tab = await this.tab(missionId)
    this.update(tab, { loading: true, lastActor: actor, error: null })
    const loaded = this.waitLoad(tab)
    const result = await this.send<{ errorText?: string }>(tab, 'Page.navigate', { url })
    if (result.errorText) {
      this.update(tab, { loading: false, url, error: result.errorText })
      throw new Error(`Não abriu ${url}: ${result.errorText}`)
    }
    await loaded
    await this.settle(tab)
    this.refresh(tab)
    return { ...tab.state }
  }

  async history(missionId: string, action: 'back' | 'forward' | 'reload', actor: string): Promise<void> {
    const tab = this.existing(missionId)
    this.update(tab, { lastActor: actor, error: null })
    if (action === 'reload') {
      const loaded = this.waitLoad(tab)
      await this.send(tab, 'Page.reload')
      await loaded
      await this.settle(tab)
      this.refresh(tab)
      return
    }
    const { currentIndex, entries } = await this.send<{ currentIndex: number; entries: Array<{ id: number }> }>(tab, 'Page.getNavigationHistory')
    const entry = entries[currentIndex + (action === 'back' ? -1 : 1)]
    if (!entry) return
    const loaded = this.waitLoad(tab)
    await this.send(tab, 'Page.navigateToHistoryEntry', { entryId: entry.id })
    await loaded
    await this.settle(tab)
    this.refresh(tab)
  }

  async screenshot(missionId: string): Promise<string> {
    const { data } = await this.send<{ data: string }>(this.existing(missionId), 'Page.captureScreenshot', { format: 'png' })
    return data
  }

  async text(missionId: string, maxChars: number): Promise<{ url: string; title: string; text: string }> {
    const tab = this.existing(missionId)
    const text = String(await this.evaluate(tab, 'document.body ? document.body.innerText : ""') ?? '')
    return { url: tab.state.url, title: tab.state.title, text: text.length > maxChars ? `${text.slice(0, maxChars)}\n…(cortado)` : text }
  }

  /** Clicks a point of the viewport, or the middle of the first element matching a CSS selector. */
  async click(missionId: string, target: { x: number; y: number } | { selector: string }, actor: string): Promise<{ x: number; y: number }> {
    const tab = this.existing(missionId)
    let point = 'selector' in target ? null : target
    if ('selector' in target) {
      point = await this.evaluate(tab, `(() => {
        const el = document.querySelector(${JSON.stringify(target.selector)})
        if (!el) return null
        el.scrollIntoView({ block: 'center', inline: 'center' })
        const r = el.getBoundingClientRect()
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
      })()`) as { x: number; y: number } | null
      if (!point) throw new Error(`Nada na página corresponde a ${target.selector}`)
    }
    const { x, y } = clampPoint(point!)
    this.update(tab, { lastActor: actor })
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'] as const) {
      await this.send(tab, 'Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: type === 'mouseMoved' ? 0 : 1 })
    }
    this.refresh(tab)
    return { x, y }
  }

  async scroll(missionId: string, x: number, y: number, dy: number): Promise<void> {
    const point = clampPoint({ x, y })
    const tab = this.existing(missionId)
    await this.send(tab, 'Input.dispatchMouseEvent', { type: 'mouseWheel', ...point, deltaX: 0, deltaY: Math.max(-5000, Math.min(5000, dy)) })
    this.refresh(tab)
  }

  /** Types into whatever has focus (click a field first). */
  async type(missionId: string, text: string, actor: string): Promise<void> {
    const tab = this.existing(missionId)
    this.update(tab, { lastActor: actor })
    await this.send(tab, 'Input.insertText', { text: text.slice(0, 10_000) })
    this.refresh(tab)
  }

  async key(missionId: string, key: string, actor: string): Promise<void> {
    if (!(BROWSER_KEYS as readonly string[]).includes(key)) throw new Error(`Tecla não suportada: ${key}`)
    const tab = this.existing(missionId)
    this.update(tab, { lastActor: actor })
    const code = KEY_CODES[key as keyof typeof KEY_CODES]
    const text = key === 'Enter' ? '\r' : undefined
    await this.send(tab, 'Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key, code: key, windowsVirtualKeyCode: code, ...(text ? { text } : {}) })
    await this.send(tab, 'Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code })
    this.refresh(tab)
  }

  /** Console messages, uncaught errors and failed requests, newest last. */
  consoleLines(missionId: string, lines: number): string[] {
    return this.existing(missionId).console.slice(-lines)
  }

  /** A connection starts or stops watching; frames flow while anyone watches. */
  watch(missionId: string, watcher: string, on: boolean): void {
    let set = this.watchers.get(missionId)
    if (!set) this.watchers.set(missionId, (set = new Set()))
    if (on) set.add(watcher)
    else set.delete(watcher)
    const tab = this.tabs.get(missionId)
    if (tab) void this.syncCast(tab)
  }

  unwatchAll(watcher: string): void {
    for (const [missionId, set] of this.watchers) if (set.delete(watcher)) this.watch(missionId, watcher, false)
  }

  async close(missionId: string): Promise<void> {
    const tab = this.tabs.get(missionId)
    if (!tab) return
    this.forgetTab(tab)
    try {
      await (await this.cdp)?.send('Target.closeTarget', { targetId: tab.targetId })
    } catch {
      // already gone
    }
  }

  shutdown(): void {
    this.proc?.kill()
    this.proc = null
  }

  // ---- internals ----

  private existing(missionId: string): Tab {
    const tab = this.tabs.get(missionId)
    if (!tab) throw new Error('O navegador da missão não está aberto; abra uma página com browser_open')
    return tab
  }

  private async browser(): Promise<CdpPipe> {
    if (!this.engine) throw new Error('Nenhum navegador Chromium encontrado (Chrome, Brave, Edge ou Chromium). Instale um ou aponte ORBIT_BROWSER para ele.')
    this.cdp ??= this.launch(this.engine)
    try {
      return await this.cdp
    } catch (error) {
      this.cdp = null
      throw error
    }
  }

  private async launch(engine: BrowserEngine): Promise<CdpPipe> {
    mkdirSync(this.profileDir, { recursive: true, mode: 0o700 })
    const proc = spawn(engine.path, [
      '--headless=new',
      '--remote-debugging-pipe',
      `--user-data-dir=${this.profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-sync',
      '--mute-audio',
      `--window-size=${BROWSER_VIEWPORT.width},${BROWSER_VIEWPORT.height}`,
      'about:blank',
    ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] })
    this.proc = proc
    const cdp = new CdpPipe(proc.stdio[3] as Writable, proc.stdio[4] as Readable)
    cdp.on('event', (event) => this.onEvent(event))
    const gone = () => {
      if (this.proc === proc) this.proc = null
      this.cdp = null
      cdp.close()
      for (const tab of [...this.tabs.values()]) this.forgetTab(tab)
    }
    proc.on('exit', gone)
    proc.on('error', gone)
    await cdp.send('Browser.getVersion', {}, undefined, 20_000)
    return cdp
  }

  private tab(missionId: string): Promise<Tab> {
    const existing = this.tabs.get(missionId)
    if (existing) return Promise.resolve(existing)
    let opening = this.opening.get(missionId)
    if (!opening) {
      opening = this.openTab(missionId).finally(() => this.opening.delete(missionId))
      this.opening.set(missionId, opening)
    }
    return opening
  }

  private async openTab(missionId: string): Promise<Tab> {
    const cdp = await this.browser()
    const { targetId } = await cdp.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await cdp.send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true })
    const on = (method: string, params: Record<string, unknown> = {}) => cdp.send(method, params, sessionId)
    await Promise.all([on('Page.enable'), on('Runtime.enable'), on('Log.enable')])
    await on('Emulation.setDeviceMetricsOverride', { width: BROWSER_VIEWPORT.width, height: BROWSER_VIEWPORT.height, deviceScaleFactor: 1, mobile: false })
    const { frameTree } = await on('Page.getFrameTree') as { frameTree: { frame: { id: string } } }
    const tab: Tab = {
      state: { missionId, url: 'about:blank', title: '', loading: false, lastActor: null, error: null },
      targetId,
      sessionId,
      mainFrameId: frameTree.frame.id,
      console: [],
      casting: false,
      loadWaiters: [],
      refreshTimers: [],
    }
    this.tabs.set(missionId, tab)
    this.emit('state', { ...tab.state })
    void this.syncCast(tab)
    return tab
  }

  private forgetTab(tab: Tab): void {
    if (this.tabs.get(tab.state.missionId) !== tab) return
    for (const timer of tab.refreshTimers.splice(0)) clearTimeout(timer)
    this.tabs.delete(tab.state.missionId)
    for (const wake of tab.loadWaiters.splice(0)) wake()
    this.emit('closed', tab.state.missionId)
  }

  private async syncCast(tab: Tab): Promise<void> {
    const want = (this.watchers.get(tab.state.missionId)?.size ?? 0) > 0
    if (want === tab.casting) return
    tab.casting = want
    try {
      if (want) await this.send(tab, 'Page.startScreencast', { format: 'jpeg', quality: 60, maxWidth: BROWSER_VIEWPORT.width, maxHeight: BROWSER_VIEWPORT.height, everyNthFrame: 1 })
      else await this.send(tab, 'Page.stopScreencast')
    } catch {
      tab.casting = !want
    }
  }

  private waitLoad(tab: Tab): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(done, LOAD_TIMEOUT_MS)
      function done() {
        clearTimeout(timer)
        resolve()
      }
      tab.loadWaiters.push(done)
    })
  }

  private onEvent({ method, params, sessionId }: CdpEvent): void {
    if (method === 'Target.detachedFromTarget') {
      const gone = [...this.tabs.values()].find((t) => t.sessionId === params.sessionId)
      if (gone) this.forgetTab(gone)
      return
    }
    const tab = [...this.tabs.values()].find((t) => t.sessionId === sessionId)
    if (!tab) return
    switch (method) {
      case 'Page.frameStartedLoading':
        if (params.frameId === tab.mainFrameId) this.update(tab, { loading: true })
        return
      case 'Page.frameNavigated':
        if (!params.frame?.parentId) {
          tab.mainFrameId = params.frame.id
          this.update(tab, { url: params.frame.url })
        }
        return
      case 'Page.navigatedWithinDocument':
        if (params.frameId === tab.mainFrameId) this.update(tab, { url: params.url })
        return
      case 'Page.loadEventFired':
        if (tab.loadWaiters.length) for (const wake of tab.loadWaiters.splice(0)) wake()
        else void this.settle(tab) // a load nobody waits for (a link the person clicked)
        return
      case 'Page.screencastFrame': {
        const { data, metadata, sessionId: frame } = params
        this.emit('frame', tab.state.missionId, data, Math.round(metadata.deviceWidth), Math.round(metadata.deviceHeight))
        setTimeout(() => void this.send(tab, 'Page.screencastFrameAck', { sessionId: frame }).catch(() => {}), FRAME_PACE_MS)
        return
      }
      case 'Runtime.consoleAPICalled':
        this.log(tab, `${params.type}: ${(params.args ?? []).map((a: any) => a.value ?? a.description ?? a.type).join(' ')}`)
        return
      case 'Runtime.exceptionThrown':
        this.log(tab, `erro: ${params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text ?? 'exceção'}`)
        return
      case 'Log.entryAdded':
        this.log(tab, `${params.entry.level}: ${params.entry.text}${params.entry.url ? ` (${params.entry.url})` : ''}`)
        return
    }
  }

  /** Title and loading state once a load finished. */
  private async settle(tab: Tab): Promise<void> {
    let title = tab.state.title
    try {
      title = String(await this.evaluate(tab, 'document.title') ?? '').slice(0, 200)
    } catch {
      // keep the last one
    }
    this.update(tab, { title, loading: false })
  }

  private log(tab: Tab, line: string): void {
    tab.console.push(line.slice(0, 2000))
    if (tab.console.length > CONSOLE_LINES) tab.console.splice(0, tab.console.length - CONSOLE_LINES)
  }

  private update(tab: Tab, patch: Partial<MissionBrowser>): void {
    Object.assign(tab.state, patch)
    this.emit('state', { ...tab.state })
  }

  /** Sends watchers a capture of the page shortly after an action. */
  private refresh(tab: Tab): void {
    if (!tab.casting) return
    for (const timer of tab.refreshTimers.splice(0)) clearTimeout(timer)
    tab.refreshTimers = REFRESH_AFTER_MS.map((ms) => setTimeout(() => {
      if (!tab.casting || this.tabs.get(tab.state.missionId) !== tab) return
      this.send<{ data: string }>(tab, 'Page.captureScreenshot', { format: 'jpeg', quality: 60 })
        .then(({ data }) => this.emit('frame', tab.state.missionId, data, BROWSER_VIEWPORT.width, BROWSER_VIEWPORT.height))
        .catch(() => {})
    }, ms))
  }

  private async send<T = any>(tab: Tab, method: string, params: Record<string, unknown> = {}): Promise<T> {
    const cdp = await this.browser()
    return cdp.send<T>(method, params, tab.sessionId)
  }

  private async evaluate(tab: Tab, expression: string): Promise<unknown> {
    const { result, exceptionDetails } = await this.send<{ result: { value?: unknown }; exceptionDetails?: { text: string } }>(tab, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (exceptionDetails) throw new Error(exceptionDetails.text)
    return result.value
  }
}

function clampPoint({ x, y }: { x: number; y: number }): { x: number; y: number } {
  const clamp = (v: number, max: number) => Math.max(0, Math.min(max - 1, Math.round(Number.isFinite(v) ? v : 0)))
  return { x: clamp(x, BROWSER_VIEWPORT.width), y: clamp(y, BROWSER_VIEWPORT.height) }
}
