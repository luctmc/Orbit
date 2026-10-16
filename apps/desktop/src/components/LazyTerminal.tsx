import { lazy, Suspense, type ComponentProps } from 'react'
import type { Terminal as TerminalView } from './Terminal.tsx'

// The home screen and the leader's conversation do not need xterm's renderer at startup.
const View = lazy(() => import('./Terminal.tsx').then(module => ({ default: module.Terminal })))
export function Terminal(props: ComponentProps<typeof TerminalView>) {
  return <Suspense fallback={<div className="terminal-loading" role="status">Preparando terminal…</div>}><View {...props} /></Suspense>
}
