import { useId, useState } from 'react'
import { WORKSPACE_LIMITS, type Workspace } from '@orbit/protocol'
import { isTauri, useOrbitClient } from '../orbit/context.tsx'
import { pathText } from '../orbit/labels.ts'
import { Dialog } from './Dialog.tsx'
import { CloseIcon, FolderIcon, PlusIcon } from './icons.tsx'

/** Native macOS folder picker in the app; null when cancelled or outside Tauri. */
async function pickFolders(): Promise<string[] | null> {
  if (!isTauri) return null
  const { open } = await import('@tauri-apps/plugin-dialog')
  const picked = await open({ directory: true, multiple: true, title: 'Escolher pastas do workspace' })
  if (!picked) return null
  return Array.isArray(picked) ? picked : [picked]
}

const baseName = (path: string) => path.replace(/\/+$/, '').split('/').pop() || path

/** Ordered folder list: the first is the main one (where agents start). */
function FolderListField({ folders, onChange }: { folders: string[]; onChange: (next: string[]) => void }) {
  const id = useId()
  const [typed, setTyped] = useState('')
  const add = (paths: string[]) => {
    const next = [...folders]
    for (const p of paths.map((s) => s.trim()).filter(Boolean)) if (!next.includes(p)) next.push(p)
    onChange(next.slice(0, WORKSPACE_LIMITS.folders))
  }

  return (
    <fieldset className="field">
      <legend>Pastas <span className="muted">(a primeira é a principal: os agentes começam nela e enxergam todas)</span></legend>
      {folders.length === 0 ? (
        <p className="folder-empty">Nenhuma pasta ainda.</p>
      ) : (
        <ol className="folder-list">
          {folders.map((f, i) => (
            <li key={f} className="folder-row">
              <FolderIcon size={15} />
              <span className="folder-row__text">
                <span className="folder-row__name">{baseName(f)}{i === 0 && <span className="chip chip--main">principal</span>}</span>
                <span className="folder-row__path" title={f}>{pathText(f)}</span>
              </span>
              {i > 0 && (
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => onChange([f, ...folders.filter((x) => x !== f)])}>Tornar principal</button>
              )}
              <button type="button" className="icon-btn" aria-label={`Tirar ${baseName(f)} do workspace`} onClick={() => onChange(folders.filter((x) => x !== f))}><CloseIcon size={14} /></button>
            </li>
          ))}
        </ol>
      )}
      <div className="folder-add">
        {isTauri && (
          <button type="button" className="btn btn--ghost btn--sm" disabled={folders.length >= WORKSPACE_LIMITS.folders}
            onClick={async () => { const picked = await pickFolders(); if (picked) add(picked) }}>
            <FolderIcon size={14} />Escolher pastas…
          </button>
        )}
        <label className="sr-only" htmlFor={`${id}-typed`}>Caminho absoluto de uma pasta</label>
        <input id={`${id}-typed`} className="mono" value={typed} onChange={(e) => setTyped(e.target.value)} spellCheck={false}
          placeholder={isTauri ? 'ou cole um caminho: /Users/voce/projetos/api' : '/Users/voce/projetos/meu-app'}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add([typed]); setTyped('') } }} />
        <button type="button" className="btn btn--ghost btn--sm" disabled={!typed.trim()} onClick={() => { add([typed]); setTyped('') }}><PlusIcon size={14} />Adicionar</button>
      </div>
    </fieldset>
  )
}

/** Create a workspace (one or more folders) or edit one: name, folders and which is the main one. */
export function WorkspaceDialog({ workspace, onClose }: { workspace?: Workspace; onClose: () => void }) {
  const client = useOrbitClient()
  const [name, setName] = useState(workspace?.name ?? '')
  const [folders, setFolders] = useState<string[]>(workspace?.folders ?? [])
  const [instructions, setInstructions] = useState(workspace?.instructions ?? '')
  const [error, setError] = useState<string | null>(null)
  const editing = Boolean(workspace)
  const suggested = folders.length ? `${baseName(folders[0]!)}${folders.length > 1 ? ` + ${folders.length - 1}` : ''}` : 'meu-projeto'

  return (
    <Dialog eyebrow="Workspace" title={editing ? 'Editar workspace' : 'Novo workspace'} submitLabel={editing ? 'Salvar' : 'Criar workspace'} onClose={onClose} onSubmit={() => {
      if (folders.length === 0) return setError('Inclua pelo menos uma pasta.')
      if (folders.some((f) => !f.startsWith('/'))) return setError('Use caminhos absolutos (começando com /).')
      if (workspace) client.send({ type: 'workspace.update', workspaceId: workspace.id, name, folders, instructions })
      else client.send({ type: 'workspace.create', name, folders })
      onClose()
    }}>
      <FolderListField folders={folders} onChange={(next) => { setFolders(next); setError(null) }} />
      <div className="field">
        <label htmlFor="ws-name">Nome <span className="muted">(opcional)</span></label>
        <input id="ws-name" value={name} maxLength={WORKSPACE_LIMITS.name} onChange={(e) => setName(e.target.value)} placeholder={suggested} />
      </div>
      {editing && (
        <div className="field">
          <label htmlFor="ws-instructions">Instruções para os agentes <span className="muted">(opcional)</span></label>
          <textarea id="ws-instructions" rows={6} value={instructions} maxLength={WORKSPACE_LIMITS.instructions} onChange={(e) => setInstructions(e.target.value)}
            placeholder={'Convenções, comandos e cuidados que todo agente deste workspace deve seguir. Ex.:\n- Rode npm test antes de entregar.\n- Não mexa em migrations/.'} />
        </div>
      )}
      {editing && <p className="note">Agentes já abertos continuam com as pastas e instruções que tinham; os próximos recebem estas.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </Dialog>
  )
}
