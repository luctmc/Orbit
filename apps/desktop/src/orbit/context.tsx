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

export function sidecarUrl(): string {
  const port = import.meta.env.VITE_ORBIT_PORT ?? '4317'
  const token = import.meta.env.VITE_ORBIT_TOKEN ?? ''
  return `ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(token)}`
}
