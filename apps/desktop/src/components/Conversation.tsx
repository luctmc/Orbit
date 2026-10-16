import { useEffect, useRef, useState } from 'react'
import type { Pane } from '@orbit/protocol'
import { useOrbit, useOrbitClient } from '../orbit/context.tsx'
import { CLI_LABEL, STATUS } from '../orbit/labels.ts'
import { OrbitMark } from './icons.tsx'
import { MessageText } from './MessageText.tsx'

type Turn = { role: 'pessoa' | 'agente'; text: string }
export function Conversation({ pane, onTerminal }: { pane: Pane; onTerminal?: () => void }) {
  const client = useOrbitClient()
  const { events } = useOrbit()
  const [turns, setTurns] = useState<Turn[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [following, setFollowing] = useState(true)
  const scroller = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout>
    const refresh = async () => {
      try {
        const answer = await client.ask({ type: 'pane.conversation', paneId: pane.id }, 'pane.conversation', (m) => m.paneId === pane.id)
        if (alive) { setTurns(answer.turns); setError(null) }
      } catch (cause) { if (alive) setError(cause instanceof Error ? cause.message : String(cause)) }
      finally { if (alive) { setLoading(false); timer = setTimeout(() => void refresh(), 3000) } }
    }
    void refresh()
    return () => { alive = false; clearTimeout(timer) }
  }, [client, pane.id])
  const last = turns.at(-1)?.text
  useEffect(() => { if (follow.current && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight }, [last, turns.length])
  const activity = events.filter((e) => e.paneId === pane.id && e.kind !== 'pane.spawned').slice(-4)
  const name = pane.role === 'lead' ? 'Líder da missão' : pane.title
  return <div className="conversation">
    <div className="conversation__messages" ref={scroller} onScroll={(e) => {
      const el = e.currentTarget
      follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100
      setFollowing(follow.current)
    }} aria-label={`Conversa com ${name}`} aria-busy={loading}>
      {loading && <div className="conversation__skeleton" role="status"><span /><span /><span /><span className="sr-only">Carregando conversa…</span></div>}
      {!loading && !turns.length && <div className="conversation__empty"><OrbitMark size={36} /><span className="eyebrow">Seu ponto de partida</span><h2>Uma boa missão começa<br />com uma conversa.</h2><p>Conte o que você quer alcançar, o que já existe e como saberemos que ficou pronto. O líder organiza os próximos passos com você.</p><div className="conversation__steps"><span><b>01</b> Defina o objetivo</span><span><b>02</b> Acompanhe a execução</span><span><b>03</b> Confira a entrega</span></div><small>{pane.cli === 'claude' || pane.cli === 'codex' ? 'As respostas aparecem aqui conforme a CLI registra a conversa.' : 'Esta CLI apresenta as respostas no terminal.'}</small>{onTerminal && <button type="button" className="btn btn--ghost" onClick={onTerminal}>Ver terminal ao vivo</button>}</div>}
      {turns.map((turn, i) => <article key={i} className={`conversation__message conversation__message--${turn.role}`}>
        <div className="conversation__author">{turn.role === 'pessoa' ? <span>Você <small>· mensagem</small></span> : <><OrbitMark size={18} /><span>{name}</span><small>{CLI_LABEL[pane.cli]}</small></>}</div>
        <MessageText text={turn.text} />
      </article>)}
      {error && <p role="alert" className="composer__error">{error}</p>}
    </div>
    {!following && <button type="button" className="conversation__latest btn btn--ghost" onClick={() => { follow.current = true; setFollowing(true); if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight }}>Ir para a última mensagem ↓</button>}
    {!!activity.length && <details className="conversation__activity"><summary>{STATUS[pane.status].label} · Atividade recente</summary>
      {activity.length ? activity.map((e) => <div key={e.id}><strong>{e.title}</strong><p>{e.body}</p></div>) : <p className="muted">Sem atividade registrada.</p>}
    </details>}
  </div>
}
