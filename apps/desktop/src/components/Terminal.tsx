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

    const resize = () => {
      if (element.clientWidth === 0 || element.clientHeight === 0) return
      fit.fit()
      client.send({ type: 'pane.resize', paneId, cols: term.cols, rows: term.rows })
    }
    const observer = new ResizeObserver(() => requestAnimationFrame(resize))
    observer.observe(element)

    const offData = client.onPaneData(paneId, (data) => term.write(data))
    const input = term.onData((data) => client.send({ type: 'pane.input', paneId, data }))
    const textarea = element.querySelector('textarea')
    textarea?.addEventListener('focus', () => onFocusRef.current?.())

    return () => {
      observer.disconnect()
      offData()
      input.dispose()
      term.dispose()
    }
  }, [client, paneId, interactive])

  return <div className="terminal-host" ref={host} />
}
