import { useId, useState } from 'react'
import { MODEL_ID, type AgentCli, type MissionMode, type Squad } from '@orbit/protocol'
import { useOrbit, useOrbitClient } from '../orbit/context.tsx'
import { CLI_LABEL, MODEL_SUGGESTIONS, MODE_LABEL } from '../orbit/labels.ts'
import { Dialog } from './Dialog.tsx'

const MODE_HINT: Record<MissionMode, string> = {
  livre: 'Um agente, você no comando.',
  squad: 'Um time fixo que segue um roteiro.',
  agentica: 'Você descreve o objetivo; o líder monta o time.',
}

export interface AgentChoice {
  cli: AgentCli
  model: string
}

function AgentFields({ value, onChange, label = 'Agente' }: { value: AgentChoice; onChange: (next: AgentChoice) => void; label?: string }) {
  const id = useId()
  return (
    <>
      <fieldset className="field">
        <legend>{label}</legend>
        <div className="segmented">
          {(Object.keys(CLI_LABEL) as AgentCli[]).map((cli) => (
            <button key={cli} type="button" aria-pressed={value.cli === cli} onClick={() => onChange({ cli, model: cli === value.cli ? value.model : '' })}>
              {CLI_LABEL[cli]}
            </button>
          ))}
        </div>
      </fieldset>
      {value.cli !== 'shell' && (
        <div className="field">
          <label htmlFor={`${id}-model`}>Modelo <span className="muted">(vazio = padrão do {CLI_LABEL[value.cli]})</span></label>
          <input id={`${id}-model`} list={`${id}-models`} value={value.model} onChange={(e) => onChange({ ...value, model: e.target.value.trim() })} placeholder="ex.: claude-opus-5-5" spellCheck={false} />
          <datalist id={`${id}-models`}>
            {MODEL_SUGGESTIONS[value.cli].map((m) => <option key={m} value={m} />)}
          </datalist>
        </div>
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

export function OpenWorkspaceDialog({ onClose }: { onClose: () => void }) {
  const client = useOrbitClient()
  const [path, setPath] = useState('')
  return (
    <Dialog eyebrow="Workspace" title="Abrir pasta" submitLabel="Abrir" onClose={onClose} onSubmit={() => {
      if (!path.trim()) return
      client.send({ type: 'workspace.open', path: path.trim() })
      onClose()
    }}>
      <div className="field">
        <label htmlFor="ws-path">Caminho absoluto da pasta do projeto</label>
        <input id="ws-path" className="mono" value={path} onChange={(e) => setPath(e.target.value)} placeholder="/Users/voce/projetos/meu-app" autoFocus spellCheck={false} />
      </div>
    </Dialog>
  )
}

export function NewMissionDialog({ workspaceId, workspaceName, onClose, onManageSquads }: { workspaceId: string; workspaceName: string; onClose: () => void; onManageSquads: () => void }) {
  const client = useOrbitClient()
  const { squads } = useOrbit()
  const [title, setTitle] = useState('')
  const [objective, setObjective] = useState('')
  const [mode, setMode] = useState<MissionMode>('livre')
  const [squadId, setSquadId] = useState<string | null>(null)
  const [lead, setLead] = useState<AgentChoice>({ cli: 'claude', model: '' })
  const [error, setError] = useState<string | null>(null)

  const pickSquad = (squad: Squad) => {
    setSquadId(squad.id)
    setLead({ cli: squad.lead.cli, model: squad.lead.model ?? '' })
  }

  return (
    <Dialog eyebrow={`Nova missão · ${workspaceName}`} title="O que vamos fazer?" submitLabel="Lançar missão" onClose={onClose} onSubmit={() => {
      if (!title.trim()) return setError('Dê um título para a missão.')
      if (mode === 'squad' && !squadId) return setError('Escolha o squad da missão.')
      if (invalidModel(lead)) return setError('Modelo inválido: use só letras, números, ponto, hífen ou dois-pontos.')
      client.send({ type: 'mission.create', workspaceId, title, objective, mode, squadId: mode === 'squad' ? squadId : null, lead: { cli: lead.cli, model: modelOrNull(lead), title: '' } })
      onClose()
    }}>
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
            <button key={m} type="button" className="mode-option" aria-pressed={mode === m} onClick={() => setMode(m)}>
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
      <AgentFields value={lead} onChange={setLead} label={mode === 'livre' ? 'Agente' : 'Líder'} />
      {mode === 'agentica' && <p className="note">O líder recebe o objetivo e abre os ajudantes sozinho pelo MCP do Orbit. Os retornos chegam no terminal dele.</p>}
      {mode === 'squad' && <p className="note">O líder recebe o objetivo e o roteiro do squad e abre cada papel quando o roteiro mandar.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </Dialog>
  )
}

export function AddAgentDialog({ missionId, onClose }: { missionId: string; onClose: () => void }) {
  const client = useOrbitClient()
  const { missions, squads } = useOrbit()
  const squad = squads.find((s) => s.id === missions.find((m) => m.id === missionId)?.squadId)
  const [roleId, setRoleId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [task, setTask] = useState('')
  const [agent, setAgent] = useState<AgentChoice>({ cli: 'claude', model: '' })
  const [error, setError] = useState<string | null>(null)
  const role = squad?.roles.find((r) => r.id === roleId)

  return (
    <Dialog eyebrow="Tripulação" title="Adicionar agente" submitLabel="Abrir agente" onClose={onClose} onSubmit={() => {
      if (!role && invalidModel(agent)) return setError('Modelo inválido: use só letras, números, ponto, hífen ou dois-pontos.')
      const request = role
        ? { missionId, role: 'crew' as const, cli: role.cli, model: role.model, title, task, squadRoleId: role.id }
        : { missionId, role: 'crew' as const, cli: agent.cli, model: modelOrNull(agent), title, task: agent.cli === 'shell' ? null : task }
      client.send({ type: 'pane.spawn', request })
      onClose()
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
          {role && <p className="note">{CLI_LABEL[role.cli]}{role.model ? ` · ${role.model}` : ''}: {role.brief}</p>}
        </fieldset>
      )}
      <div className="field">
        <label htmlFor="a-title">Função <span className="muted">(opcional{role ? `; padrão: ${role.name}` : ''})</span></label>
        <input id="a-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Mapear leituras do token" autoFocus />
      </div>
      {!role && <AgentFields value={agent} onChange={setAgent} />}
      {(role || agent.cli !== 'shell') && (
        <div className="field">
          <label htmlFor="a-task">Tarefa <span className="muted">(opcional; vira o primeiro pedido do agente)</span></label>
          <textarea id="a-task" rows={4} value={task} onChange={(e) => setTask(e.target.value)} placeholder="Mapeie onde o token de sessão é lido e devolva a lista de arquivos" />
        </div>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
    </Dialog>
  )
}
