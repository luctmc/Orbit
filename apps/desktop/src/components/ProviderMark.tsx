import { useState } from 'react'
import openai from '../assets/openai.svg'
import anthropic from '../assets/anthropic.svg'
import { OrbitMark } from './icons.tsx'

/** Official marks identify the service only; text alongside carries the accessible identity. */
export function ProviderMark({ brand }: { brand: string | null }) {
  const [failed, setFailed] = useState(false)
  const src = brand === 'openai' ? openai : brand === 'anthropic' ? anthropic : null
  return <span className={`provider-mark provider-mark--${brand ?? 'other'}`} aria-hidden="true">{src && !failed ? <img src={src} alt="" width="24" height="24" onError={() => setFailed(true)} /> : <OrbitMark size={20} />}</span>
}
