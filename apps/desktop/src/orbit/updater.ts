import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { isTauri } from './context.tsx'

/** How often the app looks for a new release while open. */
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000
/** First look a little after start, so it does not compete with the sidecar booting. */
const FIRST_CHECK_MS = 8000

export interface UpdateInfo {
  current: string
  version: string
  notes: string | null
  date: string | null
}

export interface Updater {
  /** Only the desktop app installs updates; in a browser this stays false. */
  supported: boolean
  current: string | null
  available: UpdateInfo | null
  checking: boolean
  installing: boolean
  /** 0–1 while downloading, when the size is known. */
  progress: number | null
  error: string | null
  check: () => Promise<void>
  install: () => Promise<void>
}

/** Looks for new Orbit releases (through the sidecar and gh) and installs them with the updater plugin. */
export function useUpdater(): Updater {
  const [current, setCurrent] = useState<string | null>(null)
  const [available, setAvailable] = useState<UpdateInfo | null>(null)
  const [checking, setChecking] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const check = useCallback(async () => {
    if (!isTauri) return
    setChecking(true)
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      setAvailable(await invoke<UpdateInfo | null>('orbit_update_check'))
      setError(null)
    } catch (e) {
      setError(String(e))
    } finally {
      setChecking(false)
    }
  }, [])

  const install = useCallback(async () => {
    if (!isTauri) return
    setInstalling(true)
    setProgress(null)
    setError(null)
    const { invoke } = await import('@tauri-apps/api/core')
    const { listen } = await import('@tauri-apps/api/event')
    const stop = await listen<{ downloaded: number; total: number | null }>('orbit-update-progress', ({ payload }) => {
      setProgress(payload.total ? Math.min(1, payload.downloaded / payload.total) : null)
    })
    try {
      await invoke('orbit_update_install') // restarts the app when it succeeds
    } catch (e) {
      setError(String(e))
      setInstalling(false)
    } finally {
      stop()
    }
  }, [])

  useEffect(() => {
    if (!isTauri) return
    void import('@tauri-apps/api/app').then(({ getVersion }) => getVersion()).then(setCurrent, () => {})
    const first = window.setTimeout(() => void check(), FIRST_CHECK_MS)
    const every = window.setInterval(() => void check(), CHECK_EVERY_MS)
    return () => {
      window.clearTimeout(first)
      window.clearInterval(every)
    }
  }, [check])

  return { supported: isTauri, current, available, checking, installing, progress, error, check, install }
}

const Context = createContext<Updater | null>(null)
export const UpdaterProvider = Context.Provider

export function useAppUpdater(): Updater {
  const updater = useContext(Context)
  if (!updater) throw new Error('UpdaterProvider ausente')
  return updater
}
