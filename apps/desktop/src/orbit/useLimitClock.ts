import { useEffect, useState } from 'react'

/** Keeps reset/freshness labels current even when the provider sends no new message. */
export function useLimitClock() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
  return now
}
