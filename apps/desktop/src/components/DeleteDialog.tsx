import { useState } from 'react'
import { Dialog } from './Dialog.tsx'

export interface DeleteOption {
  key: string
  label: string
  hint?: string
  initial: boolean
}

/**
 * Asks before deleting for good: what goes, what stays, the choices that reach outside Orbit and,
 * for the biggest deletions, the name typed back.
 */
export function DeleteDialog({ eyebrow, title, gone, kept, options = [], confirmName, onConfirm, onClose }: {
  eyebrow: string
  title: string
  gone: string[]
  kept: string[]
  options?: DeleteOption[]
  /** The person types this to confirm (workspaces). */
  confirmName?: string
  onConfirm: (choices: Record<string, boolean>) => void
  onClose: () => void
}) {
  const [choices, setChoices] = useState<Record<string, boolean>>(() => Object.fromEntries(options.map((o) => [o.key, o.initial])))
  const [typed, setTyped] = useState('')
  const ready = !confirmName || typed.trim() === confirmName.trim()
  return (
    <Dialog eyebrow={eyebrow} title={title} submitLabel="Apagar para sempre" danger submitDisabled={!ready} onClose={onClose} onSubmit={() => {
      if (!ready) return
      onConfirm(choices)
      onClose()
    }}>
      <p className="delete__warn">Não dá para desfazer</p>
      <div className="delete__lists">
        <div>
          <div className="eyebrow">Sai do Orbit</div>
          <ul>{gone.map((g) => <li key={g}>{g}</li>)}</ul>
        </div>
        <div>
          <div className="eyebrow">Fica</div>
          <ul>{kept.map((k) => <li key={k}>{k}</li>)}</ul>
        </div>
      </div>
      {options.map((o) => (
        <label key={o.key} className="check">
          <input type="checkbox" checked={choices[o.key] ?? false} onChange={(e) => setChoices({ ...choices, [o.key]: e.target.checked })} />
          <span><strong>{o.label}</strong>{o.hint && <span className="muted"> {o.hint}</span>}</span>
        </label>
      ))}
      {confirmName && (
        <div className="field">
          <label htmlFor="delete-confirm">Digite <strong>{confirmName}</strong> para confirmar</label>
          <input id="delete-confirm" value={typed} autoComplete="off" spellCheck={false} onChange={(e) => setTyped(e.target.value)} autoFocus />
        </div>
      )}
    </Dialog>
  )
}
