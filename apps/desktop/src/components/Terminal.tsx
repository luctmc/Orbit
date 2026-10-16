import { useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { useOrbitClient } from '../orbit/context.tsx'
import { acceptsSuggestionKey, type InputSuggestion, type InlineSuggestion } from '../orbit/inputSuggestions.ts'
import { TerminalPrediction, type PromptCursor } from '../orbit/terminalPrediction.ts'
import { terminalDeviceReply } from '../orbit/terminalInput.ts'

const THEME = {
  background: '#0b0b0b',
  foreground: '#e6e6e6',
  cursor: '#c5e04b',
  cursorAccent: '#0b0b0b',
  selectionBackground: 'rgba(197, 224, 75, 0.28)',
  black: '#1b1b1b',
  brightBlack: '#5c5c5c',
  red: '#ff6b5e',
  brightRed: '#ff8a7f',
  green: '#c5e04b',
  brightGreen: '#d8ef72',
  yellow: '#ffb547',
  brightYellow: '#ffc96e',
  blue: '#7aa7ff',
  brightBlue: '#9dbdff',
  magenta: '#d68cff',
  brightMagenta: '#e3aaff',
  cyan: '#5fd4d0',
  brightCyan: '#86e3e0',
  white: '#cfcfcf',
  brightWhite: '#ffffff',
}

const FONT_FAMILY_NAME = "'Geist Mono Variable'"
const FONT_SIZE = 13
const SETTLE_MS = 120
const MIN_COLS = 20
const MIN_ROWS = 5

/** One xterm bound to one pane's PTY. Keystrokes go straight to the sidecar. */
export function Terminal({ paneId, interactive, onFocus, suggestions = [], predictionEnabled = false, predictionReady = false, executionEpoch }: { paneId: number; interactive: boolean; onFocus?: () => void; suggestions?: InputSuggestion[]; predictionEnabled?: boolean; predictionReady?: boolean; executionEpoch?: string }) {
  const client = useOrbitClient()
  const host = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const onFocusRef = useRef(onFocus)
  onFocusRef.current = onFocus
  const predictionOptions = useRef({ suggestions, predictionEnabled, predictionReady })
  predictionOptions.current = { suggestions, predictionEnabled, predictionReady }
  const controls = useRef({ refresh: () => {}, reset: () => {} })
  const terminal = useRef<XTerm | null>(null)
  const interactiveRef = useRef(interactive)
  interactiveRef.current = interactive
  useEffect(() => {
    if (!terminal.current) return
    terminal.current.options.disableStdin = !interactive
    terminal.current.options.cursorBlink = interactive
  }, [interactive])
  const [ghost, setGhost] = useState<(InlineSuggestion & { left: number; top: number; maxWidth: number }) | null>(null)
  useEffect(() => { controls.current.refresh() }, [suggestions])
  useEffect(() => { controls.current.reset() }, [predictionEnabled, predictionReady, executionEpoch])

  useEffect(() => {
    const element = host.current
    if (!element) return
    const term = new XTerm({
      theme: THEME,
      fontFamily: `${FONT_FAMILY_NAME}, ui-monospace, Menlo, monospace`,
      fontSize: FONT_SIZE,
      lineHeight: 1.25,
      cursorBlink: interactive,
      disableStdin: !interactive,
      scrollback: 5000,
      allowProposedApi: false,
    })
    terminal.current = term
    const fit = new FitAddon()
    term.loadAddon(fit)
    const predictor = new TerminalPrediction()
    let focused = false, composing = false
    const cursor = (): PromptCursor => {
      const buffer = term.buffer.active, line = buffer.getLine(buffer.baseY + buffer.cursorY)
      return { row: buffer.baseY + buffer.cursorY, column: buffer.cursorX, before: line?.translateToString(false, 0, buffer.cursorX) ?? '', after: line?.translateToString(true, buffer.cursorX) ?? '', selected: term.hasSelection() }
    }
    const currentPrediction = () => {
      const options = predictionOptions.current
      return focused && !composing && interactiveRef.current && options.predictionEnabled && options.predictionReady ? predictor.prediction(options.suggestions, cursor()) : null
    }
    const refreshPrediction = () => {
      const proposal = currentPrediction(), screen = element.querySelector('.xterm-screen'), box = frame.current
      if (!proposal || !screen || !box || term.buffer.active.viewportY !== term.buffer.active.baseY) { setGhost(null); return }
      const r = screen.getBoundingClientRect(), parent = box.getBoundingClientRect()
      const x = term.buffer.active.cursorX * r.width / term.cols
      const next = { ...proposal, left: r.left - parent.left + x, top: r.top - parent.top + term.buffer.active.cursorY * r.height / term.rows, maxWidth: Math.max(0, r.width - x) }
      setGhost(previous => previous?.value === next.value && previous.reason === next.reason && previous.left === next.left && previous.top === next.top && previous.maxWidth === next.maxWidth ? previous : next)
    }
    const resetPrediction = () => { predictor.reset(); setGhost(null) }
    controls.current = { refresh: refreshPrediction, reset: resetPrediction }
    const parsed = term.onWriteParsed(refreshPrediction)
    const scrolled = term.onScroll(refreshPrediction)
    const selectionChanged = term.onSelectionChange(refreshPrediction)
    term.attachCustomKeyEventHandler(event => {
      if (event.type !== 'keydown') return true
      const proposal = currentPrediction()
      if (!proposal || composing) return true
      if (acceptsSuggestionKey(event)) {
        event.preventDefault(); event.stopPropagation()
        setGhost(null)
        // paste() uses the CLI's bracketed-paste mode when enabled. No Enter is appended.
        term.paste(proposal.suffix)
        return false
      }
      if (event.key === 'Escape' && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && !event.isComposing) {
        event.preventDefault(); event.stopPropagation(); predictor.dismiss(); setGhost(null); return false
      }
      return true
    })

    // The xterm and the PTY must always share one size, or the program's cursor moves land in the
    // wrong cells. So: every resize of the view is also sent to the PTY; the view only starts
    // following its box after it holds the PTY's snapshot; and whenever the PTY changes size
    // (from this view or another), the view adopts it. Layout changes come in bursts (a pane
    // opening, the window dragging), so wait for them to settle, and never shrink to a size no
    // program can draw in.
    let disposed = false
    let snapshotApplied = false
    let settle: ReturnType<typeof setTimeout> | undefined
    const followBox = () => {
      clearTimeout(settle)
      settle = setTimeout(() => {
        if (!snapshotApplied || disposed) return
        const size = fit.proposeDimensions()
        if (!size || size.cols < MIN_COLS || size.rows < MIN_ROWS) return
        if (size.cols === term.cols && size.rows === term.rows) return
        term.resize(size.cols, size.rows)
        client.send({ type: 'pane.resize', paneId, cols: size.cols, rows: size.rows })
        refreshPrediction()
      }, SETTLE_MS)
    }
    const observer = new ResizeObserver(followBox)
    // A late web font changes the cell width without changing the box; measure again then.
    const onFonts = () => followBox()
    document.fonts.addEventListener('loadingdone', onFonts)

    let detach = () => {}
    let input: { dispose(): void } | undefined
    const onInputFocus = () => { focused = true; onFocusRef.current?.(); refreshPrediction() }
    const onInputBlur = () => { focused = false; setGhost(null) }
    const onCompositionStart = () => { composing = true; resetPrediction() }
    const onCompositionEnd = () => { composing = false; resetPrediction() }
    // Cells are measured when the terminal opens: with the fallback font they come out narrower
    // and the view would ask the PTY for too many columns. Open once the font is ready.
    void document.fonts.load(`${FONT_SIZE}px ${FONT_FAMILY_NAME}`).catch(() => undefined).then(() => {
      if (disposed) return
      term.open(element)
      observer.observe(element)
      detach = client.attachPane(paneId, {
        snapshot: ({ data, cols, rows }) => {
          snapshotApplied = false
          term.reset()
            resetPrediction()
          term.resize(cols, rows)
          term.write(data, () => {
            snapshotApplied = true
            followBox()
          })
        },
        data: (data) => term.write(data),
        resized: (cols, rows) => {
          if (cols !== term.cols || rows !== term.rows) term.resize(cols, rows)
            refreshPrediction()
        },
      })
      input = term.onData((data) => {
        if (terminalDeviceReply(data)) return
        if (predictionOptions.current.predictionReady && !composing) predictor.input(data, cursor())
        else resetPrediction()
        setGhost(null)
        client.send({ type: 'pane.input', paneId, data })
      })
      term.textarea?.addEventListener('focus', onInputFocus)
      term.textarea?.addEventListener('blur', onInputBlur)
      term.textarea?.addEventListener('compositionstart', onCompositionStart)
      term.textarea?.addEventListener('compositionend', onCompositionEnd)
    })

    return () => {
      disposed = true
      clearTimeout(settle)
      observer.disconnect()
      document.fonts.removeEventListener('loadingdone', onFonts)
      detach()
      input?.dispose()
      parsed.dispose(); scrolled.dispose(); selectionChanged.dispose()
      term.textarea?.removeEventListener('focus', onInputFocus)
      term.textarea?.removeEventListener('blur', onInputBlur)
      term.textarea?.removeEventListener('compositionstart', onCompositionStart)
      term.textarea?.removeEventListener('compositionend', onCompositionEnd)
      controls.current = { refresh: () => {}, reset: () => {} }
      terminal.current = null
      term.dispose()
    }
  }, [client, paneId])

  return <div className="terminal-surface">
    <div className="terminal-surface__screen" ref={frame}>
      <div className="terminal-host" ref={host} />
      {ghost && <div className="terminal-surface__ghost" aria-hidden="true" style={{ left: ghost.left, top: ghost.top, maxWidth: ghost.maxWidth }}>{ghost.suffix}</div>}
    </div>
    {predictionEnabled && <div className="terminal-surface__hint" role="status">
      {ghost ? <><span className="sr-only">Sugestão: {ghost.value}. </span><span>Orbit · <kbd>Tab</kbd> insere · Esc dispensa</span><span>{ghost.reason}</span></> : <span>{!predictionReady || !suggestions.length ? 'Sugestões do Orbit pausadas neste estado da missão.' : 'Sugestões do Orbit ao digitar no prompt do maestro · Tab insere quando houver sugestão'}</span>}
    </div>}
  </div>
}
