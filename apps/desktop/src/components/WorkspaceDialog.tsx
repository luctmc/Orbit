import { useId, useState } from 'react'
import { WORKSPACE_LIMITS, type Workspace } from '@orbit/protocol'
import { isTauri, useOrbit, useOrbitClient } from '../orbit/context.tsx'
import { pathText } from '../orbit/labels.ts'
import { Dialog } from './Dialog.tsx'
import { MemoryPanel } from './MemoryPanel.tsx'
import { DeleteWorkspaceDialog } from './deletions.tsx'
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
  const [pickError, setPickError] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const add = (paths: string[]) => {
    const next = [...folders]
    for (const p of paths.map((s) => s.trim()).filter(Boolean)) if (!next.includes(p)) next.push(p)
    onChange(next.slice(0, WORKSPACE_LIMITS.folders))
  }

  return (
    <fieldset className="field">
      <legend>01 <strong>Escolha as pastas do projeto</strong></legend>
      <p className="note">A pasta principal é o ponto de partida dos agentes. Você pode reunir até {WORKSPACE_LIMITS.folders} pastas no mesmo workspace.</p>
      {folders.length === 0 ? (
        <div className="folder-empty"><FolderIcon size={28} /><strong>Onde vamos trabalhar?</strong><span>Selecione uma pasta existente ou cole o caminho abaixo.</span></div>
      ) : (
        <ol className="folder-list">
          {folders.map((f, i) => (
            <li key={f} className="folder-row">
              <FolderIcon size={15} />
              <span className="folder-row__text">
                <span className="folder-row__name"><span className="folder-row__label" title={baseName(f)}>{baseName(f)}</span>{i === 0 && <span className="chip chip--main">principal</span>}</span>
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
          <button type="button" className="btn btn--ghost btn--sm" disabled={picking || folders.length >= WORKSPACE_LIMITS.folders}
            onClick={async () => { setPicking(true); setPickError(null); try { const picked = await pickFolders(); if (picked) add(picked) } catch { setPickError('Não foi possível abrir o seletor. Você pode colar o caminho abaixo.') } finally { setPicking(false) } }}>
            <FolderIcon size={14} />{picking ? 'Abrindo…' : 'Escolher no Mac…'}
          </button>
        )}
        <label className="sr-only" htmlFor={`${id}-typed`}>Caminho absoluto de uma pasta</label>
        <input id={`${id}-typed`} className="mono" value={typed} onChange={(e) => setTyped(e.target.value)} spellCheck={false}
          placeholder={isTauri ? 'Ou cole o caminho da pasta' : '/Users/USER/projects/my-app'}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add([typed]); setTyped('') } }} />
        <button type="button" className="btn btn--ghost btn--sm" disabled={!typed.trim() || folders.length >= WORKSPACE_LIMITS.folders} onClick={() => { add([typed]); setTyped('') }}><PlusIcon size={14} />Adicionar</button>
      </div>
      {pickError && <p className="form-error" role="alert">{pickError}</p>}
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
  const [deleting, setDeleting] = useState(false)
  const [saving, setSaving] = useState(false)
  const { missions, connection } = useOrbit()
  const editing = Boolean(workspace)
  const suggested = folders.length ? `${baseName(folders[0]!)}${folders.length > 1 ? ` + ${folders.length - 1}` : ''}` : 'meu-projeto'

  return (
    <>
    <Dialog busy={saving} eyebrow="Seu projeto no Orbit" title={editing ? 'Editar workspace' : 'Novo workspace'} submitLabel={saving ? 'Salvando…' : editing ? 'Salvar alterações' : 'Criar workspace'} submitDisabled={saving || connection !== 'open'} onClose={() => { if (!saving) onClose() }} onSubmit={() => {
      if (saving || connection !== 'open') return
      if (folders.length === 0) return setError('Inclua pelo menos uma pasta.')
      if (folders.some((f) => !f.startsWith('/'))) return setError('Use caminhos absolutos (começando com /).')
      const requestId = crypto.randomUUID()
      setSaving(true); setError(null)
      void client.ask(workspace ? { type: 'workspace.update', workspaceId: workspace.id, name, folders, instructions, requestId } : { type: 'workspace.create', name, folders, requestId }, 'workspace.saved', message => message.requestId === requestId)
        .then(onClose, cause => { setSaving(false); setError(cause instanceof Error ? cause.message : String(cause)) })
    }}>
      {!editing && <div className="workspace-intro"><p>Um espaço para seu projeto e para a equipe que vai construí-lo.</p><span>As pastas continuam no seu Mac. As missões e o contexto ficam organizados no Orbit.</span></div>}
      <FolderListField folders={folders} onChange={(next) => { setFolders(next); setError(null) }} />
      <div className="field">
        <label htmlFor="ws-name">02 <strong>Dê um nome ao workspace</strong> <span className="muted">(opcional)</span></label>
        <input id="ws-name" value={name} maxLength={WORKSPACE_LIMITS.name} onChange={(e) => setName(e.target.value)} placeholder={suggested} />
        <p className="note">Sem nome? Usaremos o nome da pasta principal.</p>
      </div>
      {editing && (
        <div className="field">
          <label htmlFor="ws-instructions">Instruções para os agentes <span className="muted">(opcional)</span></label>
          <textarea id="ws-instructions" rows={6} value={instructions} maxLength={WORKSPACE_LIMITS.instructions} onChange={(e) => setInstructions(e.target.value)}
            placeholder={'Convenções, comandos e cuidados que todo agente deste workspace deve seguir. Ex.:\n- Rode npm test antes de entregar.\n- Não mexa em migrations/.'} />
        </div>
      )}
      {editing && <p className="note">Agentes já abertos continuam com as pastas e instruções que tinham; os próximos recebem estas.</p>}
      {workspace && <MemoryPanel workspaceId={workspace.id} />}
      {workspace && (
        <div className="workspace__danger">
          <button type="button" className="btn btn--ghost btn--sm btn--danger" onClick={() => setDeleting(true)}>Apagar workspace…</button>
          <span className="muted">Tira do Orbit as missões, a memória, os modelos e os agendamentos dele. As pastas no seu Mac ficam.</span>
        </div>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
    </Dialog>
    {/* Sibling dialogs keep independent form owners in WebKit. A nested form navigates
        the page instead of dispatching the deletion, leaving the workspace in Orbit. */}
    {workspace && deleting && <DeleteWorkspaceDialog workspace={workspace} missions={missions.filter((m) => m.workspaceId === workspace.id).length} onClose={() => setDeleting(false)} onDeleted={onClose} />}
    </>
  )
}
