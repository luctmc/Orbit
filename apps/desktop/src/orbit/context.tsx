import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react'
import { OrbitClient, type OrbitState } from './client.ts'

const ClientContext = createContext<OrbitClient | null>(null)

export function OrbitProvider({ client, children }: { client: OrbitClient; children: ReactNode }) {
  return <ClientContext.Provider value={client}>{children}</ClientContext.Provider>
}

export function useOrbitClient(): OrbitClient {
  const client = useContext(ClientContext)
  if (!client) throw new Error('OrbitProvider ausente')
  return client
}

export function useOrbit(): OrbitState {
  const client = useOrbitClient()
  return useSyncExternalStore(client.subscribe, client.getState)
}

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

/** In the app the shell hands over the sidecar's port and token; in the browser dev setup, Vite env does. */
export async function sidecarUrl(): Promise<string> {
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core')
    const { port, token } = await invoke<{ port: number; token: string }>('orbit_connection')
    return `ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(token)}`
  }
  const port = import.meta.env.VITE_ORBIT_PORT ?? '4317'
  const token = import.meta.env.VITE_ORBIT_TOKEN ?? ''
  return `ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(token)}`
}
