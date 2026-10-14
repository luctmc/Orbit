import { useEffect, useId, useRef, useState } from 'react'
import { MODEL_ID, ROUTING_LIMITS, type AgentCliForRole, type Routing, type TaskType } from '@orbit/protocol'
import { useOrbit, useOrbitClient } from '../orbit/context.tsx'
import { CLI_LABEL } from '../orbit/labels.ts'
import { EffortCycle, ModelInput, SkillsField } from './agentPickers.tsx'
import { AccountsPanel } from './AccountsPanel.tsx'
import { ClisPanel } from './ClisPanel.tsx'
import { SkillsPanel } from './SkillsPanel.tsx'
import { CloseIcon, PlusIcon } from './icons.tsx'

const CLIS: AgentCliForRole[] = ['claude', 'codex']

const blankRow = (): TaskType => ({ id: '', name: '', description: '', cli: 'claude', model: null, effort: 'medium', skills: [], onlySkills: false })

function validate(draft: Routing): string | null {
  if (draft.taskTypes.length === 0) return 'Inclua pelo menos um tipo de tarefa.'
  if (draft.lead.model && !MODEL_ID.test(draft.lead.model)) return 'Modelo inválido no líder.'
  for (const [i, t] of draft.taskTypes.entries()) {
    if (!t.name.trim()) return `Dê um nome ao tipo ${i + 1}.`
    if (t.model && !MODEL_ID.test(t.model)) return `Modelo inválido em ${t.name}.`
    if (t.skills.length > ROUTING_LIMITS.skills) return `No máximo ${ROUTING_LIMITS.skills} skills em ${t.name}.`
  }
  return null
}

function CliToggle({ value, onChange, label }: { value: AgentCliForRole; onChange: (cli: AgentCliForRole) => void; label: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {CLIS.map((cli) => <button key={cli} type="button" aria-pressed={value === cli} onClick={() => onChange(cli)}>{CLI_LABEL[cli]}</button>)}
    </div>
  )
}

/** Settings › "Quem faz cada tarefa": the table an agentic lead uses to staff its helpers. */
type SettingsTab = 'routing' | 'skills' | 'contas' | 'clis'
const TAB_TITLE: Record<SettingsTab, string> = { routing: 'Quem faz cada tarefa', skills: 'Skills e MCP', contas: 'Contas', clis: 'Agentes e CLIs' }

export function RoutingDialog({ onClose, initialTab = 'routing' }: { onClose: () => void; initialTab?: SettingsTab }) {
  const [tab, setTab] = useState<SettingsTab>(initialTab)
  const client = useOrbitClient()
  const { routing } = useOrbit()
  const ref = useRef<HTMLDialogElement>(null)
  const uid = useId()
  const [draft, setDraft] = useState<Routing | null>(() => (routing ? structuredClone(routing) : null))
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    const dialog = ref.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])

  // Follow the server's table until the user starts editing (a save or reset arrives here too).
  useEffect(() => {
    if (routing && !dirty) setDraft(structuredClone(routing))
  }, [routing, dirty])

  const edit = (next: Routing) => {
    setDraft(next)
    setDirty(true)
    setSaved(false)
  }
  const patchRow = (index: number, patch: Partial<TaskType>) => draft && edit({ ...draft, taskTypes: draft.taskTypes.map((t, i) => (i === index ? { ...t, ...patch } : t)) })

  const save = () => {
    if (!draft) return
    const problem = validate(draft)
    if (problem) return setError(problem)
    setError(null)
    client.send({ type: 'routing.save', routing: draft })
    setDirty(false)
    setSaved(true)
  }

  return (
    <dialog ref={ref} className="dialog dialog--wide" aria-labelledby={`${uid}-title`} onCancel={(e) => { e.preventDefault(); onClose() }}>
      <header className="dialog__head">
        <div>
          <div className="eyebrow">Ajustes</div>
          <h2 id={`${uid}-title`}>{TAB_TITLE[tab]}</h2>
        </div>
        <div className="segmented settings-tabs" role="group" aria-label="Seção dos ajustes">
          <button type="button" aria-pressed={tab === 'routing'} onClick={() => setTab('routing')}>Quem faz cada tarefa</button>
          <button type="button" aria-pressed={tab === 'skills'} onClick={() => setTab('skills')}>Skills e MCP</button>
          <button type="button" aria-pressed={tab === 'contas'} onClick={() => setTab('contas')}>Contas</button>
          <button type="button" aria-pressed={tab === 'clis'} onClick={() => setTab('clis')}>Agentes e CLIs</button>
        </div>
        <button type="button" className="icon-btn" aria-label="Fechar" onClick={onClose}><CloseIcon /></button>
      </header>

      {tab === 'clis' ? (
        <ClisPanel />
      ) : tab === 'contas' ? (
        <AccountsPanel />
      ) : tab === 'skills' ? (
        <SkillsPanel />
      ) : !draft ? (
        <div className="dialog__body"><p className="muted">Carregando a tabela…</p></div>
      ) : (
        <form className="dialog__body routing" onSubmit={(e) => { e.preventDefault(); save() }}>
          <p className="muted routing__intro">
            Na missão agêntica o líder classifica cada atividade num destes tipos e o Orbit abre o ajudante com o agente, o modelo e o esforço da linha. Pedidos explícitos do líder (agente ou modelo) vencem a tabela.
          </p>

          <fieldset className="routing__lead">
            <legend>Líder padrão das missões agênticas</legend>
            <div className="squads__row">
              <CliToggle label="Agente do líder" value={draft.lead.cli} onChange={(cli) => edit({ ...draft, lead: { ...draft.lead, cli, model: null } })} />
              <ModelInput id={`${uid}-lead`} className="routing__model" label="Modelo do líder" cli={draft.lead.cli} value={draft.lead.model} onChange={(model) => edit({ ...draft, lead: { ...draft.lead, model } })} />
              <EffortCycle label="Líder" cli={draft.lead.cli} model={draft.lead.model} value={draft.lead.effort} onChange={(effort) => edit({ ...draft, lead: { ...draft.lead, effort } })} />
            </div>
          </fieldset>

          <div className="routing__table-wrap">
            <table className="routing__table">
              <thead>
                <tr>
                  <th scope="col">Tipo de tarefa</th>
                  <th scope="col">Agente</th>
                  <th scope="col">Modelo</th>
                  <th scope="col">Esforço</th>
                  <th scope="col">Skills</th>
                  <th scope="col"><span className="sr-only">Remover</span></th>
                </tr>
              </thead>
              <tbody>
                {draft.taskTypes.map((t, i) => (
                  <tr key={i}>
                    <td className="routing__type">
                      <label className="sr-only" htmlFor={`${uid}-n${i}`}>Nome do tipo {i + 1}</label>
                      <input id={`${uid}-n${i}`} className="routing__name" value={t.name} maxLength={ROUTING_LIMITS.name} placeholder="Revisão de PR" onChange={(e) => patchRow(i, { name: e.target.value })} />
                      <label className="sr-only" htmlFor={`${uid}-d${i}`}>Quando usar {t.name}</label>
                      <input id={`${uid}-d${i}`} className="routing__desc" value={t.description} maxLength={ROUTING_LIMITS.description} placeholder="Quando este tipo se aplica" onChange={(e) => patchRow(i, { description: e.target.value })} />
                    </td>
                    <td><CliToggle label={`Agente de ${t.name || `tipo ${i + 1}`}`} value={t.cli} onChange={(cli) => patchRow(i, { cli, model: null })} /></td>
                    <td><ModelInput id={`${uid}-m${i}`} className="routing__model" label={`Modelo de ${t.name || `tipo ${i + 1}`}`} cli={t.cli} value={t.model} onChange={(model) => patchRow(i, { model })} /></td>
                    <td><EffortCycle label={t.name || `Tipo ${i + 1}`} cli={t.cli} model={t.model} value={t.effort} onChange={(effort) => patchRow(i, { effort })} /></td>
                    <td>
                      <SkillsField id={`${uid}-s${i}`} cli={t.cli} skills={t.skills} only={t.onlySkills} label={`Skills de ${t.name || `tipo ${i + 1}`}`}
                        onChange={(skills, onlySkills) => patchRow(i, { skills, onlySkills })} />
                    </td>
                    <td>
                      {draft.taskTypes.length > 1 && (
                        <button type="button" className="icon-btn" aria-label={`Remover ${t.name || `tipo ${i + 1}`}`} onClick={() => edit({ ...draft, taskTypes: draft.taskTypes.filter((_, j) => j !== i) })}><CloseIcon size={14} /></button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="routing__footer">
            {draft.taskTypes.length < ROUTING_LIMITS.taskTypes && (
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => edit({ ...draft, taskTypes: [...draft.taskTypes, blankRow()] })}><PlusIcon size={14} />Novo tipo</button>
            )}
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => {
              if (confirm('Voltar para a tabela que vem com o Orbit? Suas mudanças nela se perdem.')) {
                client.send({ type: 'routing.reset' })
                setDirty(false)
                setSaved(false)
              }
            }}>Restaurar padrão</button>
            <span className="spacer" />
            {error && <span className="form-error" role="alert">{error}</span>}
            {saved && !dirty && <span className="muted" role="status">Salvo. Vale para os próximos ajudantes.</span>}
            <button type="submit" className="btn btn--primary btn--sm" disabled={!dirty}>Salvar tabela</button>
          </div>
        </form>
      )}
    </dialog>
  )
}
