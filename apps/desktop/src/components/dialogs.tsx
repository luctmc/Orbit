import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { TRANSLATION_LABEL, AGENT_CLIS, MODEL_ID, type AgentCli, type AgentCliForRole, type Effort, type MissionMode, type Squad } from '@orbit/protocol'
import { useOrbit, useOrbitClient } from '../orbit/context.tsx'
import { CLI_LABEL, EFFORT_LABEL, MODE_LABEL } from '../orbit/labels.ts'
import { AccountSelect, AgentChooser, CliSelect, EffortChoice, ModelSelect, useAgentReadiness } from './agentPickers.tsx'
import { Dialog } from './Dialog.tsx'
import { BudgetFields, budgetFrom } from './Budget.tsx'

const MODE_HINT: Record<MissionMode, string> = {
  livre: 'Um agente, você no comando.',
  squad: 'Um time fixo que segue um roteiro.',
  agentica: 'Você descreve o objetivo; o líder monta o time.',
}

export interface AgentChoice {
  cli: AgentCli
  model: string
  effort: Effort | null
  /** null = automatic. */
  accountId: string | null
}

const DEFAULT_AGENT: AgentChoice = { cli: 'claude', model: '', effort: null, accountId: null }

function describeSeat(cli: AgentCli, model: string | null, effort: Effort | null): string {
  return [CLI_LABEL[cli], model, effort && `esforço ${EFFORT_LABEL[effort]}`].filter(Boolean).join(' · ')
}

function AgentFields({ value, onChange, label = 'Agente', shell = true }: { value: AgentChoice; onChange: (next: AgentChoice) => void; label?: string; shell?: boolean }) {
  const id = useId()
  const latest = useRef(value)
  latest.current = value
  // Stable, so the effort picker can reset an effort the new model does not accept.
  const setEffort = useCallback((effort: Effort | null) => onChange({ ...latest.current, effort }), [onChange])
  const setAccount = useCallback((accountId: string | null) => onChange({ ...latest.current, accountId }), [onChange])
  return (
    <>
      <fieldset className="field">
        <legend>{label}</legend>
        {/* A different agent starts from its own default model, effort and account. */}
        {label === 'Líder' && value.cli !== 'shell'
          ? <CliSelect id={`${id}-cli`} label="Agente do líder" value={value.cli} onChange={(cli) => onChange(cli === value.cli ? value : { cli, model: '', effort: null, accountId: null })} />
          : <AgentChooser label={label} shell={shell} value={value.cli} onChange={(cli) => onChange(cli === value.cli ? value : { cli, model: '', effort: null, accountId: null })} />}

      </fieldset>
      {value.cli !== 'shell' && <AccountSelect id={`${id}-account`} cli={value.cli} value={value.accountId} onChange={setAccount} />}
      {value.cli !== 'shell' && (
        <div className="field">
          <label htmlFor={`${id}-model`}>Modelo</label>
          <ModelSelect id={`${id}-model`} cli={value.cli} accountId={value.accountId} value={value.model || null} onChange={(model) => onChange({ ...latest.current, model: model ?? '' })} />
        </div>
      )}
      {value.cli !== 'shell' && (
        <fieldset className="field">
          <legend>Esforço</legend>
          <EffortChoice accountId={value.accountId} cli={value.cli} model={value.model || null} value={value.effort} onChange={setEffort} />
        </fieldset>
      )}

    </>
  )
}

function modelOrNull(choice: AgentChoice): string | null {
  return choice.cli === 'shell' || !choice.model ? null : choice.model
}

function invalidModel(choice: AgentChoice): boolean {
  const model = modelOrNull(choice)
  return model !== null && !MODEL_ID.test(model)
}

export function NewMissionDialog({ workspaceId, workspaceName, onClose, onManageSquads, onManageRouting }: { workspaceId: string; workspaceName: string; onClose: () => void; onManageSquads: () => void; onManageRouting: () => void }) {
  const client = useOrbitClient()
  const { squads, routing, templates: allTemplates, accounts, settings } = useOrbit()
  const savedDraft = client.missionDrafts.get(workspaceId)
  const [translationAccountId, setTranslationAccountId] = useState(savedDraft?.translationAccountId ?? '')
  const [allowOriginal, setAllowOriginal] = useState(savedDraft?.allowOriginal ?? false)
  const [launching, setLaunching] = useState(false)
  const [pending, setPending] = useState(client.inputPending(`mission-${workspaceId}`))
  const [checking, setChecking] = useState(false)
  const [receipt, setReceipt] = useState<string | null>(null)
  const templates = allTemplates.filter((t) => t.workspaceId === null || t.workspaceId === workspaceId).sort((a, b) => a.name.localeCompare(b.name))
  const [templateId, setTemplateId] = useState('')
  const [cards, setCards] = useState<string[]>(savedDraft?.cards ?? [])
  const [title, setTitle] = useState(savedDraft?.title ?? '')
  const [objective, setObjective] = useState(savedDraft?.objective ?? '')
  const [mode, setMode] = useState<MissionMode>(savedDraft?.mode ?? 'livre')
  const [squadId, setSquadId] = useState<string | null>(savedDraft?.squadId ?? null)
  const [lead, setLead] = useState<AgentChoice>(savedDraft ? { cli: savedDraft.lead.cli, model: savedDraft.lead.model ?? '', effort: savedDraft.lead.effort ?? null, accountId: savedDraft.lead.accountId ?? null } : routing ? { cli: routing.lead.cli, model: routing.lead.model ?? '', effort: routing.lead.effort, accountId: routing.lead.accountId ?? null } : DEFAULT_AGENT)
  const [adaptiveLead, setAdaptiveLead] = useState(savedDraft?.adaptiveLead ?? false)
  const [worktrees, setWorktrees] = useState(savedDraft?.isolation === 'worktrees')
  const [clis, setClis] = useState<AgentCliForRole[]>(savedDraft?.allowedClis ?? ['claude', 'codex'])
  const readiness = useAgentReadiness()
  const [budgetTokens, setBudgetTokens] = useState(savedDraft?.budget?.tokens ? String(savedDraft.budget.tokens / 1000) : '')
  const [budgetCost, setBudgetCost] = useState(savedDraft?.budget?.costUsd ? String(savedDraft.budget.costUsd) : '')
  const [error, setError] = useState<string | null>(null)

  const checkPending = useCallback(async () => {
    setChecking(true)
    try {
      const result = await client.checkPendingMission(workspaceId)
      setReceipt(result.message)
      setError(null)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setChecking(false); setPending(client.inputPending(`mission-${workspaceId}`)) }
  }, [client, workspaceId])

  useEffect(() => {
    if (client.inputPending(`mission-${workspaceId}`)) void checkPending()
  }, [client, workspaceId, checkPending])

  useEffect(() => { client.missionDrafts.set(workspaceId, { workspaceId, title, objective, mode, adaptiveLead, squadId, isolation: worktrees ? 'worktrees' : null, cards, allowedClis: clis, budget: budgetFrom(budgetTokens, budgetCost), lead: { cli: lead.cli, model: modelOrNull(lead), effort: lead.cli === 'shell' ? null : lead.effort, accountId: lead.accountId, title: '' }, translationAccountId: translationAccountId || undefined, allowOriginal }) }, [client, workspaceId, title, objective, mode, adaptiveLead, squadId, worktrees, cards, clis, budgetTokens, budgetCost, lead, translationAccountId, allowOriginal])

  /** A template fills the whole form; everything stays editable. */
  const applyTemplate = (id: string) => {
    setTemplateId(id)
    setAdaptiveLead(false)
    const t = templates.find((x) => x.id === id)
    if (!t) return setCards([])
    setTitle(t.title)
    setObjective(t.objective)
    setMode(t.mode)
    setSquadId(t.squadId)
    setWorktrees(t.isolation === 'worktrees')
    setLead({ cli: t.lead.cli, model: t.lead.model ?? '', effort: t.lead.effort, accountId: null })
    setCards(t.cards)
    setBudgetTokens(t.budget?.tokens ? String(t.budget.tokens / 1000) : '')
    setBudgetCost(t.budget?.costUsd ? String(t.budget.costUsd) : '')
  }

  // Changing execution mode must not replace the leader the person just chose.
  const pickMode = (next: MissionMode) => setMode(next)
  const pickSquad = (squad: Squad) => {
    setSquadId(squad.id)
    setLead({ cli: squad.lead.cli, model: squad.lead.model ?? '', effort: null, accountId: null })
  }

  return (
    <Dialog eyebrow={`Nova missão · ${workspaceName}`} title="O que vamos fazer?" submitLabel={checking ? 'Consultando pedido…' : pending ? 'Conferir pedido' : 'Lançar missão'} busy={launching} submitDisabled={launching || checking} onClose={onClose} onSubmit={async () => {
      if (launching || checking) return
      if (client.inputPending(`mission-${workspaceId}`)) { await checkPending(); return }
      if (!title.trim()) return setError('Dê um título para a missão.')
      if (mode === 'squad' && !squadId) return setError('Escolha o squad da missão.')
      if (invalidModel(lead)) return setError('Modelo inválido: use só letras, números, ponto, hífen, barra ou dois-pontos.')
      setLaunching(true)
      try {
      await client.createMission({ translationAccountId: translationAccountId || undefined, allowOriginal, workspaceId, title, objective, mode, adaptiveLead: mode === 'agentica' && adaptiveLead, squadId: mode === 'squad' ? squadId : null, isolation: worktrees ? 'worktrees' : null, cards, allowedClis: clis, budget: budgetFrom(budgetTokens, budgetCost), lead: { cli: lead.cli, model: modelOrNull(lead), effort: lead.cli === 'shell' ? null : lead.effort, accountId: lead.accountId, title: '' } })
      client.missionDrafts.delete(workspaceId)
      onClose()
      } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
      finally { setLaunching(false); setPending(client.inputPending(`mission-${workspaceId}`)) }
    }}>
      {pending && <p className="note note--warn" role="status">Há um pedido anterior sem confirmação. Você pode editar este rascunho; “Conferir pedido” consulta apenas o envio anterior e não abre agentes.</p>}
      {receipt && <p className="note" role="status">{receipt}</p>}
      <fieldset disabled={launching} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      {settings?.agentsInEnglish && <div className="field">
        <label htmlFor="mission-translator">Traduzir objetivo para inglês · {TRANSLATION_LABEL}</label>
        <select id="mission-translator" disabled={allowOriginal} value={translationAccountId} onChange={e => setTranslationAccountId(e.target.value)}>
          <option value="">Escolha a conta Codex</option>
          {accounts.filter(a => a.cli === 'codex' && a.kind === 'assinatura').map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <label><input type="checkbox" checked={allowOriginal} onChange={e => setAllowOriginal(e.target.checked)} /> Autorizar objetivo original sem tradução</label>
      </div>}
      {templates.length > 0 && (
        <div className="field template-pick">
          <label htmlFor="m-template">Modelo</label>
          <div className="template-pick__row">
            <select id="m-template" value={templateId} onChange={(e) => applyTemplate(e.target.value)}>
              <option value="">Sem modelo</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}{t.workspaceId ? '' : ' (qualquer workspace)'}</option>)}
            </select>
            {templateId && (
              <button type="button" className="link-btn" onClick={() => {
                const t = templates.find((x) => x.id === templateId)
                if (t && confirm(`Apagar o modelo "${t.name}"?`)) { client.send({ type: 'template.delete', templateId }); applyTemplate('') }
              }}>Apagar modelo</button>
            )}
          </div>
          {cards.length > 0 && <p className="note">O quadro começa com {cards.length} {cards.length === 1 ? 'cartão' : 'cartões'}: {cards.join(' · ')}</p>}
        </div>
      )}
      <div className="field">
        <label htmlFor="m-title">Título</label>
        <input id="m-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Refatorar a autenticação" autoFocus />
      </div>
      <div className="field">
        <label htmlFor="m-obj">Objetivo <span className="muted">(opcional)</span></label>
        <textarea id="m-obj" rows={3} value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="Trocar o login para o novo provedor de sessão sem quebrar os testes" />
      </div>
      <fieldset className="field">
        <legend>Modo</legend>
        <div className="mode-list">
          {(Object.keys(MODE_LABEL) as MissionMode[]).map((m) => (
            <button key={m} type="button" className="mode-option" aria-pressed={mode === m} onClick={() => pickMode(m)}>
              <span className={`badge badge--${m}`}>{MODE_LABEL[m]}</span>
              <span>{MODE_HINT[m]}</span>
            </button>
          ))}
        </div>
      </fieldset>
      {mode === 'squad' && (
        <fieldset className="field">
          <legend className="legend-row">
            <span>Squad</span>
            <button type="button" className="link-btn" onClick={onManageSquads}>Gerenciar squads</button>
          </legend>
          <div className="squad-pick">
            {squads.map((s) => (
              <button key={s.id} type="button" className="squad-option" aria-pressed={squadId === s.id} onClick={() => pickSquad(s)}>
                <span className="squad-option__name">{s.name}{s.builtin ? '' : <span className="muted"> · seu</span>}</span>
                {s.description && <span className="squad-option__desc">{s.description}</span>}
                <span className="squad-option__roles">{s.roles.map((r) => <span key={r.id} className="chip">{r.name}</span>)}</span>
              </button>
            ))}
          </div>
        </fieldset>
      )}
      {mode === 'agentica' && <label className="check">
        <input type="checkbox" checked={adaptiveLead} onChange={(e) => setAdaptiveLead(e.target.checked)} />
        <span>Escolher modelo e esforço do líder pelo objetivo</span>
      </label>}
      <AgentFields value={lead} onChange={(next) => { setLead(next); setAdaptiveLead(false) }} label={mode === 'livre' ? 'Agente' : 'Líder'} />
      {mode === 'agentica' && <p className="note">Você escolhe o agente, o modelo e a conta do líder. {adaptiveLead ? 'A adaptação pode ajustar modelo e esforço pelo objetivo, mantendo agente e conta. Alterar os campos desliga a adaptação.' : 'O modelo e a conta escolhidos serão usados na execução.'} O padrão de novas missões pode ser salvo em Configurações → Quem faz cada tarefa.</p>}
      {mode === 'agentica' && (
        <fieldset className="field">
          <legend>O maestro pode usar</legend>
          <div className="segmented" role="group" aria-label="CLIs dos ajudantes">
            {AGENT_CLIS.map((cli) => (
              <button key={cli} type="button" aria-pressed={clis.includes(cli)} title={readiness(cli).text}
                onClick={() => setClis((list) => (list.includes(cli) ? (list.length > 1 ? list.filter((c) => c !== cli) : list) : [...list, cli]))}>
                {CLI_LABEL[cli]}{readiness(cli).ready ? '' : ' ·'}
              </button>
            ))}
          </div>
          <p className="note">Para cada atividade o Orbit escolhe a CLI pela tabela, o modelo, o esforço e a conta com mais folga, e troca de CLI quando todas as contas de uma estão no limite.</p>
        </fieldset>
      )}
      {mode === 'agentica' && (
        <p className="note">
          O líder recebe o objetivo e abre os ajudantes sozinho, cada um com o agente da tabela{' '}
          <button type="button" className="link-btn" onClick={onManageRouting}>quem faz cada tarefa</button>. Os retornos chegam no terminal dele.
        </p>
      )}
      {mode === 'squad' && <p className="note">O líder recebe o objetivo e o roteiro do squad e abre cada papel quando o roteiro mandar.</p>}
      <fieldset className="field">
        <legend>Orçamento <span className="muted">(opcional)</span></legend>
        <BudgetFields idPrefix="m-budget" tokens={budgetTokens} cost={budgetCost} onTokens={setBudgetTokens} onCost={setBudgetCost} />
      </fieldset>
      <label className="check mission-git">
        <input type="checkbox" checked={worktrees} onChange={(e) => setWorktrees(e.target.checked)} />
        <span>
          <strong>Cada agente no seu branch</strong>
          <span className="muted">O líder e cada ajudante trabalham numa cópia própria do repositório (git worktree), sem mexer na sua pasta; o líder integra os branches e você abre o PR pelo Orbit.</span>
        </span>
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      </fieldset>
    </Dialog>
  )
}

export function AddAgentDialog({ missionId, onClose }: { missionId: string; onClose: () => void }) {
  const client = useOrbitClient()
  const { missions, squads, routing, connection } = useOrbit()
  const squad = squads.find((s) => s.id === missions.find((m) => m.id === missionId)?.squadId)
  const [roleId, setRoleId] = useState<string | null>(null)
  const [kindId, setKindId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [task, setTask] = useState('')
  const [agent, setAgent] = useState<AgentChoice>(DEFAULT_AGENT)
  const [error, setError] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)
  const pending = useRef(false)
  const role = squad?.roles.find((r) => r.id === roleId)
  // Without a squad, the task table can staff the helper.
  const kind = squad ? undefined : routing?.taskTypes.find((t) => t.id === kindId)
  const preset = role ?? kind

  return (
    <Dialog eyebrow="Tripulação" title="Adicionar agente" submitLabel={opening ? 'Abrindo…' : 'Abrir agente'} busy={opening} submitDisabled={opening || connection !== 'open'} onClose={() => { if (!pending.current) onClose() }} onSubmit={() => {
      if (pending.current || connection !== 'open') return
      if (!preset && invalidModel(agent)) return setError('Modelo inválido: use só letras, números, ponto, hífen, barra ou dois-pontos.')
      const request = role
        ? { missionId, role: 'crew' as const, cli: role.cli, model: role.model, title, task, squadRoleId: role.id }
        : kind
          ? { missionId, role: 'crew' as const, cli: kind.cli, model: kind.model, effort: kind.effort, title, task, taskTypeId: kind.id }
          : { missionId, role: 'crew' as const, cli: agent.cli, model: modelOrNull(agent), effort: agent.cli === 'shell' ? null : agent.effort, accountId: agent.accountId, title, task: agent.cli === 'shell' ? null : task }
      pending.current = true
      setOpening(true); setError(null)
      void client.spawn(request)
        .then(onClose, cause => { pending.current = false; setOpening(false); setError(cause instanceof Error ? cause.message : String(cause)) })
    }}>
      {squad && (
        <fieldset className="field">
          <legend>Papel do squad {squad.name}</legend>
          <div className="segmented segmented--wrap">
            <button type="button" aria-pressed={roleId === null} onClick={() => setRoleId(null)}>Avulso</button>
            {squad.roles.map((r) => (
              <button key={r.id} type="button" aria-pressed={roleId === r.id} onClick={() => setRoleId(r.id)}>{r.name}</button>
            ))}
          </div>
          {role && <p className="note">{describeSeat(role.cli, role.model, null)}: {role.brief}</p>}
        </fieldset>
      )}
      {!squad && routing && (
        <fieldset className="field">
          <legend>Tipo de tarefa</legend>
          <div className="segmented segmented--wrap">
            <button type="button" aria-pressed={kindId === null} onClick={() => setKindId(null)}>Avulso</button>
            {routing.taskTypes.map((t) => (
              <button key={t.id} type="button" aria-pressed={kindId === t.id} onClick={() => setKindId(t.id)}>{t.name}</button>
            ))}
          </div>
          {kind && <p className="note">{describeSeat(kind.cli, kind.model, kind.effort)}{kind.description ? `: ${kind.description}` : ''}</p>}
        </fieldset>
      )}
      <div className="field">
        <label htmlFor="a-title">Função <span className="muted">(opcional{preset ? `; padrão: ${preset.name}` : ''})</span></label>
        <input id="a-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Mapear leituras do token" autoFocus />
      </div>
      {!preset && <AgentFields value={agent} onChange={setAgent} />}
      {(preset || agent.cli !== 'shell') && (
        <div className="field">
          <label htmlFor="a-task">Tarefa <span className="muted">(opcional; vira o primeiro pedido do agente)</span></label>
          <textarea id="a-task" rows={4} value={task} onChange={(e) => setTask(e.target.value)} placeholder="Mapeie onde o token de sessão é lido e devolva a lista de arquivos" />
        </div>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
    </Dialog>
  )
}

/**
 * Hands the mission's lead to another agent: a new one (any CLI, model and effort) or a helper
 * already in it. Nothing is lost: the new lead gets the mission's briefing.
 */
export function LeadChangeDialog({ mission, onClose }: { mission: { id: string; title: string; git: unknown }; onClose: () => void }) {
  const client = useOrbitClient()
  const { panes } = useOrbit()
  const current = panes.find((p) => p.missionId === mission.id && p.role === 'lead')
  const helpers = panes.filter((p) => p.missionId === mission.id && p.role === 'crew' && p.cli !== 'shell' && p.status !== 'exited')
  const [kind, setKind] = useState<'new' | 'promote'>('new')
  const [agent, setAgent] = useState<AgentChoice>({ cli: current?.cli === 'claude' ? 'codex' : 'claude', model: '', effort: null, accountId: null })
  const [promote, setPromote] = useState<number | null>(helpers[0]?.id ?? null)
  const [error, setError] = useState<string | null>(null)
  return (
    <Dialog eyebrow={mission.title} title="Trocar o líder" submitLabel="Passar a liderança" onClose={onClose} onSubmit={() => {
      if (kind === 'promote') {
        if (promote === null) return setError('Escolha o ajudante.')
        client.send({ type: 'mission.lead.change', missionId: mission.id, to: { kind: 'promote', paneId: promote } })
      } else {
        if (agent.cli === 'shell') return setError('O líder precisa ser um agente.')
        if (invalidModel(agent)) return setError('Modelo inválido: use só letras, números, ponto, hífen, barra ou dois-pontos.')
        client.send({ type: 'mission.lead.change', missionId: mission.id, to: { kind: 'new', cli: agent.cli, model: modelOrNull(agent), effort: agent.effort, accountId: agent.accountId } })
      }
      onClose()
    }}>
      <p className="muted">
        {current ? <>Hoje lidera #{current.id} ({describeSeat(current.cli, current.model, current.effort)}). </> : 'A missão está sem líder. '}
        O novo líder recebe o dossiê da missão: objetivo, decisões anotadas, quadro, ajudantes e o que cada um deve, retornos, branches e o fim da conversa do líder atual. Os ajudantes passam a entregar para ele, e o líder atual fecha (a conversa dele continua salva na CLI).
      </p>
      <div className="segmented" role="group" aria-label="Quem assume">
        <button type="button" aria-pressed={kind === 'new'} onClick={() => setKind('new')}>Agente novo</button>
        <button type="button" aria-pressed={kind === 'promote'} disabled={helpers.length === 0 || Boolean(mission.git)} title={mission.git ? 'Numa missão com um branch por agente, o líder precisa ser um agente novo' : helpers.length === 0 ? 'Nenhum ajudante rodando' : undefined} onClick={() => setKind('promote')}>Promover um ajudante</button>
      </div>
      {kind === 'new' ? (
        <AgentFields value={agent} onChange={setAgent} label="Novo líder" shell={false} />
      ) : (
        <fieldset className="field">
          <legend>Ajudante que assume</legend>
          {helpers.map((p) => (
            <label key={p.id} className="check">
              <input type="radio" name="promote" checked={promote === p.id} onChange={() => setPromote(p.id)} />
              <span>#{p.id} {p.title} <span className="muted">· {describeSeat(p.cli, p.model, p.effort)}</span></span>
            </label>
          ))}
          <p className="note">Ele continua com a conversa dele, recebe o dossiê e passa a orquestrar.</p>
        </fieldset>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
    </Dialog>
  )
}
