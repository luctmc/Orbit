import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import './styles.css'
import { App } from './App.tsx'
import { OrbitClient } from './orbit/client.ts'
import { isTauri, OrbitProvider, sidecarUrl } from './orbit/context.tsx'

if (isTauri) document.documentElement.classList.add('is-tauri')
const client = new OrbitClient(sidecarUrl)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <OrbitProvider client={client}>
      <App />
    </OrbitProvider>
  </StrictMode>,
)
