import { useEffect, useId, useRef, useState } from 'react'
import { AGENT_CLIS, MODEL_ID, ROUTING_LIMITS, type AgentCliForRole, type AgentSeat, type Routing, type TaskType } from '@orbit/protocol'
import { useOrbit, useOrbitClient } from '../orbit/context.tsx'
import { CLI_LABEL, EFFORT_LABEL, suggestedTaskSeat } from '../orbit/labels.ts'
import { CliSelect, EffortCycle, ModelSelect, SkillsField } from './agentPickers.tsx'
import { AccountsPanel } from './AccountsPanel.tsx'
import { ClisPanel } from './ClisPanel.tsx'
import { SkillsPanel } from './SkillsPanel.tsx'
import { NoticesPanel } from './NoticesPanel.tsx'
import { UsagePanel } from './UsagePanel.tsx'
import { CloseIcon, PlusIcon } from './icons.tsx'


const blankRow = (): TaskType => ({ id: '', name: '', description: '', cli: 'claude', model: null, effort: 'medium', skills: [], onlySkills: false, method: '', readOnly: false, alt: null, automatic: false })

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


/** Settings › "Quem faz cada tarefa": the table an agentic lead uses to staff its helpers. */
type SettingsTab = 'routing' | 'skills' | 'contas' | 'uso' | 'avisos' | 'clis'
const TAB_TITLE: Record<SettingsTab, string> = { routing: 'Quem faz cada tarefa', skills: 'Skills e MCP', contas: 'Contas', uso: 'Uso', avisos: 'Avisos', clis: 'Agentes e CLIs' }

export function RoutingDialog({ onClose, initialTab = 'routing' }: { onClose: () => void; initialTab?: SettingsTab }) {
  const [tab, setTab] = useState<SettingsTab>(initialTab)
  const client = useOrbitClient()
  const { routing, catalog } = useOrbit()
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
    <dialog ref={ref} className="dialog dialog--wide settings" aria-labelledby={`${uid}-title`} onCancel={(e) => { e.preventDefault(); onClose() }}>
      <header className="settings__head">
        <div><span className="eyebrow">Seu ambiente de trabalho</span><h2 id={`${uid}-title`}>Configurações</h2></div>
        <button type="button" className="icon-btn" aria-label="Fechar configurações" onClick={onClose}><CloseIcon /></button>
      </header>
      <div className="settings__layout">
        <nav className="settings__nav" aria-label="Seções das configurações">
          <span className="eyebrow">Missão agêntica</span>
          <button type="button" aria-current={tab === 'routing' ? 'page' : undefined} onClick={() => setTab('routing')}>Quem faz cada tarefa<span>Modelos, esforço e regras</span></button>
          <span className="eyebrow">Ambiente</span>
          <button type="button" aria-current={tab === 'contas' ? 'page' : undefined} onClick={() => setTab('contas')}>Contas<span>Provedores e autenticação</span></button>
          <button type="button" aria-current={tab === 'clis' ? 'page' : undefined} onClick={() => setTab('clis')}>Agentes e CLIs</button>
          <button type="button" aria-current={tab === 'skills' ? 'page' : undefined} onClick={() => setTab('skills')}>Skills e MCP</button>
          <span className="eyebrow">Acompanhamento</span>
          <button type="button" aria-current={tab === 'uso' ? 'page' : undefined} onClick={() => setTab('uso')}>Uso</button>
          <button type="button" aria-current={tab === 'avisos' ? 'page' : undefined} onClick={() => setTab('avisos')}>Avisos</button>
        </nav>
        <section className="settings__content" aria-labelledby={`${uid}-section`}>
          <div className="settings__section-head"><span className="eyebrow">{tab === 'routing' ? 'Missão agêntica' : 'Ambiente'}</span><h3 id={`${uid}-section`}>{TAB_TITLE[tab]}</h3></div>

      {tab === 'clis' ? (
        <ClisPanel />
      ) : tab === 'contas' ? (
        <AccountsPanel />
      ) : tab === 'skills' ? (
        <SkillsPanel />
      ) : tab === 'uso' ? (
        <UsagePanel />
      ) : tab === 'avisos' ? (
        <NoticesPanel />
      ) : !draft ? (
        <div className="dialog__body"><p className="muted">Carregando a tabela…</p></div>
      ) : (
        <form className="dialog__body routing" onSubmit={(e) => { e.preventDefault(); save() }}>
          <p className="muted routing__intro">
            No automático, o Orbit escolhe CLI, modelo e conta pela tarefa e pela quota válida. Codex pode implementar código com líder Codex. Suas escolhas explícitas são preservadas; quota desconhecida não conta como saldo.
          </p>

          <fieldset className="routing__lead">
            <legend>Líder padrão das missões agênticas</legend>
            <div className="squads__row">
              <CliSelect id={`${uid}-lead-cli`} label="Agente do líder" value={draft.lead.cli} onChange={(cli) => edit({ ...draft, lead: suggestedTaskSeat(catalog, cli, 'lead') })} />
              <ModelSelect id={`${uid}-lead`} className="routing__model" label="Modelo do líder" compact cli={draft.lead.cli} value={draft.lead.model} onChange={(model) => edit({ ...draft, lead: { ...draft.lead, model } })} />
              <EffortCycle label="Líder" cli={draft.lead.cli} model={draft.lead.model} value={draft.lead.effort} onChange={(effort) => edit({ ...draft, lead: { ...draft.lead, effort } })} />
            </div>
          </fieldset>

          <details className="routing__policy"><summary>Regras de frontend, visual, motion e skills</summary>
          <p className="muted">Frontend e visual: Opus 5.5 ou GPT 6.1 Sol, esforço médio/alto. Motion: Opus 5.5 alto. As regras automáticas usam os IDs do catálogo local. Em Contas, habilite cada login separadamente — duas contas Codex dividem a mesma CLI, com quotas independentes.</p>
          <p className="muted">Skills de design são escolhidas por tarefa e stack entre as instaladas e entregues como conteúdo ao agente. O design system e as instruções do projeto têm prioridade. Skills ausentes são informadas; nada é instalado automaticamente.</p>
          </details>
          <Proposals />
          <details className="routing__policy"><summary>Preferências de execução e ferramentas</summary><ResumeOnStart /></details>

          <div className="routing__table-wrap" tabIndex={0} role="region" aria-label="Tabela de tarefas, role horizontalmente para ver todas as colunas">
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
                      <label className="check"><input type="checkbox" checked={t.automatic === true} onChange={e => patchRow(i, { automatic: e.target.checked })} /><span>Automático por quota e tarefa</span></label>
                      <details className="routing__method">
                        <summary>{t.method ? 'Como fazer' : 'Como fazer (vazio)'}{t.readOnly ? ' · só leitura' : ''}{t.alt ? ` · equivalente: ${CLI_LABEL[t.alt.cli]} · ${t.alt.model ?? 'padrão escolhido'} · ${t.alt.effort ? EFFORT_LABEL[t.alt.effort] : 'esforço padrão'}` : ''}</summary>
                        <label className="sr-only" htmlFor={`${uid}-h${i}`}>Como fazer {t.name}</label>
                        <textarea id={`${uid}-h${i}`} rows={5} value={t.method} maxLength={ROUTING_LIMITS.method} placeholder="Passos que o ajudante segue neste tipo de tarefa (vale para Claude e Codex)" onChange={(e) => patchRow(i, { method: e.target.value })} />
                        <label className="check">
                          <input type="checkbox" checked={t.readOnly} onChange={(e) => patchRow(i, { readOnly: e.target.checked })} />
                          <span>Só leitura: o ajudante não edita arquivos</span>
                        </label>
                        <AltSeat id={`${uid}-alt${i}`} kind={t.id} name={t.name || `tipo ${i + 1}`} cli={t.cli} value={t.alt} onChange={(alt) => patchRow(i, { alt })} />
                      </details>
                    </td>
                    <td><CliSelect id={`${uid}-c${i}`} label={`Agente de ${t.name || `tipo ${i + 1}`}`} value={t.cli} onChange={(cli) => patchRow(i, { ...suggestedTaskSeat(catalog, cli, t.id), automatic: false })} /></td>
                    <td><ModelSelect id={`${uid}-m${i}`} className="routing__model" compact label={`Modelo de ${t.name || `tipo ${i + 1}`}`} cli={t.cli} value={t.model} onChange={(model) => patchRow(i, { model, automatic: false })} /><p className="note">{t.automatic ? (['operacao', 'documentacao'].includes(t.id) ? 'Base econômica; ajusta pela dificuldade e quota.' : 'Base para código/análise; simples reduz custo, difícil sobe até alto.') : 'Escolha fixa; o automático não substitui este assento.'}</p></td>
                    <td><EffortCycle label={t.name || `Tipo ${i + 1}`} cli={t.cli} model={t.model} value={t.effort} onChange={(effort) => patchRow(i, { effort, automatic: false })} /></td>
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
        </section>
      </div>
    </dialog>
  )
}

/** Saved on its own, apart from the table: how the maestro works between missions. */
function ResumeOnStart() {
  const client = useOrbitClient()
  const { settings } = useOrbit()
  if (!settings) return null
  const save = (patch: Partial<typeof settings>) => client.send({ type: 'settings.save', settings: { ...settings, ...patch } })
  return (
    <div className="routing__options">
      <label className="check">
        <input type="checkbox" checked={(settings.agentToolProfile ?? 'orbit') === 'orbit'} onChange={(e) => save({ agentToolProfile: e.target.checked ? 'orbit' : 'inherit' })} />
        <span>Claude e Codex carregam só as ferramentas do Orbit, além das ferramentas nativas de código. Desmarque para incluir todas as integrações configuradas. Vale na próxima abertura ou retomada; uma conversa nova evita carregar o contexto antigo.</span>
      </label>
      <label className="check">
        <input type="checkbox" checked={settings.smartClassify} onChange={(e) => save({ smartClassify: e.target.checked })} />
        <span>Quando nenhuma palavra diz o tipo da atividade, o Claude Haiku decide pela tabela (alguns segundos e uma fração de centavo; sem ele, vale o tipo padrão)</span>
      </label>
      <label className="check">
        <input type="checkbox" checked={settings.agentsInEnglish} onChange={(e) => save({ agentsInEnglish: e.target.checked })} />
        <span>Agentes trabalham em inglês entre si (tarefas, mensagens, entregas) e falam com você em português: gasta menos tokens e costuma render mais</span>
      </label>
      <label className="check">
        <input type="checkbox" checked={settings.resumeOnStart} onChange={(e) => save({ resumeOnStart: e.target.checked })} />
        <span>Ao abrir o Orbit, retomar os agentes das missões em andamento na mesma conversa (quem estava devendo uma entrega recebe um aviso para continuar)</span>
      </label>
    </div>
  )
}

/** Leads' suggestions for the table, waiting for the person. */
function Proposals() {
  const client = useOrbitClient()
  const { proposals, routing, missions } = useOrbit()
  const pending = proposals.filter((p) => p.status === 'pendente')
  if (pending.length === 0) return null
  const what = (p: (typeof pending)[number]) => {
    const row = routing?.taskTypes.find((t) => t.id === p.kind)
    const c = p.change
    return [
      c.cli && `agente → ${CLI_LABEL[c.cli]}`,
      'model' in c && `modelo → ${c.model ?? 'padrão'}`,
      'effort' in c && `esforço → ${c.effort ?? 'padrão'}`,
      c.readOnly !== undefined && (c.readOnly ? 'só leitura' : 'pode editar'),
      c.method !== undefined && 'novo "como fazer"',
    ].filter(Boolean).join(', ') + ` em ${row?.name ?? p.kind}`
  }
  return (
    <section className="proposals" aria-label="Propostas dos líderes">
      <div className="eyebrow">Propostas dos líderes</div>
      <ul>
        {pending.map((p) => (
          <li key={p.id} className="proposal">
            <div className="proposal__text">
              <strong>{what(p)}</strong>
              <span className="muted">#{p.paneId}, missão {missions.find((m) => m.id === p.missionId)?.title ?? '?'}: {p.reason}</span>
              {p.change.method !== undefined && <span className="muted">Como fazer proposto: {p.change.method}</span>}
            </div>
            <button type="button" className="btn btn--primary btn--sm" onClick={() => client.send({ type: 'proposal.decide', proposalId: p.id, accept: true })}>Aceitar</button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => client.send({ type: 'proposal.decide', proposalId: p.id, accept: false })}>Recusar</button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * The same kind of work on another CLI: the maestro sends it there when this row's CLI is much
 * busier, or used up.
 */
function AltSeat({ id, kind, name, cli, value, onChange }: { id: string; kind: string; name: string; cli: AgentCliForRole; value: AgentSeat | null; onChange: (alt: AgentSeat | null) => void }) {
  const { catalog } = useOrbit()
  return (
    <div className="alt-seat">
      <label htmlFor={id}>Equivalente em outra CLI <span className="muted">(no automático, concorre por quota válida e compatibilidade com a tarefa)</span></label>
      <div className="squads__row">
        <select id={id} className="cli-select" value={value?.cli ?? ''} onChange={(e) => onChange(e.target.value ? suggestedTaskSeat(catalog, e.target.value as AgentCliForRole, kind) : null)}>
          <option value="">Nenhum</option>
          {AGENT_CLIS.filter((c) => c !== cli).map((c) => <option key={c} value={c}>{CLI_LABEL[c]}</option>)}
        </select>
        {value && (
          <>
            <ModelSelect id={`${id}-m`} compact label={`Modelo equivalente de ${name}`} cli={value.cli} value={value.model} onChange={(model) => onChange({ ...value, model, pinned: true })} />
            <EffortCycle label={`Equivalente de ${name}`} cli={value.cli} model={value.model} value={value.effort} onChange={(effort) => onChange({ ...value, effort, pinned: true })} />
          </>
        )}
      </div>
      {value && <p className="note">{value.pinned ? 'Escolha humana: modelo e esforço preservados, inclusive o padrão da CLI. Se incompatível com a política ou catálogo, este equivalente não concorre.' : 'Herdado da tabela: modelo e esforço se adaptam à dificuldade; frontend e motion seguem as políticas acima.'}</p>}
      {value?.pinned && <button type="button" className="btn btn--ghost btn--sm" onClick={() => { const { pinned: _, ...seat } = value; onChange(seat) }}>Adaptar equivalente à tarefa</button>}
    </div>
  )
}
