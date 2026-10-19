import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { TRANSLATION_LABEL, ATTACHMENT_LIMITS, type Attachment, type Pane } from '@orbit/protocol'
import { useOrbit, useOrbitClient } from '../orbit/context.tsx'
import { dictationAvailable, joinText, useDictation } from '../orbit/dictation.ts'
import { CloseIcon, MicIcon, PlusIcon, SendIcon } from './icons.tsx'
import { acceptsSuggestionKey, inlineSuggestion, type InputSuggestion } from '../orbit/inputSuggestions.ts'

type DraftAttachment = Attachment & { preview: string | null }
const encodedFile = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onerror = () => reject(new Error(`Não foi possível ler ${file.name}`))
  reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
  reader.readAsDataURL(file)
})

/** One focused message, with context visible before sending it to the selected agent. */
export function MessageComposer({ pane, inputRef, active = true, suggestions = [], suggestionsOn = true, onToggleSuggestions, leader, onSelectPane, recipients = [] }: { recipients?: Pane[]; leader?: Pane; onSelectPane?: (id: number) => void; pane: Pane; inputRef: RefObject<HTMLTextAreaElement | null>; active?: boolean; suggestions?: InputSuggestion[]; suggestionsOn?: boolean; onToggleSuggestions?: () => void }) {
  const client = useOrbitClient()
  const { connection, accounts, settings } = useOrbit()
  const draftKey = `pane-${pane.id}`
  const draft = client.inputDrafts.get(draftKey)
  const [translationAccountId, setTranslationAccountId] = useState(draft?.accountId ?? '')
  const [dispatch, setDispatch] = useState<'new-task' | 'continue'>(draft?.dispatch ?? (pane.role === 'lead' && pane.cli !== 'shell' ? 'new-task' : 'continue'))
  const [allowOriginal, setAllowOriginal] = useState(draft?.allowOriginal ?? false)
  const [pending, setPending] = useState(client.inputPending(draftKey))
  const [text, setText] = useState(draft?.text ?? '')
  useEffect(() => { client.inputDrafts.set(draftKey, { text, accountId: translationAccountId, allowOriginal, dispatch }) }, [client, draftKey, text, translationAccountId, allowOriginal, dispatch])
  const [files, setFiles] = useState<DraftAttachment[]>(client.inputAttachments.get(draftKey) ?? [])
  useEffect(() => { client.inputAttachments.set(draftKey, files) }, [client, draftKey, files])
  const [uploading, setUploading] = useState(false)
  const [sending, setSending] = useState(false)
  const [receipt, setReceipt] = useState(client.inputReceipts.get(draftKey))
  const sendLock = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [focused, setFocused] = useState(false)
  const [composing, setComposing] = useState(false)
  const [selection, setSelection] = useState({ start: 0, end: 0 })
  const [dismissed, setDismissed] = useState<string | null>(null)
  const language = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const dismiss = (event: KeyboardEvent | PointerEvent) => {
      const details = language.current
      if (!details?.open) return
      if (event instanceof KeyboardEvent) {
        if (event.key !== 'Escape') return
        event.preventDefault(); details.open = false; details.querySelector('summary')?.focus()
      } else if (!details.contains(event.target as Node)) details.open = false
    }
    document.addEventListener('keydown', dismiss)
    document.addEventListener('pointerdown', dismiss)
    return () => { document.removeEventListener('keydown', dismiss); document.removeEventListener('pointerdown', dismiss) }
  }, [])
  const localInput = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    if (!active) return
    inputRef.current = localInput.current
    return () => { if (inputRef.current === localInput.current) inputRef.current = null }
  }, [active, inputRef])
  const picker = useRef<HTMLInputElement>(null)
  const previews = useRef(new Set(files.flatMap(f => f.preview ? [f.preview] : [])))
  const dictated = useRef('')
  const acceptingSpeech = useRef(true)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const dictation = useDictation((phrase, final) => {
    if (!acceptingSpeech.current) return
    if (final) dictated.current = joinText(dictated.current, phrase)
    setText(final ? dictated.current : joinText(dictated.current, phrase))
  })
  const busy = uploading || sending
  useEffect(() => { if (!active) { dictation.stop(); setFocused(false) } }, [active, dictation.stop])
  const disabled = busy || connection !== 'open'
  const editingDisabled = disabled || pending
  const candidate = suggestionsOn && focused && !disabled && !composing && !dictation.listening && !dragging && selection.start === text.length && selection.end === text.length ? inlineSuggestion(text, suggestions) : null
  const prediction = dismissed === text ? null : candidate
  useLayoutEffect(() => {
    if (!active) return
    const input = localInput.current
    if (!input) return
    const resize = () => {
      input.style.height = 'auto'
      const ghost = input.parentElement?.querySelector<HTMLElement>('.composer__ghost')
      input.style.height = `${Math.min(200, Math.max(input.scrollHeight, ghost?.scrollHeight ?? 0))}px`
    }
    resize()
    // Reflow the draft when a sidebar or window resize changes the available writing width.
    let width = input.clientWidth
    let frame = 0
    const observer = new ResizeObserver(() => {
      if (input.clientWidth !== width) { width = input.clientWidth; cancelAnimationFrame(frame); frame = requestAnimationFrame(resize) }
    })
    observer.observe(input)
    return () => { cancelAnimationFrame(frame); observer.disconnect() }
  }, [text, prediction?.value, inputRef, active])
  const syncSelection = (input: HTMLTextAreaElement) => setSelection({ start: input.selectionStart, end: input.selectionEnd })
  const acceptPrediction = () => {
    if (!prediction || editingDisabled) return
    setText(prediction.value); dictated.current = prediction.value
    setSelection({ start: prediction.value.length, end: prediction.value.length })
    setDismissed(null)
    localInput.current?.focus()
    // Only update the draft. send() remains the sole submission path.
  }

  const addFiles = async (incoming: File[]) => {
    if (editingDisabled || pane.cli === 'shell' || !incoming.length) return
    setError(null)
    if (files.length + incoming.length > ATTACHMENT_LIMITS.files) return setError('Envie até 8 anexos por mensagem.')
    if (incoming.some((f) => f.size > ATTACHMENT_LIMITS.bytes)) return setError('Cada anexo pode ter até 4 MB.')
    if ([...files, ...incoming].reduce((n, f) => n + f.size, 0) > ATTACHMENT_LIMITS.totalBytes) return setError('Os anexos podem somar até 8 MB por mensagem.')
    setUploading(true)
    try {
      for (const file of incoming) {
        const requestId = crypto.randomUUID()
        const data = await encodedFile(file)
        if (!mounted.current) break
        const answer = await client.ask({ type: 'attachment.add', paneId: pane.id, requestId, name: file.name, mime: file.type, data }, 'attachment.added', (m) => m.requestId === requestId)
        if (!mounted.current) break
        const preview = /^(image\/(png|jpeg|webp|gif))$/.test(file.type) ? URL.createObjectURL(file) : null
        if (preview) previews.current.add(preview)
        setFiles((items) => [...items, { ...answer.attachment, preview }])
      }
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { if (mounted.current) setUploading(false) }
  }
  const send = async () => {
    if (sendLock.current || disabled || (!pending && !text.trim() && !files.length)) return
    sendLock.current = true
    acceptingSpeech.current = false
    dictation.stop(true)
    setSending(true)
    setError(null)
    try {
      await (pending ? client.checkPendingInput(draftKey) : client.submitInput({ paneId: pane.id, text, dispatch, attachments: files.map(f => f.id), translationAccountId: translationAccountId || undefined, allowOriginal }))
      client.inputDrafts.set(draftKey, { text: '', accountId: translationAccountId, allowOriginal, dispatch })
      client.inputAttachments.delete(draftKey)
      for (const url of previews.current) URL.revokeObjectURL(url)
      previews.current.clear()
      if (!mounted.current) return
      setPending(false)
      setText(''); dictated.current = ''; setSelection({ start: 0, end: 0 }); setDismissed(null)
      setReceipt(client.inputReceipts.get(draftKey))
      setFiles([])
      requestAnimationFrame(() => localInput.current?.focus())
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { sendLock.current = false; if (mounted.current) { setSending(false); setPending(client.inputPending(draftKey)); acceptingSpeech.current = true } }
  }
  if (!active) return null
  return (
    <form className={`composer${dragging ? ' composer--dragging' : ''}`} onSubmit={(e) => { e.preventDefault(); void send() }}
      onDragOver={(e) => { if (pane.cli !== 'shell' && e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true) } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false) }}
      onDrop={(e) => { e.preventDefault(); setDragging(false); void addFiles(Array.from(e.dataTransfer.files)) }}>
      <div className="composer__head">
        <div className="composer__target">
          <label className="sr-only" htmlFor={`message-${pane.id}`}>Mensagem para {pane.role === 'lead' ? 'o líder' : pane.title} · #{pane.id}</label>
          <span className="composer__to" aria-hidden="true">Para</span>
          {onSelectPane && recipients.length > 1 ? <><label className="sr-only" htmlFor={`recipient-${pane.id}`}>Destinatário da mensagem</label><select id={`recipient-${pane.id}`} value={pane.id} onChange={e => onSelectPane(Number(e.target.value))}>
            {recipients.map(target => <option key={target.id} value={target.id}>{target.role === 'lead' ? 'Líder' : target.title} · #{target.id}</option>)}
          </select></> : <strong>{pane.role === 'lead' ? 'o líder' : pane.title}</strong>}
          <span className="composer__recipient">#{pane.id} · {pane.cli}</span>
        </div>
        {pane.role !== 'lead' && leader && leader.status !== 'exited' && onSelectPane && <button type="button" className="btn btn--ghost btn--sm composer__leader" onClick={() => onSelectPane(leader.id)}>Conversar com líder</button>}
        <span className="composer__status" role="status">{connection !== 'open' ? 'Reconectando…' : uploading ? 'Preparando anexos…' : dictation.listening ? `Ouvindo${dictation.mode === 'apple' ? ' · Apple' : dictation.mode === 'local' ? ' · no Mac' : ''}…` : ''}</span>
      </div>
      {pane.role === 'lead' && pane.cli !== 'shell' && <div className="field">
        <label htmlFor={`dispatch-${pane.id}`}>Tipo de envio</label>
        <select id={`dispatch-${pane.id}`} value={dispatch} disabled={editingDisabled} onChange={e => setDispatch(e.target.value as 'new-task' | 'continue')} aria-describedby={`dispatch-help-${pane.id}`}>
          <option value="new-task">Nova tarefa</option><option value="continue">Continuar tarefa</option>
        </select>
        <p className="note" id={`dispatch-help-${pane.id}`}>{dispatch === 'new-task' ? 'Abre uma nova CLI visível com a mesma conta do líder. O resultado aguarda revisão antes de fechar.' : 'Envia uma orientação, resposta ou pergunta para esta CLI, mantendo o contexto atual.'}</p>
      </div>}
      <div className="composer__content">
      {!!files.length && <ul className="composer__files" aria-label="Anexos da mensagem">
        {files.map((file) => <li key={file.id}>
          {file.preview && <img src={file.preview} alt={`Prévia de ${file.name}`} />}
          <span title={file.name}>{file.name}<small>{Math.max(1, Math.round(file.size / 1024))} KB</small></span>
          <button className="icon-btn" type="button" disabled={busy || pending} aria-label={`Remover ${file.name}`} onClick={() => {
            if (file.preview) { URL.revokeObjectURL(file.preview); previews.current.delete(file.preview) }
            setFiles((items) => items.filter((f) => f.id !== file.id))
          }}><CloseIcon size={14} /></button>
        </li>)}
      </ul>}
      <div className="composer__input">
      {prediction && <div className="composer__ghost" aria-hidden="true"><span>{text}</span>{prediction.suffix}</div>}
      <textarea id={`message-${pane.id}`} ref={localInput} value={text} rows={1} maxLength={20_000} disabled={sending || pending}
        aria-autocomplete={suggestionsOn && pane.role === 'lead' ? 'inline' : 'none'} aria-describedby={`message-help-${pane.id}${prediction ? ` prediction-${pane.id}` : ''}`}
        placeholder={prediction ? '' : dragging ? 'Solte os arquivos aqui' : pane.role === 'lead' ? 'Escreva para o líder…' : 'Escreva para este agente…'}
        onFocus={(e) => { setFocused(true); syncSelection(e.currentTarget) }}
        onBlur={(e) => { if (!e.currentTarget.closest('form')?.contains(e.relatedTarget as Node)) setFocused(false) }}
        onSelect={(e) => syncSelection(e.currentTarget)}
        onCompositionStart={() => setComposing(true)} onCompositionEnd={(e) => { setComposing(false); syncSelection(e.currentTarget) }}
        onChange={(e) => { setText(e.target.value); dictated.current = e.target.value; syncSelection(e.currentTarget); setDismissed(null) }}
        onPaste={(e) => { const incoming = Array.from(e.clipboardData.files); if (incoming.length) { e.preventDefault(); void addFiles(incoming) } }}
        onKeyDown={(e) => {
          if (prediction && acceptsSuggestionKey({ key: e.key, shiftKey: e.shiftKey, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, isComposing: e.nativeEvent.isComposing }) && e.currentTarget.selectionStart === text.length && e.currentTarget.selectionEnd === text.length) { e.preventDefault(); acceptPrediction(); return }
          if (e.key === 'Escape' && prediction) { e.preventDefault(); setDismissed(text); return }
          if (e.key === 'Escape' && dictation.listening) { e.preventDefault(); dictation.stop() }
          if (e.key === 'Enter' && !e.shiftKey && !composing && !e.nativeEvent.isComposing) { e.preventDefault(); void send() }
        }} />
      </div>
      {prediction && <div className="composer__suggestion" id={`prediction-${pane.id}`} role="status">
        <span><strong>Sugestão do Orbit</strong><span className="sr-only">: {prediction.value}.</span><small>{prediction.reason} Tab insere · Esc dispensa.</small></span>
        <button type="button" className="btn btn--ghost btn--sm" disabled={disabled} onClick={acceptPrediction}>Inserir <kbd>Tab</kbd></button>
        <button type="button" className="icon-btn" aria-label="Dispensar sugestão" onClick={() => { setDismissed(text); localInput.current?.focus() }}><CloseIcon size={14} /></button>
      </div>}
      {receipt && <p className="composer__receipt" role="status" title={`Pedido ${receipt.requestId}${receipt.executionEpoch ? ` · execução ${receipt.executionEpoch}` : ''}`}>Terminal de #{receipt.paneId} confirmou{receipt.acceptedAt ? ` às ${new Date(receipt.acceptedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : ''} · pedido {receipt.requestId.slice(0, 8)}<span> A resposta do agente aparece acima.</span></p>}
      {(pending || sending) && <div><p role="status">Fila: até 32 pedidos / 256 KiB; espera e dispatch de até 5 s cada. Cancelar só remove pedidos ainda não colados.</p><button type="button" className="btn btn--ghost btn--sm" onClick={async()=>{try{const result=await client.cancelQueuedInput(draftKey,pane.id);setPending(client.inputPending(draftKey));setError(result.message)}catch(error){setError(error instanceof Error?error.message:String(error))}}}>Cancelar pedido na fila</button></div>}
      {pending && <p role="status">Confirmação pendente. Rascunho preservado; conferir consulta o mesmo pedido sem reenviar.</p>}
      </div>
      <div className="composer__actions">
        <input className="sr-only" ref={picker} type="file" multiple tabIndex={-1} aria-label="Escolher anexos" onChange={(e) => { void addFiles(Array.from(e.target.files ?? [])); e.target.value = '' }} />
        <button className="icon-btn" type="button" disabled={editingDisabled || pane.cli === 'shell'} aria-label="Anexar imagens ou arquivos" title="Anexar imagens ou arquivos (4 MB por arquivo)" onClick={() => picker.current?.click()}><PlusIcon /></button>
        <button className={`icon-btn mic${dictation.listening ? ' mic--on' : ''}`} type="button" disabled={editingDisabled} aria-pressed={dictation.listening}
          aria-label={dictation.listening ? 'Parar ditado' : 'Ditar mensagem'} title={dictation.mode === 'apple' ? 'Ditado pelo macOS: áudio pode ser processado pela Apple' : 'Ditar mensagem'} onClick={() => {
            if (dictation.listening) return dictation.stop()
            if (!dictationAvailable) return setError('O reconhecimento de voz não está disponível neste ambiente. No macOS, use o atalho de Ditado do sistema no campo de mensagem.')
            acceptingSpeech.current = true; dictated.current = text; dictation.start(); localInput.current?.focus()
          }}><MicIcon /></button>
      {pane.cli !== 'shell' && settings?.agentsInEnglish && <details ref={language} className="composer__language"><summary>Idioma<span className="sr-only"> do envio{translationAccountId ? ' · conta selecionada' : allowOriginal ? ' · original autorizado' : ' · escolha uma conta para traduzir'}</span></summary><div className="field">
        <label htmlFor={`translator-${pane.id}`}>Traduzir prompt para inglês · {TRANSLATION_LABEL}</label>
        <select id={`translator-${pane.id}`} disabled={editingDisabled || allowOriginal} value={translationAccountId} onChange={e => setTranslationAccountId(e.target.value)}>
          <option value="">Escolha a conta Codex</option>
          {accounts.filter(a => a.cli === 'codex' && a.kind === 'assinatura').map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <label><input type="checkbox" disabled={editingDisabled} checked={allowOriginal} onChange={e => setAllowOriginal(e.target.checked)} /> Autorizar envio do original sem tradução</label>
        <p className="note">O texto digitado diretamente no terminal segue no idioma original.</p>
      </div></details>}
        <span className="composer__hint" role="status">{files.length ? `${files.length}/8 anexos` : ''}</span>
        {pane.role === 'lead' && ['claude', 'codex'].includes(pane.cli) && onToggleSuggestions && <button type="button" className="btn btn--ghost btn--sm composer__toggle" aria-pressed={suggestionsOn} title={suggestionsOn ? 'Desativar sugestões no campo e no terminal' : 'Ativar sugestões no campo e no terminal'} onClick={onToggleSuggestions}>Sugestões<span className="sr-only"> {suggestionsOn ? 'ligadas' : 'desligadas'}</span></button>}
        <span className="composer__shortcuts" id={`message-help-${pane.id}`}>Enter envia <span>· Shift+Enter nova linha</span><span className="sr-only">. ⌘J foca a mensagem.</span></span>
        <button className="btn btn--primary composer__send" type="submit" disabled={disabled || (!pending && !text.trim() && !files.length)}><SendIcon size={16} />{sending ? 'Enviando…' : pending ? 'Conferir pedido' : 'Enviar'}</button>
      </div>
      {(error || dictation.error) && <div className="composer__error" role="alert">{error ?? dictation.error}</div>}
    </form>
  )
}
