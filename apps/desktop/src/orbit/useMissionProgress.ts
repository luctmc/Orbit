import { useEffect, useRef, useState } from 'react'
import type { MissionProgress } from '@orbit/protocol'
import { useOrbit, useOrbitClient } from './context.tsx'

/** Only the visible mission polls. One request at a time, no work in a hidden tab. */
export function useMissionProgress(missionId: string, active = true) {
  const client = useOrbitClient()
  const { connection } = useOrbit()
  const refresh = useRef<() => void>(() => {})
  const [state, setState] = useState<{ missionId: string; data: MissionProgress | null; error: string | null; loading: boolean }>({ missionId, data: null, error: null, loading: true })
  useEffect(() => {
    if (!active) { refresh.current = () => {}; return }
    let alive = true, running = false
    let timer: ReturnType<typeof setTimeout> | undefined
    setState({ missionId, data: null, error: null, loading: connection === 'open' })
    const read = async () => {
      if (!alive || running || document.hidden || connection !== 'open') return
      clearTimeout(timer)
      running = true
      setState(s => ({ ...s, loading: true }))
      try {
        const requestId = crypto.randomUUID()
        const reply = await client.ask({ type: 'mission.progress', missionId, requestId }, 'mission.progress', m => m.requestId === requestId && m.progress.missionId === missionId)
        if (alive) setState({ missionId, data: reply.progress, error: null, loading: false })
      } catch (error) {
        if (alive) setState(s => ({ ...s, error: error instanceof Error ? error.message : String(error), loading: false }))
      } finally {
        running = false
        if (alive && connection === 'open' && !document.hidden) timer = setTimeout(() => void read(), 10000)
      }
    }
    const wake = () => { if (document.hidden) clearTimeout(timer); else void read() }
    refresh.current = () => void read()
    document.addEventListener('visibilitychange', wake)
    void read()
    return () => { alive = false; clearTimeout(timer); document.removeEventListener('visibilitychange', wake); refresh.current = () => {} }
  }, [client, connection, missionId, active])
  const current = state.missionId === missionId ? state : { data: null, error: null, loading: connection === 'open' }
  return { ...current, connection, refresh: () => refresh.current() }
}
