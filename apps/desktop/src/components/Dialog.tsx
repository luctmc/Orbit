import { useEffect, useRef, type FormEvent, type ReactNode } from 'react'
import { CloseIcon } from './icons.tsx'

/** Native modal <dialog>: focus trap, Esc and backdrop come from the platform. */
export function Dialog({ title, eyebrow, onClose, onSubmit, submitLabel, children, danger = false, submitDisabled = false }: {
  title: string
  eyebrow?: string
  onClose: () => void
  onSubmit: () => void
  submitLabel: string
  children: ReactNode
  /** The action cannot be undone: the button says so in color. */
  danger?: boolean
  submitDisabled?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    onSubmit()
  }

  return (
    <dialog ref={ref} className="dialog" aria-labelledby="dialog-title" onCancel={(e) => { e.preventDefault(); onClose() }}>
      <form onSubmit={submit}>
        <header className="dialog__head">
          <div>
            {eyebrow && <div className="eyebrow">{eyebrow}</div>}
            <h2 id="dialog-title">{title}</h2>
          </div>
          <button type="button" className="icon-btn" aria-label="Fechar" onClick={onClose}><CloseIcon /></button>
        </header>
        <div className="dialog__body">{children}</div>
        <footer className="dialog__foot">
          <button type="button" className="btn btn--ghost" onClick={onClose}>Cancelar</button>
          <button type="submit" className={danger ? 'btn btn--danger-solid' : 'btn btn--primary'} disabled={submitDisabled}>{submitLabel}</button>
        </footer>
      </form>
    </dialog>
  )
}
