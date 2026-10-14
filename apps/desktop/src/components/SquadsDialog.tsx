import { useEffect, useId, useRef, useState } from 'react'
import { MODEL_ID, SQUAD_LIMITS, type AgentCliForRole, type Squad, type SquadInput, type SquadRole } from '@orbit/protocol'
import { useOrbit, useOrbitClient } from '../orbit/context.tsx'
import { CLI_LABEL } from '../orbit/labels.ts'
import { ModelInput, SkillsField } from './agentPickers.tsx'
import { CloseIcon, PlusIcon } from './icons.tsx'

const ROLE_CLIS: AgentCliForRole[] = ['claude', 'codex']

const blankRole = (): SquadRole => ({ id: '', name: '', cli: 'claude', model: null, brief: '', skills: [], onlySkills: false })
const blankSquad = (): SquadInput => ({ id: '', name: '', description: '', lead: { cli: 'claude', model: null }, playbook: '', roles: [blankRole()] })
const toInput = ({ builtin: _b, updatedAt: _u, ...squad }: Squad): SquadInput => structuredClone(squad)

function validate(draft: SquadInput): string | null {
  if (!draft.name.trim()) return 'Dê um nome ao squad.'
  if (!draft.playbook.trim()) return 'Escreva o roteiro: os passos que o líder segue.'
  if (draft.roles.length === 0) return 'Inclua pelo menos um papel.'
  for (const [i, r] of draft.roles.entries()) {
    if (!r.name.trim()) return `Dê um nome ao papel ${i + 1}.`
    if (!r.brief.trim()) return `Escreva as instruções de ${r.name || `papel ${i + 1}`}.`
    if (r.model && !MODEL_ID.test(r.model)) return `Modelo inválido em ${r.name}.`
  }
  if (draft.lead.model && !MODEL_ID.test(draft.lead.model)) return 'Modelo inválido no líder.'
  return null
}

/** Squads: browse the builtins, duplicate them, and create or edit your own. */
export function SquadsDialog({ onClose }: { onClose: () => void }) {
  const client = useOrbitClient()
  const { squads } = useOrbit()
  const ref = useRef<HTMLDialogElement>(null)
  const uid = useId()
  const [selectedId, setSelectedId] = useState<string | null>(squads[0]?.id ?? null)
  const [draft, setDraft] = useState<SquadInput | null>(null)
  const [error, setError] = useState<string | null>(null)
  const savingName = useRef<{ name: string; at: number } | null>(null)

  useEffect(() => {
    const dialog = ref.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])

  // After saving a new squad the server assigns its id; follow it once it arrives.
  useEffect(() => {
    const pending = savingName.current
    if (!pending) return
    const saved = squads.find((s) => !s.builtin && s.name === pending.name && s.updatedAt >= pending.at)
    if (saved) {
      savingName.current = null
      setSelectedId(saved.id)
      setDraft(null)
    }
  }, [squads])

  const selected = squads.find((s) => s.id === selectedId) ?? null
  const editing = draft !== null
  const view: SquadInput | null = draft ?? (selected ? toInput(selected) : null)
  const readOnly = !editing

  const patch = (next: Partial<SquadInput>) => draft && setDraft({ ...draft, ...next })
  const patchRole = (index: number, next: Partial<SquadRole>) => draft && setDraft({ ...draft, roles: draft.roles.map((r, i) => (i === index ? { ...r, ...next } : r)) })

  const save = () => {
    if (!draft) return
    const problem = validate(draft)
    if (problem) return setError(problem)
    setError(null)
    savingName.current = { name: draft.name.trim(), at: Date.now() - 1000 }
    client.send({ type: 'squad.save', squad: draft })
  }

  return (
    <dialog ref={ref} className="dialog dialog--wide" aria-labelledby={`${uid}-title`} onCancel={(e) => { e.preventDefault(); onClose() }}>
      <header className="dialog__head">
        <div>
          <div className="eyebrow">Times</div>
          <h2 id={`${uid}-title`}>Squads</h2>
        </div>
        <button type="button" className="icon-btn" aria-label="Fechar" onClick={onClose}><CloseIcon /></button>
      </header>

      <div className="squads">
        <nav className="squads__list" aria-label="Squads">
          <ul className="plain-list">
            {squads.map((s) => (
              <li key={s.id}>
                <button type="button" className="squads__item" aria-current={s.id === selectedId && !(editing && !draft?.id)} onClick={() => { setSelectedId(s.id); setDraft(null); setError(null) }}>
                  <span>{s.name}</span>
                  <span className="muted">{s.builtin ? 'do Orbit' : 'seu'} · {s.roles.length} {s.roles.length === 1 ? 'papel' : 'papéis'}</span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => { setDraft(blankSquad()); setSelectedId(null); setError(null) }}><PlusIcon size={14} />Novo squad</button>
        </nav>

        {view ? (
          <form className="squads__editor" onSubmit={(e) => { e.preventDefault(); save() }}>
            <div className="squads__toolbar">
              {selected?.builtin && !editing && <span className="note">Squad que vem com o Orbit: duplique para mudar.</span>}
              <span className="spacer" />
              {!editing && selected && (
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => setDraft(selected.builtin ? { ...toInput(selected), id: '', name: `${selected.name} (cópia)` } : toInput(selected))}>
                  {selected.builtin ? 'Duplicar e editar' : 'Editar'}
                </button>
              )}
              {!editing && selected && !selected.builtin && (
                <button type="button" className="btn btn--ghost btn--sm btn--danger" onClick={() => {
                  if (confirm(`Apagar o squad "${selected.name}"? Missões em andamento continuam com o roteiro que já receberam.`)) {
                    client.send({ type: 'squad.delete', squadId: selected.id })
                    setSelectedId(null)
                  }
                }}>Apagar</button>
              )}
              {editing && <button type="button" className="btn btn--ghost btn--sm" onClick={() => { setDraft(null); setError(null) }}>Descartar</button>}
              {editing && <button type="submit" className="btn btn--primary btn--sm">Salvar squad</button>}
            </div>

            <div className="squads__grid">
              <div className="field">
                <label htmlFor={`${uid}-name`}>Nome</label>
                <input id={`${uid}-name`} value={view.name} maxLength={SQUAD_LIMITS.name} onChange={(e) => patch({ name: e.target.value })} disabled={readOnly} />
              </div>
              <div className="field">
                <label htmlFor={`${uid}-desc`}>Descrição <span className="muted">(opcional)</span></label>
                <input id={`${uid}-desc`} value={view.description} maxLength={SQUAD_LIMITS.description} onChange={(e) => patch({ description: e.target.value })} disabled={readOnly} />
              </div>
            </div>

            <fieldset className="field squads__lead">
              <legend>Líder</legend>
              <div className="squads__row">
                <div className="segmented" role="group" aria-label="Agente do líder">
                  {ROLE_CLIS.map((cli) => <button key={cli} type="button" aria-pressed={view.lead.cli === cli} disabled={readOnly} onClick={() => patch({ lead: { cli, model: null } })}>{CLI_LABEL[cli]}</button>)}
                </div>
                <label className="sr-only" htmlFor={`${uid}-lead-model`}>Modelo do líder</label>
                <ModelInput id={`${uid}-lead-model`} cli={view.lead.cli} value={view.lead.model} onChange={(model) => patch({ lead: { ...view.lead, model } })} disabled={readOnly} />
              </div>
            </fieldset>

            <div className="field">
              <label htmlFor={`${uid}-playbook`}>Roteiro <span className="muted">(os passos que o líder segue; cite os papéis pelo nome)</span></label>
              <textarea id={`${uid}-playbook`} rows={6} value={view.playbook} maxLength={SQUAD_LIMITS.playbook} onChange={(e) => patch({ playbook: e.target.value })} disabled={readOnly} placeholder={'1. Abra o Batedor com o relato do bug.\n2. Com a causa, abra o Construtor.\n3. …'} />
            </div>

            <fieldset className="field">
              <legend>Papéis</legend>
              <ol className="roles">
                {view.roles.map((r, i) => (
                  <li key={i} className="role-card">
                    <div className="squads__row">
                      <label className="sr-only" htmlFor={`${uid}-r${i}-name`}>Nome do papel {i + 1}</label>
                      <input id={`${uid}-r${i}-name`} className="role-card__name" value={r.name} maxLength={40} placeholder="Revisor" onChange={(e) => patchRole(i, { name: e.target.value })} disabled={readOnly} />
                      <div className="segmented" role="group" aria-label={`Agente de ${r.name || `papel ${i + 1}`}`}>
                        {ROLE_CLIS.map((cli) => <button key={cli} type="button" aria-pressed={r.cli === cli} disabled={readOnly} onClick={() => patchRole(i, { cli, model: null })}>{CLI_LABEL[cli]}</button>)}
                      </div>
                      <label className="sr-only" htmlFor={`${uid}-r${i}-model`}>Modelo de {r.name || `papel ${i + 1}`}</label>
                      <ModelInput id={`${uid}-r${i}-model`} cli={r.cli} value={r.model} onChange={(model) => patchRole(i, { model })} disabled={readOnly} />
                      {editing && view.roles.length > 1 && (
                        <button type="button" className="icon-btn" aria-label={`Remover ${r.name || `papel ${i + 1}`}`} onClick={() => draft && setDraft({ ...draft, roles: draft.roles.filter((_, j) => j !== i) })}><CloseIcon size={14} /></button>
                      )}
                    </div>
                    <label className="sr-only" htmlFor={`${uid}-r${i}-brief`}>Instruções de {r.name || `papel ${i + 1}`}</label>
                    <textarea id={`${uid}-r${i}-brief`} rows={3} value={r.brief} maxLength={SQUAD_LIMITS.brief} placeholder="O que este papel faz, o que não faz e o que entrega." onChange={(e) => patchRole(i, { brief: e.target.value })} disabled={readOnly} />
                    <div className="role-card__skills">
                      <span className="muted">Skills</span>
                      <SkillsField id={`${uid}-r${i}-skills`} cli={r.cli} skills={r.skills} only={r.onlySkills} label={`Skills de ${r.name || `papel ${i + 1}`}`} disabled={readOnly}
                        onChange={(skills, onlySkills) => patchRole(i, { skills, onlySkills })} />
                    </div>
                  </li>
                ))}
              </ol>
              {editing && view.roles.length < SQUAD_LIMITS.roles && (
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => draft && setDraft({ ...draft, roles: [...draft.roles, blankRole()] })}><PlusIcon size={14} />Papel</button>
              )}
            </fieldset>
            {error && <p className="form-error" role="alert">{error}</p>}
          </form>
        ) : (
          <div className="empty">Escolha um squad ou crie um novo.</div>
        )}
      </div>
    </dialog>
  )
}
