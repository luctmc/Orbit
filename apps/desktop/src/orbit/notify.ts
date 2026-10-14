import { useCallback, useEffect, useRef, useState } from 'react'
import { isTauri, useOrbit, useOrbitClient } from './context.tsx'
import { DEFAULT_PREFS, NoticeWatcher, waitingCount, type Notice, type NoticePrefs } from './notices.ts'

const PREFS_KEY = 'orbit.notices'
/** Coming back to Orbit this soon after a notice opens the agent it was about. */
const FOLLOW_MS = 90_000

function loadPrefs(): NoticePrefs {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') }
  } catch {
    return DEFAULT_PREFS
  }
}

/** The person's choices, kept in this window's storage. */
export function useNoticePrefs(): [NoticePrefs, (prefs: NoticePrefs) => void] {
  const [prefs, setPrefs] = useState(loadPrefs)
  const save = useCallback((next: NoticePrefs) => {
    setPrefs(next)
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(next))
      window.dispatchEvent(new Event('orbit-notices'))
    } catch {
      // private window: the choice lasts until it closes
    }
  }, [])
  useEffect(() => {
    const reload = () => setPrefs(loadPrefs())
    window.addEventListener('orbit-notices', reload)
    return () => window.removeEventListener('orbit-notices', reload)
  }, [])
  return [prefs, save]
}

/** Shows a notification through macOS (desktop app) or the browser. False when not allowed. */
export async function showNotice(notice: Pick<Notice, 'title' | 'body'>, sound: boolean): Promise<boolean> {
  if (isTauri) {
    const { isPermissionGranted, requestPermission, sendNotification } = await import('@tauri-apps/plugin-notification')
    if (!(await isPermissionGranted()) && (await requestPermission()) !== 'granted') return false
    sendNotification({ title: notice.title, body: notice.body, ...(sound ? { sound: 'default' } : {}) })
    return true
  }
  if (typeof Notification === 'undefined') return false
  if (Notification.permission === 'default') await Notification.requestPermission()
  if (Notification.permission !== 'granted') return false
  new Notification(notice.title, { body: notice.body, silent: !sound })
  return true
}

/**
 * Notifications for what needs the person, the Dock badge with the agents waiting for them, and
 * coming back to Orbit after a notification opens that agent.
 */
export function useNotifications(openPane: (missionId: string, paneId: number | null) => void): void {
  const client = useOrbitClient()
  const { panes } = useOrbit()
  const [prefs] = useNoticePrefs()
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs
  const openRef = useRef(openPane)
  openRef.current = openPane
  const last = useRef<{ notice: Notice; at: number } | null>(null)

  useEffect(() => {
    const watcher = new NoticeWatcher()
    return client.listen((message) => {
      const current = prefsRef.current
      for (const notice of watcher.observe(message, client.getState().missions, current)) {
        const inFront = document.visibilityState === 'visible' && document.hasFocus()
        if (current.onlyInBackground && inFront) continue
        last.current = { notice, at: Date.now() }
        void showNotice(notice, current.sound).catch(() => {})
      }
    })
  }, [client])

  // Clicking a notification brings Orbit to the front: go to the agent it was about.
  useEffect(() => {
    const onFocus = () => {
      const recent = last.current
      last.current = null
      if (recent && Date.now() - recent.at < FOLLOW_MS) openRef.current(recent.notice.missionId, recent.notice.paneId)
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  const waiting = waitingCount(panes)
  useEffect(() => {
    if (isTauri) {
      void import('@tauri-apps/api/window').then(({ getCurrentWindow }) => getCurrentWindow().setBadgeCount(waiting || undefined)).catch(() => {})
    } else {
      document.title = waiting ? `(${waiting}) Orbit` : 'Orbit'
    }
  }, [waiting])
}
