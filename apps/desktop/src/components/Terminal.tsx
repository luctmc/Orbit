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
      fontFamily: "'Geist Mono Variable', ui-monospace, Menlo, monospace",
      fontSize: 13,
      lineHeight: 1.25,
      cursorBlink: interactive,
      disableStdin: !interactive,
      scrollback: 5000,
      allowProposedApi: false,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(element)

    // The xterm and the PTY must always share one size: every resize of the view is also sent to
    // the PTY, and the view only starts following its box after it holds the PTY's snapshot.
    // Layout changes come in bursts (a pane opening, the window dragging), so wait for them to
    // settle, and never shrink to a size no program can draw in.
    let snapshotApplied = false
    let settle: ReturnType<typeof setTimeout> | undefined
    const followBox = () => {
      clearTimeout(settle)
      settle = setTimeout(() => {
        if (!snapshotApplied) return
        const size = fit.proposeDimensions()
        if (!size || size.cols < MIN_COLS || size.rows < MIN_ROWS) return
        if (size.cols === term.cols && size.rows === term.rows) return
        term.resize(size.cols, size.rows)
        client.send({ type: 'pane.resize', paneId, cols: size.cols, rows: size.rows })
      }, SETTLE_MS)
    }
    const observer = new ResizeObserver(followBox)
    observer.observe(element)

    const detach = client.attachPane(paneId, {
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
    })
    const input = term.onData((data) => client.send({ type: 'pane.input', paneId, data }))
    const textarea = element.querySelector('textarea')
    textarea?.addEventListener('focus', () => onFocusRef.current?.())

    return () => {
      clearTimeout(settle)
      observer.disconnect()
      detach()
      input.dispose()
      term.dispose()
    }
  }, [client, paneId, interactive])

  return <div className="terminal-host" ref={host} />
}
