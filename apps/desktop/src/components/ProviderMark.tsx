import { useState } from 'react'
import openai from '../assets/openai.svg'
import claude from '../assets/claude.svg'
import { OrbitMark } from './icons.tsx'
import './ProviderMark.css'

/** Official marks identify the service only; text alongside carries the accessible identity. */
export function ProviderMark({ brand }: { brand: string | null }) {
  const [failed, setFailed] = useState(false)
  const src = brand === 'openai' ? openai : brand === 'anthropic' ? claude : null
  return <span className={`provider-mark provider-mark--${brand ?? 'other'}`} aria-hidden="true">{src && !failed ? <img src={src} alt="" width="24" height="24" onError={() => setFailed(true)} /> : <OrbitMark size={20} />}</span>
}
