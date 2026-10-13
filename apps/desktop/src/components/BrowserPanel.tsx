import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent, type WheelEvent } from 'react'
import { BROWSER_KEYS, BROWSER_VIEWPORT, type BrowserInput, type MissionBrowser } from '@orbit/protocol'
import { useOrbit, useOrbitClient } from '../orbit/context.tsx'
import { BackIcon, CloseIcon, GlobeIcon, ReloadIcon } from './icons.tsx'

/** Wheel deltas are summed and sent at most this often. */
const SCROLL_PACE_MS = 60

/** The mission's page: the same one its agents open, live, and usable with mouse and keyboard. */
export function BrowserPanel({ missionId, archived, onClose }: { missionId: string; archived: boolean; onClose: () => void }) {
  const client = useOrbitClient()
  const { browsers, browserEngine } = useOrbit()
  const page: MissionBrowser | undefined = browsers.find((b) => b.missionId === missionId)
  const [address, setAddress] = useState(page?.url ?? '')
  const [editing, setEditing] = useState(false)
  const [hasFrame, setHasFrame] = useState(false)
  const image = useRef<HTMLImageElement>(null)
  /** Catches typing (accents and pastes included) while the page has focus, like a terminal does. */
  const keys = useRef<HTMLTextAreaElement>(null)
  const scroll = useRef<{ dy: number; x: number; y: number; timer: number | null }>({ dy: 0, x: 0, y: 0, timer: null })

  // The address bar follows the page unless the person is typing in it.
  useEffect(() => {
    if (!editing) setAddress(page?.url && page.url !== 'about:blank' ? page.url : '')
  }, [page?.url, editing])

  useEffect(() => {
    setHasFrame(false)
    return client.watchBrowser(missionId, ({ data }) => {
      if (image.current) image.current.src = `data:image/jpeg;base64,${data}`
      setHasFrame(true)
    })
  }, [client, missionId])

  const send = (input: BrowserInput) => client.send({ type: 'browser.input', missionId, input })

  /** Page coordinates of a point on the picture (it is drawn at the page's aspect ratio). */
  const pagePoint = (event: { clientX: number; clientY: number }) => {
    const rect = image.current!.getBoundingClientRect()
    return {
      x: Math.round(((event.clientX - rect.left) / rect.width) * BROWSER_VIEWPORT.width),
      y: Math.round(((event.clientY - rect.top) / rect.height) * BROWSER_VIEWPORT.height),
    }
  }

  const go = (event: FormEvent) => {
    event.preventDefault()
    if (!address.trim()) return
    client.send({ type: 'browser.navigate', missionId, url: address.trim() })
    setEditing(false)
  }

  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    keys.current?.focus({ preventScroll: true })
    if (page && event.target === image.current) send({ kind: 'click', ...pagePoint(event) })
  }

  /** Whatever the field received goes to the page as text. */
  const flush = () => {
    const field = keys.current
    if (!field?.value) return
    if (page) send({ kind: 'type', text: field.value })
    field.value = ''
  }

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!page) return
    const pending = scroll.current
    pending.dy += event.deltaY
    Object.assign(pending, pagePoint(event))
    pending.timer ??= window.setTimeout(() => {
      send({ kind: 'scroll', x: pending.x, y: pending.y, dy: Math.round(pending.dy) })
      pending.dy = 0
      pending.timer = null
    }, SCROLL_PACE_MS)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!page || event.nativeEvent.isComposing || event.metaKey || event.ctrlKey || event.altKey) return
    if ((BROWSER_KEYS as readonly string[]).includes(event.key)) {
      event.preventDefault()
      flush()
      send({ kind: 'key', key: event.key })
    }
  }

  const unavailable = browserEngine === null
  const by = page?.lastActor ? (page.lastActor === 'você' ? 'por você' : `por ${page.lastActor}`) : null

  return (
    <aside className="browser" aria-label="Navegador da missão">
      <form className="browser__bar" onSubmit={go}>
        <button type="button" className="icon-btn" aria-label="Voltar" disabled={!page} onClick={() => client.send({ type: 'browser.history', missionId, action: 'back' })}><BackIcon size={15} /></button>
        <button type="button" className="icon-btn" aria-label="Recarregar" disabled={!page} onClick={() => client.send({ type: 'browser.history', missionId, action: 'reload' })}><ReloadIcon size={14} /></button>
        <label className="sr-only" htmlFor={`browser-url-${missionId}`}>Endereço</label>
        <input
          id={`browser-url-${missionId}`}
          className="browser__url"
          value={address}
          spellCheck={false}
          autoComplete="off"
          disabled={archived || unavailable}
          placeholder="localhost:5173"
          onFocus={() => setEditing(true)}
          onBlur={() => setEditing(false)}
          onChange={(e) => setAddress(e.target.value)}
        />
        <button type="button" className="icon-btn" aria-label="Fechar o navegador" title="Fechar (a página da missão continua aberta para os agentes)" onClick={onClose}><CloseIcon size={14} /></button>
      </form>
      <div className={`browser__progress${page?.loading ? ' browser__progress--on' : ''}`} aria-hidden="true" />
      <div className="browser__meta">
        <GlobeIcon size={13} />
        <span className="browser__title">{page ? page.title || page.url : 'Nenhuma página aberta'}</span>
        {by && <span className="chip">{by}</span>}
        {page && !archived && <button type="button" className="link-btn" onClick={() => client.send({ type: 'browser.close', missionId })}>Fechar página</button>}
      </div>
      {page?.error && <p className="form-error browser__error" role="alert">{page.error}</p>}
      <div
        className={`browser__view${page && hasFrame ? '' : ' browser__view--empty'}`}
        onClick={onClick}
        onWheel={onWheel}
      >
        <textarea
          ref={keys}
          className="browser__keys"
          aria-label={page ? `Digitar na página ${page.title || page.url}` : 'Navegador sem página'}
          disabled={!page}
          autoCapitalize="off"
          autoComplete="off"
          spellCheck={false}
          onKeyDown={onKeyDown}
          onInput={(e) => { if (!(e.nativeEvent as InputEvent).isComposing) flush() }}
          onCompositionEnd={flush}
        />
        <img ref={image} alt="" draggable={false} hidden={!page || !hasFrame} />
        {(!page || !hasFrame) && (
          <div className="browser__empty">
            {unavailable ? (
              <p>Nenhum navegador Chromium encontrado. Instale o Chrome, o Brave, o Edge ou o Chromium para os agentes verem as páginas.</p>
            ) : page ? (
              <p>Carregando a página…</p>
            ) : (
              <p>Abra o endereço do app aqui em cima, ou peça a um agente: eles abrem a página com <code>browser_open</code> e você vê a mesma tela.</p>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}
