import { useEffect, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { useOrbitClient } from '../orbit/context.tsx'

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
export function Terminal({ paneId, interactive, onFocus }: { paneId: number; interactive: boolean; onFocus?: () => void }) {
  const client = useOrbitClient()
  const host = useRef<HTMLDivElement>(null)
  const onFocusRef = useRef(onFocus)
  onFocusRef.current = onFocus

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
    const fit = new FitAddon()
    term.loadAddon(fit)

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
      }, SETTLE_MS)
    }
    const observer = new ResizeObserver(followBox)
    // A late web font changes the cell width without changing the box; measure again then.
    const onFonts = () => followBox()
    document.fonts.addEventListener('loadingdone', onFonts)

    let detach = () => {}
    let input: { dispose(): void } | undefined
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
          term.resize(cols, rows)
          term.write(data, () => {
            snapshotApplied = true
            followBox()
          })
        },
        data: (data) => term.write(data),
        resized: (cols, rows) => {
          if (cols !== term.cols || rows !== term.rows) term.resize(cols, rows)
        },
      })
      input = term.onData((data) => client.send({ type: 'pane.input', paneId, data }))
      element.querySelector('textarea')?.addEventListener('focus', () => onFocusRef.current?.())
    })

    return () => {
      disposed = true
      clearTimeout(settle)
      observer.disconnect()
      document.fonts.removeEventListener('loadingdone', onFonts)
      detach()
      input?.dispose()
      term.dispose()
    }
  }, [client, paneId, interactive])

  return <div className="terminal-host" ref={host} />
}
