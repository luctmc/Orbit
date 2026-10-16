import { useState } from 'react'
import type { CompanionState } from '../orbit/missionStatus.ts'
import mascot from '../assets/orbit-mascot-v2.png'

function preference(key: string): boolean {
  try { return localStorage.getItem(`orbit.companion.${key}`) === 'true' } catch { return false }
}
function save(key: string, value: boolean) {
  try { localStorage.setItem(`orbit.companion.${key}`, String(value)) } catch { /* Optional per-viewer preference. */ }
}

/** State is supplied by the mission, never inferred from tokens or animation timers. */
export function OrbitCompanion({ state }: { state: CompanionState }) {
  const [hidden, setHidden] = useState(() => preference('hidden'))
  const [motion, setMotion] = useState(() => preference('motion'))
  const toggleHidden = () => { save('hidden', !hidden); setHidden(!hidden) }
  if (hidden) return <button type="button" className="companion__restore" onClick={toggleHidden}>Mostrar Orbit</button>
  return <div className="companion" data-state={state} data-motion={motion}>
    <img className="companion__art" src={mascot} width="88" height="88" alt="Orbit, companheiro orbital grafite com anel verde" decoding="async" draggable="false" />
    <details className="companion__options">
      <summary aria-label="Opções do mascote Orbit">Orbit</summary>
      <div>
        <button type="button" onClick={toggleHidden}>Ocultar mascote</button>
        <button type="button" aria-pressed={motion} onClick={() => { save('motion', !motion); setMotion(!motion) }}>Movimento {motion ? 'ligado' : 'desligado'}</button>
      </div>
    </details>
  </div>
}
